import { Crosshair, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { ChartConfig, TriggerCondition, TriggerConfig, TriggerMode, TriggerView } from "@/lib/chartTypes";
import { getVisibleYChannels } from "@/lib/chartTypes";

interface TriggerSettingsPanelProps {
  chartConfig: ChartConfig;
  setChartConfig: (config: ChartConfig) => void;
  /** 最近一次触发点时间戳；null 表示尚未触发 */
  triggeredAt: number | null;
  chartPaused: boolean;
  rearmTrigger: () => void;
}

const CONDITION_LABELS: Record<TriggerCondition, string> = {
  rising: "上升沿穿越",
  falling: "下降沿穿越",
  above: "高于电平",
  below: "低于电平",
};

const MODE_LABELS: Record<TriggerMode, string> = {
  single: "单次（触发后停住）",
  normal: "正常（反复触发）",
};

const VIEW_LABELS: Record<TriggerView, string> = {
  window: "只显示触发窗口",
  full: "显示全部并标注触发点",
};

/**
 * 触发捕获设置。三条数据来源共用。
 *
 * 状态指示从 chartPaused 与 triggeredAt 派生，不额外引入 store 状态——
 * 「采集中」是毫秒级瞬态，为它每批数据写一次 state 得不偿失。
 */
export function TriggerSettingsPanel({
  chartConfig,
  setChartConfig,
  triggeredAt,
  chartPaused,
  rearmTrigger,
}: TriggerSettingsPanelProps) {
  const trigger = chartConfig.trigger;
  const channels = getVisibleYChannels(chartConfig);
  const captured = triggeredAt !== null && chartPaused;

  const update = (patch: Partial<TriggerConfig>) => {
    setChartConfig({ ...chartConfig, trigger: { ...trigger, ...patch } });
  };

  // 通道列表变化后，原触发通道可能已不存在
  const channelMissing =
    trigger.enabled && trigger.channelKey !== "" && !channels.some((c) => c.key === trigger.channelKey);

  return (
    <div className="space-y-2.5 rounded-[16px] border border-border/60 bg-muted/20 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-medium tracking-[0.08em] text-muted-foreground">
          <Crosshair className="h-3.5 w-3.5" />
          触发捕获
        </div>
        <Switch checked={trigger.enabled} onCheckedChange={(enabled) => update({ enabled })} />
      </div>

      {trigger.enabled && (
        <>
          <div className="flex items-center gap-2">
            <span className="w-12 shrink-0 text-xs text-muted-foreground">通道</span>
            <Select value={trigger.channelKey} onValueChange={(channelKey) => update({ channelKey })}>
              <SelectTrigger className="h-8 flex-1 text-xs">
                <SelectValue placeholder="选择触发通道" />
              </SelectTrigger>
              <SelectContent>
                {channels.map((channel) => (
                  <SelectItem key={channel.key} value={channel.key}>
                    {channel.name || channel.key}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <span className="w-12 shrink-0 text-xs text-muted-foreground">条件</span>
            <Select
              value={trigger.condition}
              onValueChange={(condition) => update({ condition: condition as TriggerCondition })}
            >
              <SelectTrigger className="h-8 flex-1 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(CONDITION_LABELS) as TriggerCondition[]).map((condition) => (
                  <SelectItem key={condition} value={condition}>
                    {CONDITION_LABELS[condition]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <span className="w-12 shrink-0 text-xs text-muted-foreground">电平</span>
            <Input
              type="number"
              value={trigger.level}
              onChange={(e) => {
                const parsed = Number(e.target.value);
                update({ level: Number.isFinite(parsed) ? parsed : 0 });
              }}
              className="h-8 flex-1 text-xs font-mono"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="w-12 shrink-0 text-xs text-muted-foreground">样本</span>
            <Input
              type="number"
              min={1}
              value={trigger.preSamples}
              onChange={(e) => update({ preSamples: Math.max(1, parseInt(e.target.value, 10) || 1) })}
              className="h-8 w-20 text-xs"
              title="触发点之前保留多少个样本"
            />
            <span className="text-xs text-muted-foreground">前 /</span>
            <Input
              type="number"
              min={1}
              value={trigger.postSamples}
              onChange={(e) => update({ postSamples: Math.max(1, parseInt(e.target.value, 10) || 1) })}
              className="h-8 w-20 text-xs"
              title="触发点之后再采多少个样本"
            />
            <span className="text-xs text-muted-foreground">后</span>
          </div>

          <Select value={trigger.mode} onValueChange={(mode) => update({ mode: mode as TriggerMode })}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(MODE_LABELS) as TriggerMode[]).map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {MODE_LABELS[mode]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={trigger.view} onValueChange={(view) => update({ view: view as TriggerView })}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(VIEW_LABELS) as TriggerView[]).map((view) => (
                <SelectItem key={view} value={view}>
                  {VIEW_LABELS[view]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex items-center justify-between gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 text-xs",
                captured ? "text-amber-600" : "text-muted-foreground"
              )}
            >
              <span
                className={cn("h-1.5 w-1.5 rounded-full", captured ? "bg-amber-500" : "animate-pulse bg-emerald-500")}
              />
              {captured ? "已捕获，图表已冻结" : "等待触发"}
            </span>
            {captured && (
              <Button size="sm" variant="outline" onClick={rearmTrigger} className="gap-1">
                <RotateCcw className="h-3.5 w-3.5" />
                重新武装
              </Button>
            )}
          </div>

          {channels.length === 0 && (
            <div className="text-xs leading-4 text-amber-600">尚未配置任何可见通道，触发无法工作。</div>
          )}
          {channelMissing && (
            <div className="text-xs leading-4 text-amber-600">
              触发通道「{trigger.channelKey}」已不在当前通道列表中，请重新选择。
            </div>
          )}

          <div className="text-xs leading-4 text-muted-foreground">
            边沿条件只在数值穿越电平的那一刻成立，因此在电平附近抖动不会反复触发。
          </div>
        </>
      )}
    </div>
  );
}
