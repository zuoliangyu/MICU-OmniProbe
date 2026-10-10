import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { useRttStore } from "@/stores/rttStore";
import type { RttDataBatch, RttStatusEvent, RttLine } from "@/lib/types";
import { TelemetryIngestionBuffer, TelemetryParseDispatcher } from "@/lib/chartIngestion";
import { TEXT_FRAME_IDLE_MS, TextFrameStream } from "@/lib/dataFraming";
import { getChartParser } from "@/lib/parseChartData";
import { captureSessionChunk } from "@/lib/sessionCapture";
import { formatBytes } from "@/lib/formatters";
import { decodeRttChunks, formatHexAddress } from "@/lib/rttStart";
import { useLogStore } from "@/stores/logStore";
import { publishToAiBridge } from "@/lib/aiBridge";
import { useAiBridgeStore } from "@/stores/aiBridgeStore";
import { useShallow } from "zustand/react/shallow";

/**
 * 监听 RTT 事件的 Hook
 * 在组件挂载时自动订阅 RTT 数据和状态事件
 */
export function useRttEvents() {
  const { addLines, addBytes, setRunning, setError, addChartDataBatch, incrementParseCounts } = useRttStore(
    useShallow((state) => ({
      addLines: state.addLines,
      addBytes: state.addBytes,
      setRunning: state.setRunning,
      setError: state.setError,
      addChartDataBatch: state.addChartDataBatch,
      incrementParseCounts: state.incrementParseCounts,
    }))
  );
  const frameStreamsRef = useRef(new Map<number, TextFrameStream>());
  const idleFlushTimersRef = useRef(new Map<number, number>());
  // 字节流解析按通道各持一份：不同 RTT 通道的二进制残包不能互相污染
  const parseDispatchersRef = useRef(new Map<number, TelemetryParseDispatcher>());

  // 批量处理缓冲区：所有高频更新统一到 requestAnimationFrame 节流
  const batchLinesRef = useRef<Omit<RttLine, "id">[]>([]);
  // 暂停显示期间的行：继续接收、解析和录制，只是不进文本区，继续时一次补上
  const pausedLinesRef = useRef<Omit<RttLine, "id">[]>([]);
  const batchBytesRef = useRef(0);
  const telemetryIngestionRef = useRef(new TelemetryIngestionBuffer());
  const updateTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const frameStreams = frameStreamsRef.current;
    const idleFlushTimers = idleFlushTimersRef.current;
    const parseDispatchers = parseDispatchersRef.current;
    // 批量更新函数 - 在每帧最多触发一次 setState
    const flushBatch = () => {
      const { isPaused, maxLines, pausedBacklog, setPausedBacklog } = useRttStore.getState();
      // 暂停只影响文本区显示，AI 仍收到本帧全部新数据
      const incomingLines = batchLinesRef.current;
      if (isPaused) {
        if (batchLinesRef.current.length > 0) {
          const paused = pausedLinesRef.current;
          paused.push(...batchLinesRef.current);
          if (paused.length > maxLines) paused.splice(0, paused.length - maxLines);
          batchLinesRef.current = [];
          setPausedBacklog(paused.length);
        }
      } else {
        // 刚继续：暂停期间缓存的行排在本批之前补上
        const lines =
          pausedLinesRef.current.length > 0
            ? pausedLinesRef.current.concat(batchLinesRef.current)
            : batchLinesRef.current;
        if (lines.length > 0) addLines(lines);
        pausedLinesRef.current = [];
        batchLinesRef.current = [];
        if (pausedBacklog > 0) setPausedBacklog(0);
      }

      const telemetryBatch = telemetryIngestionRef.current.drain();
      if (telemetryBatch.points.length > 0) addChartDataBatch(telemetryBatch.points);
      if (telemetryBatch.success > 0 || telemetryBatch.fail > 0)
        incrementParseCounts(telemetryBatch.success, telemetryBatch.fail);
      if (useAiBridgeStore.getState().status.running) {
        publishToAiBridge("rtt", incomingLines, telemetryBatch.points, useRttStore.getState().chartConfig);
      }

      if (batchBytesRef.current > 0) {
        addBytes(batchBytesRef.current);
        batchBytesRef.current = 0;
      }

      updateTimerRef.current = null;
    };

    // 调度批量更新 - 使用 requestAnimationFrame 在下一帧更新
    const scheduleBatchUpdate = () => {
      if (updateTimerRef.current === null) {
        updateTimerRef.current = requestAnimationFrame(flushBatch);
      }
    };

    // 继续显示时立即补上缓存，不必等下一批数据到来
    const unsubscribePause = useRttStore.subscribe((state, previous) => {
      if (previous.isPaused && !state.isPaused) scheduleBatchUpdate();
      // 暂停中点了清空（clearLines 会把缓存计数归零）：缓存一并丢弃
      if (state.isPaused && previous.pausedBacklog > 0 && state.pausedBacklog === 0) pausedLinesRef.current = [];
    });

    const queueLines = (lines: Omit<RttLine, "id">[]) => {
      if (lines.length === 0) return;
      batchLinesRef.current.push(...lines);
      const chartConfig = useRttStore.getState().chartConfig;
      // 字节流模式下文本行只用于日志显示，遥测数值由 ingestChannelBytes 产出
      if (chartConfig.enabled && getChartParser(chartConfig.parseMode)?.kind !== "bytes") {
        telemetryIngestionRef.current.ingestLines(lines, chartConfig);
      }
    };

    /** 字节流解析：仅在选用字节流解析器时有产出，返回是否已消费。 */
    const ingestChannelBytes = (channel: number, data: number[], timestamp: number) => {
      const chartConfig = useRttStore.getState().chartConfig;
      let dispatcher = parseDispatchers.get(channel);
      if (!dispatcher) {
        dispatcher = new TelemetryParseDispatcher();
        parseDispatchers.set(channel, dispatcher);
      }
      const parsed = dispatcher.ingestBytes(data, chartConfig, timestamp);
      if (!parsed) return;

      if (parsed.detectedChannels) {
        useRttStore.getState().setChartConfig({ ...chartConfig, channels: parsed.detectedChannels });
      }
      telemetryIngestionRef.current.ingestBatch({
        points: parsed.points,
        success: parsed.success,
        fail: parsed.fail,
      });
    };

    const clearIdleFlush = (channel: number) => {
      const timer = idleFlushTimers.get(channel);
      if (timer !== undefined) window.clearTimeout(timer);
      idleFlushTimers.delete(channel);
    };

    const flushPendingChannel = (channel: number, schedule = true) => {
      clearIdleFlush(channel);
      const stream = frameStreams.get(channel);
      if (!stream) return;
      const lines = stream.flush().map((line) => ({
        channel,
        timestamp: line.timestamp,
        text: line.text,
        level: line.level,
        rawData: line.rawData,
      }));
      queueLines(lines);
      if (schedule && lines.length > 0) scheduleBatchUpdate();
    };

    const scheduleIdleFlush = (channel: number) => {
      clearIdleFlush(channel);
      // 超时分帧模式下，空闲时长由用户配置决定；其余模式用固定兜底值刷出无换行残帧
      const framing = useRttStore.getState().rxFraming;
      const delay = framing.mode === "timeout" ? Math.max(5, framing.idleMs) : TEXT_FRAME_IDLE_MS;
      idleFlushTimers.set(
        channel,
        window.setTimeout(() => flushPendingChannel(channel), delay)
      );
    };

    const ingestChunk = (channel: number, data: number[], timestamp: number) => {
      batchBytesRef.current += data.length;

      // 录制原始字节，带上通道号——回放时必须按通道分别拼帧
      if (useRttStore.getState().sessionRecording) {
        captureSessionChunk("rtt", data, timestamp, channel);
      }

      ingestChannelBytes(channel, data, timestamp);

      let stream = frameStreams.get(channel);
      if (!stream) {
        stream = new TextFrameStream();
        frameStreams.set(channel, stream);
      }
      const lines = stream.ingest(data, timestamp, "rx", useRttStore.getState().rxFraming).map((line) => ({
        channel,
        timestamp: line.timestamp,
        text: line.text,
        level: line.level,
        rawData: line.rawData,
      }));
      queueLines(lines);
      scheduleIdleFlush(channel);
    };

    // 监听 RTT 数据事件：一次轮询的所有通道合并为一批
    const unlistenData = listen<RttDataBatch>("rtt-data", (event) => {
      const { timestamp } = event.payload;
      for (const { channel, data } of decodeRttChunks(event.payload)) ingestChunk(channel, data, timestamp);
      scheduleBatchUpdate();
    });

    // 监听 RTT 状态事件
    const unlistenStatus = listen<RttStatusEvent>("rtt-status", (event) => {
      const { running, error, phase, config } = event.payload;
      const store = useRttStore.getState();
      if (!running) {
        for (const channel of frameStreams.keys()) flushPendingChannel(channel, false);
        frameStreams.clear();
        for (const dispatcher of parseDispatchers.values()) dispatcher.reset();
        parseDispatchers.clear();
        scheduleBatchUpdate();
      } else if (phase === "recovering") {
        // 目标复位或重新烧录：旧固件残留的半帧不能拼到新固件的输出上
        for (const stream of frameStreams.values()) stream.reset();
        for (const dispatcher of parseDispatchers.values()) dispatcher.reset();
      }
      // 启动命令返回前，轮询线程的“已运行”事件不应提前结束启动中状态
      if (running && store.isStarting) return;
      const address = config?.control_block_address;
      const previous = store.rttInfo?.control_block_address;
      if (address != null && previous != null && address !== previous) {
        // Bootloader 跳转 App 等换了控制块：同样不能把旧固件的半帧拼到新输出上
        for (const stream of frameStreams.values()) stream.reset();
        useLogStore
          .getState()
          .addLog("info", `RTT 控制块已切换：${formatHexAddress(previous)} → ${formatHexAddress(address)}`);
      }
      setRunning(running);
      store.setPhase(running ? phase : null);
      if (config) store.applyConfig(config);
      if (error) {
        setError(error);
      }
    });

    // 清理
    return () => {
      unsubscribePause();
      for (const channel of frameStreams.keys()) flushPendingChannel(channel, false);
      frameStreams.clear();
      for (const timer of idleFlushTimers.values()) window.clearTimeout(timer);
      idleFlushTimers.clear();
      if (updateTimerRef.current !== null) {
        cancelAnimationFrame(updateTimerRef.current);
      }
      flushBatch();

      unlistenData.then((fn) => fn());
      unlistenStatus.then((fn) => fn());
    };
  }, [addLines, addBytes, setRunning, setError, addChartDataBatch, incrementParseCounts]);
}

/**
 * 获取 RTT 统计信息
 */
export function useRttStats() {
  const { lineCount, totalBytes, isRunning } = useRttStore(
    useShallow((state) => ({
      lineCount: state.lines.length,
      totalBytes: state.totalBytes,
      isRunning: state.isRunning,
    }))
  );

  return {
    lineCount,
    totalBytes,
    isRunning,
    bytesFormatted: formatBytes(totalBytes),
  };
}
