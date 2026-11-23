// 触发捕获：等待某个条件成立，然后冻结住那一刻前后的一段数据。
//
// 解决的问题：现在图表是滚动窗口，想抓一次瞬时现象（电机堵转、某值越限、
// 异常帧）只能一直盯着，而且缓冲区可能早就把它挤掉了。
//
// 关键前提：**滚动缓冲区本身就是预触发缓冲**。chartData 一直保留最近
// maxDataPoints 个样本，所以"触发点之前的数据"天然已经在手里，
// 不需要另建环形缓冲——这让实现从"造基础设施"缩成"加一个状态机"。
//
// 状态机（触发发生时后置样本还没到，所以不能一步到位）：
//   待触发 --条件成立--> 采集中 --凑够后置样本--> 已触发（冻结）
//      ^                                            |
//      +------------ 正常模式自动重新待触发 ---------+

import type { TelemetrySample } from "./telemetry";
import type { TriggerCondition, TriggerConfig } from "./chartTypes";

export type TriggerState = "idle" | "armed" | "capturing" | "triggered";

export interface TriggerStatus {
  state: TriggerState;
  /** 采集中时还差多少个后置样本 */
  remainingPostSamples: number;
  /** 已完成的捕获次数 */
  captureCount: number;
  /**
   * 触发那一刻样本的时间戳；尚未触发过时为 null。
   * 用时间戳而非下标标记触发点，因为滚动缓冲区会从头部裁剪，下标会失效。
   */
  triggeredAt: number | null;
  /**
   * 最近一批样本里，完成捕获的那个样本之后还跟着多少个样本。
   * 一批数据可能在捕获完成后还有剩余（单次模式直接丢弃不处理，正常模式继续等下一次），
   * 切触发窗口时要从缓冲区末尾退回这么多个，窗口才正好结束在最后一个后置样本上。
   */
  trailingSamples: number;
}

/**
 * 判断单个样本对是否满足触发条件。
 *
 * 边沿用「前一个样本在一侧、当前样本在另一侧」判定：每次穿越只会成立一次，
 * 因此不需要额外的去抖或迟滞。电平条件则是逐样本判断，会持续成立——
 * 由状态机保证一次捕获期间不重复触发。
 */
export function matchesTrigger(
  previous: number | undefined,
  current: number,
  condition: TriggerCondition,
  level: number
): boolean {
  if (!Number.isFinite(current)) return false;

  switch (condition) {
    case "above":
      return current > level;
    case "below":
      return current < level;
    case "rising":
      // 没有前一个样本时无法判断穿越，不触发——否则一启动就会误触发
      if (previous === undefined || !Number.isFinite(previous)) return false;
      return previous <= level && current > level;
    case "falling":
      if (previous === undefined || !Number.isFinite(previous)) return false;
      return previous >= level && current < level;
  }
}

/**
 * 触发检测状态机。只负责「什么时候该冻结」，不持有数据本身——
 * 数据从调用方的滚动缓冲区里取，避免重复保存一份。
 */
export class TriggerDetector {
  private state: TriggerState = "idle";
  private remainingPost = 0;
  private captureCount = 0;
  /** 上一个样本在触发通道上的值，用于边沿判定 */
  private previousValue: number | undefined;
  /** 触发那一刻样本的时间戳 */
  private triggeredAt: number | null = null;
  /** 最近一次完成捕获时，本批中排在完成样本之后的样本数 */
  private trailingSamples = 0;

  getStatus(): TriggerStatus {
    return {
      state: this.state,
      remainingPostSamples: this.remainingPost,
      captureCount: this.captureCount,
      triggeredAt: this.triggeredAt,
      trailingSamples: this.trailingSamples,
    };
  }

  /** 进入待触发状态。重新武装时调用。 */
  arm(): void {
    this.state = "armed";
    this.remainingPost = 0;
    this.previousValue = undefined;
    this.trailingSamples = 0;
  }

  /** 完全复位，含捕获计数。 */
  reset(): void {
    this.state = "idle";
    this.remainingPost = 0;
    this.captureCount = 0;
    this.previousValue = undefined;
    this.triggeredAt = null;
    this.trailingSamples = 0;
  }

  /**
   * 喂入一批新样本，推进状态机。
   *
   * @returns 本批处理完后是否刚好完成一次捕获（调用方据此冻结图表并取数据）
   */
  push(samples: TelemetrySample[], config: TriggerConfig): boolean {
    if (!config.enabled) {
      if (this.state !== "idle") this.reset();
      return false;
    }
    // 触发通道未配置或不存在时不工作，但保持状态不变，等用户配好
    if (!config.channelKey) return false;

    if (this.state === "idle") this.arm();
    if (this.state === "triggered") return false; // 已捕获，等待手动重新武装

    let completed = false;

    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index];
      const value = sample.values[config.channelKey];
      let finished = false;

      if (this.state === "armed") {
        if (value !== undefined && matchesTrigger(this.previousValue, value, config.condition, config.level)) {
          this.state = "capturing";
          this.triggeredAt = sample.timestamp;
          // 触发点本身算作已采到的第一个后置样本
          this.remainingPost = Math.max(0, config.postSamples - 1);
          finished = this.remainingPost === 0;
        }
      } else if (this.state === "capturing") {
        this.remainingPost -= 1;
        finished = this.remainingPost <= 0;
      }

