import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { useSerialStore } from "@/stores/serialStore";
import type { SerialDataEvent, SerialStatusEvent } from "@/lib/serialTypes";
import {
  mergeSerialReceiveResults,
  SerialReceivePipeline,
  type SerialReceiveResult,
} from "@/lib/serialReceivePipeline";
import { formatBytes } from "@/lib/formatters";
import { publishToAiBridge } from "@/lib/aiBridge";
import { useAiBridgeStore } from "@/stores/aiBridgeStore";
import { useShallow } from "zustand/react/shallow";
import { TEXT_FRAME_IDLE_MS } from "@/lib/dataFraming";
import { captureSessionChunk } from "@/lib/sessionCapture";
import { isModbusParseMode } from "@/lib/chartTypes";
import {
  buildModbusAsciiReadRequest,
  buildModbusReadRequest,
  buildModbusTcpReadRequest,
  shouldAutoPollModbus,
} from "@/lib/parseModbusRtu";
import { writeSerialData } from "@/lib/serialSend";

/**
 * Hook to listen for serial events
 * Automatically subscribes to serial data and status events on mount
 */
export function useSerialEvents() {
  const { commitSerialReceiveBatch, setError, connected, running, activeSourceType, chartConfig } = useSerialStore(
    useShallow((state) => ({
      commitSerialReceiveBatch: state.commitSerialReceiveBatch,
      setError: state.setError,
      connected: state.connected,
      running: state.running,
      activeSourceType: state.activeSourceType,
      chartConfig: state.chartConfig,
    }))
  );

  const receivePipelineRef = useRef(new SerialReceivePipeline());

  // 批量处理缓冲区：所有高频更新统一到 requestAnimationFrame 节流
  const batchResultsRef = useRef<SerialReceiveResult[]>([]);
  const updateTimerRef = useRef<number | null>(null);
  const idleFlushTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const receivePipeline = receivePipelineRef.current;
    // 批量更新函数 - 在每帧最多触发一次 setState
    const flushBatch = () => {
      const batch = mergeSerialReceiveResults(batchResultsRef.current);
      batchResultsRef.current = [];
      commitSerialReceiveBatch(batch);

      if (useAiBridgeStore.getState().status.running) {
        publishToAiBridge("serial", batch.lines, batch.telemetryBatch.points, useSerialStore.getState().chartConfig);
      }

      updateTimerRef.current = null;
    };

    // 调度批量更新 - 使用 requestAnimationFrame 在下一帧更新
    const scheduleBatchUpdate = () => {
      if (updateTimerRef.current === null) {
        updateTimerRef.current = requestAnimationFrame(flushBatch);
      }
    };

    // 把 pending 里残留（无换行结尾）的数据刷成一行 RX
    const flushPendingLine = () => {
      idleFlushTimerRef.current = null;
      const state = useSerialStore.getState();
      const result = receivePipeline.flushPending({
        framing: state.rxFraming,
        chartConfig: state.chartConfig,
      });
      if (result.lines.length === 0) return;
      batchResultsRef.current.push(result);
      scheduleBatchUpdate();
    };

    // 收到数据就重置空闲计时器：静默一段时间后认为一帧结束，刷出残留。
    // timeout 模式用用户配置的 idleMs 作为主断帧；其它模式用更长的兜底值。
    const scheduleIdleFlush = () => {
      if (idleFlushTimerRef.current !== null) {
        clearTimeout(idleFlushTimerRef.current);
      }
      const framing = useSerialStore.getState().rxFraming;
      const delay = framing.mode === "timeout" ? Math.max(5, framing.idleMs) : TEXT_FRAME_IDLE_MS;
      idleFlushTimerRef.current = window.setTimeout(flushPendingLine, delay);
    };

    // Listen for serial data events
    const unlistenData = listen<SerialDataEvent>("serial-data", (event) => {
      const state = useSerialStore.getState();

      // 录制的是原始字节，与解析配置无关；只录接收方向
      if (state.sessionRecording && event.payload.direction === "rx") {
        for (const chunk of event.payload.chunks) captureSessionChunk("serial", chunk.data, chunk.timestamp);
      }

      batchResultsRef.current.push(
        receivePipeline.ingest(event.payload, {
          framing: state.rxFraming,
          chartConfig: state.chartConfig,
        })
      );

      if (event.payload.chunks.length > 0) {
        // 只要收到数据就调度更新，避免无换行数据时统计不刷新
        scheduleBatchUpdate();
        // 无换行结尾的帧（请求-应答的十六进制/二进制协议）靠空闲超时刷出
        scheduleIdleFlush();
      }
    });

    // Listen for serial status events
    const unlistenStatus = listen<SerialStatusEvent>("serial-status", (event) => {
      const { connected, running, error } = event.payload;
      if (!running) {
        if (idleFlushTimerRef.current !== null) {
          clearTimeout(idleFlushTimerRef.current);
          idleFlushTimerRef.current = null;
        }
        const state = useSerialStore.getState();
        const pending = receivePipeline.flushPending({
          framing: state.rxFraming,
          chartConfig: state.chartConfig,
        });
        if (pending.lines.length > 0) {
          batchResultsRef.current.push(pending);
          scheduleBatchUpdate();
        }
        receivePipeline.reset();
      }
      // 一次性应用后端状态，避免 setRunning/setError 的副作用互相覆盖重连状态。
      useSerialStore.setState({ connected, running, error: error ?? null });
    });

    // Cleanup
    return () => {
      // 清理定时器
      if (idleFlushTimerRef.current !== null) {
        clearTimeout(idleFlushTimerRef.current);
        idleFlushTimerRef.current = null;
      }
      if (updateTimerRef.current !== null) {
        cancelAnimationFrame(updateTimerRef.current);
        flushBatch(); // 确保剩余数据被处理
      }
      receivePipeline.reset();

      unlistenData.then((fn) => fn());
      unlistenStatus.then((fn) => fn());
    };
  }, [commitSerialReceiveBatch]);

  useEffect(() => {
    const parseMode = chartConfig.parseMode;
    if (
      !connected ||
      !running ||
      !chartConfig.enabled ||
      !isModbusParseMode(parseMode) ||
      !shouldAutoPollModbus(parseMode, chartConfig.modbusRtu, activeSourceType)
    ) {
      return;
    }

    let stopped = false;
    let sending = false;
    let errorReported = false;
    let transactionId = 0;
    const protocolLabel =
      parseMode === "modbus-ascii" ? "Modbus ASCII" : parseMode === "modbus-tcp" ? "Modbus TCP" : "Modbus RTU";
    const poll = () => {
      if (sending) return;
      transactionId = (transactionId + 1) & 0xffff;
      const request =
        parseMode === "modbus-ascii"
          ? buildModbusAsciiReadRequest(chartConfig.modbusRtu)
          : parseMode === "modbus-tcp"
            ? buildModbusTcpReadRequest(chartConfig.modbusRtu, transactionId)
            : buildModbusReadRequest(chartConfig.modbusRtu);
      sending = true;
      void writeSerialData(request)
        .then(() => {
          errorReported = false;
        })
        .catch((error) => {
          if (!stopped && !errorReported) {
            setError(`${protocolLabel} 轮询失败: ${error}`);
            errorReported = true;
          }
        })
        .finally(() => {
          sending = false;
        });
    };

    poll();
    // ponytail: 轮询周期同时充当响应超时；慢速多从站总线需要严格排队时再关联请求与响应。
    const timer = window.setInterval(poll, chartConfig.modbusRtu.pollIntervalMs);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [activeSourceType, chartConfig, connected, running, setError]);
}

/**
 * Get serial statistics
 */
export function useSerialStats() {
  const { lineCount, stats, running, connected } = useSerialStore(
    useShallow((state) => ({
      lineCount: state.lines.length,
      stats: state.stats,
      running: state.running,
      connected: state.connected,
    }))
  );

  return {
    lineCount,
    bytesReceived: stats.bytes_received,
    bytesSent: stats.bytes_sent,
    running,
    connected,
    bytesReceivedFormatted: formatBytes(stats.bytes_received),
    bytesSentFormatted: formatBytes(stats.bytes_sent),
  };
}
