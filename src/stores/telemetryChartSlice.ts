// 串口、RTT 与蓝牙三条来源共用的图表切片。
//
// 这三个 store 此前各自维护一份几乎逐字相同的图表状态与动作，差别只有持久化键。
// 后果是每加一个图表侧功能（滤波、会话录制、接收分帧、触发捕获）都要在三处
// 各写一遍，全靠「三条来源逐个验」的测试兜底才没漏——这笔债只会越积越贵。
//
// 切片同时持有各自的滤波器与触发器实例。此前它们是三个 store 文件里的模块级
// 单例，语义上本就该「一条来源一份」，收进切片后这个约束由结构保证，
// 而不是靠三处各写一个 const。

import type { ChartConfig, ChartDataPoint } from "@/lib/chartTypes";
import { DEFAULT_CHART_CONFIG, migrateChartConfig } from "@/lib/chartTypes";
import { TelemetryFilterState, resolveTelemetryProcessing } from "@/lib/telemetry";
import { TriggerDetector, stepTriggerCapture } from "@/lib/triggerCapture";
import { loadFromStorage, saveToStorage } from "@/lib/storage";

export interface TelemetryChartState {
  /** 原始采样，始终保留未经滤波的数值 */
  chartData: ChartDataPoint[];
  /** 滤波后的共享处理结果；未启用滤波时与 chartData 同引用 */
  processedChartData: ChartDataPoint[];
  filterActive: boolean;
  chartConfig: ChartConfig;
  /** 图表是否冻结显示（后台仍继续接收） */
  chartPaused: boolean;
  parseSuccessCount: number;
  parseFailCount: number;
  /** 最近一次触发点的时间戳；供波形标记触发位置 */
  triggeredAt: number | null;

  addChartDataBatch: (points: ChartDataPoint[]) => void;
  clearChartData: () => void;
  setChartConfig: (config: ChartConfig) => void;
  setChartPaused: (paused: boolean) => void;
  incrementParseCounts: (success: number, fail: number) => void;
  /** 重新武装触发器：解冻并回到待触发 */
  rearmTrigger: () => void;
}

type SetState = (
  partial: Partial<TelemetryChartState> | ((state: TelemetryChartState) => Partial<TelemetryChartState>)
) => void;

export interface TelemetryChartSliceOptions {
  /** 图表配置的持久化键，各来源不同 */
  storageKey: string;
}

/** 追加样本产出的状态补丁。串口有自己的提交路径，需要单独取用这一步。 */
export type TelemetryAppendPatch = Partial<TelemetryChartState>;

export interface TelemetryChartSlice {
  state: TelemetryChartState;
  /**
   * 追加样本并返回状态补丁，不直接 set。
   *
   * 串口的实时数据走 commitSerialReceiveBatch（要同时处理终端文本、日志行、
   * 字节统计和自动建通道），没法复用 addChartDataBatch，因此把这一步单独导出。
   * 抽切片之前这里是漏的——触发捕获接在了 addChartDataBatch 上，
   * 而串口实时数据根本不走那条路。
   */
  appendSamples: (state: TelemetryChartState, incoming: ChartDataPoint[], config?: ChartConfig) => TelemetryAppendPatch;
}

/**
 * 生成一份图表切片。每次调用产出独立的滤波器与触发器实例，
 * 因此三个 store 之间不会互相串状态。
 */
export function createTelemetryChartSlice(
  set: SetState,
  { storageKey }: TelemetryChartSliceOptions
): TelemetryChartSlice {
  // 可变的采集状态，不参与渲染，因此不放进 store state
  const telemetryFilter = new TelemetryFilterState();
  const triggerDetector = new TriggerDetector();

  /** 追加样本 → 增量滤波 → 推进触发状态机，三者的顺序固定，故收在一处。 */
  const appendSamples = (
    state: TelemetryChartState,
    incoming: ChartDataPoint[],
    config: ChartConfig = state.chartConfig
  ): TelemetryAppendPatch => {
    const processing = telemetryFilter.append(
      state.chartData,
      incoming,
      config.maxDataPoints,
      config.channels,
      config.dataFilter
    );

    const triggerPatch = stepTriggerCapture(
      triggerDetector,
      processing.rawData,
      processing.processedData,
      incoming.length,
      config.trigger
    );

    return {
      chartData: triggerPatch?.chartData ?? processing.rawData,
      processedChartData: triggerPatch?.processedChartData ?? processing.processedData,
      filterActive: processing.filterActive,
      ...(triggerPatch ? { chartPaused: true, triggeredAt: triggerPatch.triggeredAt } : {}),
    };
  };

  const state: TelemetryChartState = {
    chartData: [],
    processedChartData: [],
    filterActive: false,
    chartConfig: migrateChartConfig(loadFromStorage(storageKey, DEFAULT_CHART_CONFIG)),
    chartPaused: false,
    parseSuccessCount: 0,
    parseFailCount: 0,
    triggeredAt: null,

    addChartDataBatch: (points) => set((state) => (points.length === 0 ? {} : appendSamples(state, points))),

    clearChartData: () => {
      // 两者都要复位：残留的滤波状态会让下一批数据接着旧历史算，
      // 残留的「已触发」状态会让清空后的数据永远不再触发。
      telemetryFilter.reset();
      triggerDetector.reset();
      set({
        chartData: [],
        processedChartData: [],
        filterActive: false,
        parseSuccessCount: 0,
        parseFailCount: 0,
        triggeredAt: null,
      });
    },

    setChartConfig: (config) => {
      const normalized = migrateChartConfig(config);
      saveToStorage(storageKey, normalized);
      set((state) => {
        // 配置可能调小了 maxDataPoints，先按新上限裁剪再重算
        const chartData = state.chartData.slice(-normalized.maxDataPoints);
        const processing = resolveTelemetryProcessing(chartData, normalized.channels, normalized.dataFilter);
        return {
          chartConfig: normalized,
          chartData: processing.rawData,
          processedChartData: processing.processedData,
          filterActive: processing.filterActive,
        };
      });
    },

    setChartPaused: (chartPaused) => set({ chartPaused }),

    incrementParseCounts: (success, fail) =>
      set((state) => {
        // 零增量直接返回，避免每帧无意义的 setState 唤醒所有订阅者
        if (success === 0 && fail === 0) return {};
        return {
          parseSuccessCount: state.parseSuccessCount + success,
          parseFailCount: state.parseFailCount + fail,
        };
      }),

    rearmTrigger: () => {
      triggerDetector.arm();
      set({ chartPaused: false, triggeredAt: null });
    },
  };

  return { state, appendSamples };
}