      if (finished) {
        completed = this.complete(config);
        this.trailingSamples = samples.length - 1 - index;
      }

      if (value !== undefined && Number.isFinite(value)) this.previousValue = value;
      // 用方法而非直接读 this.state：complete() 里的赋值在控制流分析中不可见，
      // 直接比较会被 TS 判成恒假
      if (this.isTriggered()) break; // 单次模式捕获完就停，本批剩余样本不再处理
    }

    return completed;
  }

  private isTriggered(): boolean {
    return this.state === "triggered";
  }

  private complete(config: TriggerConfig): boolean {
    this.captureCount += 1;
    this.remainingPost = 0;
    if (config.mode === "normal") {
      // 正常模式立刻重新武装；previousValue 保留，避免刚好卡在电平上时漏掉下一次穿越
      this.state = "armed";
    } else {
      this.state = "triggered";
    }
    return true;
  }
}

/**
 * 捕获完成后从滚动缓冲区里切出触发窗口。
 *
 * 传入的缓冲区末尾应是本次捕获的最后一个后置样本（stepTriggerCapture 会先退回
 * 同批中排在捕获终点之后的样本），因此窗口是末尾往前 preSamples + postSamples 个。
 * 缓冲区不够长时能取多少取多少，不足不是错误。
 */
export function sliceTriggerWindow(buffer: TelemetrySample[], config: TriggerConfig): TelemetrySample[] {
  const windowSize = Math.max(1, config.preSamples + config.postSamples);
  return buffer.length <= windowSize ? buffer.slice() : buffer.slice(-windowSize);
}

export interface TriggerCaptureResult {
  /** 捕获完成后应当显示的数据 */
  data: TelemetrySample[];
  /**
   * 触发点时间戳，供绘制标记。
   * 两种视图下都给出——窗口模式同样需要知道事件落在窗口的哪个位置。
   */
  triggeredAt: number | null;
}

/**
 * 按用户选择的视图模式解析捕获结果。
 *
 * window 与 full 是两种真实用法：抓瞬态时想聚焦事件本身，看趋势时想保留上下文。
 * 两者用的是同一份缓冲区数据，差别只在切不切。
 */
export function resolveTriggerCapture(
  buffer: TelemetrySample[],
  config: TriggerConfig,
  triggeredAt: number | null
): TriggerCaptureResult {
  return {
    data: config.view === "window" ? sliceTriggerWindow(buffer, config) : buffer.slice(),
    triggeredAt,
  };
}

/** 一次捕获冻结下来的画面：原始与滤波后两份，按同一窗口切出、逐点对齐。 */
export interface TriggerSnapshot {
  chartData: TelemetrySample[];
  processedChartData: TelemetrySample[];
}

/** 供 store 直接展开进 setState 的补丁；无事发生时为 null。 */
export interface TriggerStorePatch {
  triggerCapture: TriggerSnapshot;
  chartPaused: boolean;
  triggeredAt: number | null;
}

/**
 * 把「喂样本 → 判断是否捕获完成 → 按视图模式取数据」串成一步，
 * 供三条来源的 store 各调一次，避免同样的二十行在三处各写一遍。
 *
 * 触发判断用的是**滤波后**的数值：用户是对着图上显示的波形设触发电平的，
 * 若拿原始值判断，开了滤波之后就会在"看起来还没越过电平"的时刻触发。
 *
 * 捕获结果单独放进 triggerCapture 快照，滚动缓冲区本身不裁剪：
 * 冻结画面直接显示快照（就是触发窗口本身，而不是冻结前的上一帧），
 * 后台缓冲继续完整滚动，恢复跟随后历史不丢，正常模式下一次捕获也有足够的预触发数据。
 * 原始与滤波后两份快照必须按同样的窗口裁剪，否则开了滤波时窗口模式不生效。
 *
 * @param rawBuffer 追加新样本之后的原始缓冲区
 * @param processedBuffer 与 rawBuffer 等长的滤波后缓冲区
 * @param incomingCount 本批新增的样本数
 * @returns 需要写入 store 的补丁；未完成捕获时返回 null，调用方保持原状
 */
export function stepTriggerCapture(
  detector: TriggerDetector,
  rawBuffer: TelemetrySample[],
  processedBuffer: TelemetrySample[],
  incomingCount: number,
  config: TriggerConfig
): TriggerStorePatch | null {
  // 取滤波后缓冲区的尾部作为本批样本，保证判断依据与显示一致
  const incoming = incomingCount > 0 ? processedBuffer.slice(-incomingCount) : [];
  if (!detector.push(incoming, config)) return null;

  const { triggeredAt, trailingSamples } = detector.getStatus();
  // 本批中排在捕获终点之后的样本不属于这次捕获，先从末尾退回到终点再切窗口
  const untilCaptureEnd = (buffer: TelemetrySample[]) =>
    trailingSamples > 0 ? buffer.slice(0, Math.max(0, buffer.length - trailingSamples)) : buffer;
  const raw = resolveTriggerCapture(untilCaptureEnd(rawBuffer), config, triggeredAt);
  const processed = resolveTriggerCapture(untilCaptureEnd(processedBuffer), config, triggeredAt);

  return {
    triggerCapture: { chartData: raw.data, processedChartData: processed.data },
    // 捕获完成即冻结，复用图表既有的暂停机制
    chartPaused: true,
    triggeredAt,
  };
}
