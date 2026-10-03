import type { ComponentType } from "react";
import { BarChart3, Columns2, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon: ComponentType<{ className?: string }>;
  title?: string;
}

interface SegmentedControlProps<T extends string> {
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  "aria-label"?: string;
}

/** 工具栏里互斥的视图切换：图标 + 文字，外框包成一组，各工作台保持同一外观 */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  "aria-label": ariaLabel,
}: SegmentedControlProps<T>) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex items-center rounded-lg border border-border/60 p-0.5">
      {options.map(({ value: optionValue, label, icon: Icon, title }) => (
        <Button
          key={optionValue}
          size="sm"
          variant={value === optionValue ? "secondary" : "ghost"}
          className="h-7 gap-1 px-2"
          aria-pressed={value === optionValue}
          title={title}
          onClick={() => onChange(optionValue)}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </Button>
      ))}
    </div>
  );
}

export type DataViewMode = "text" | "split" | "chart";

const DATA_VIEW_OPTIONS: readonly SegmentedOption<DataViewMode>[] = [
  { value: "text", label: "文本", icon: FileText, title: "仅文本" },
  { value: "split", label: "分屏", icon: Columns2, title: "文本 + 图表分屏" },
  { value: "chart", label: "图表", icon: BarChart3, title: "仅图表" },
];

/** 串口 / RTT / 蓝牙 / 日志分析共用的「文本 · 分屏 · 图表」切换 */
export function DataViewSwitch({ value, onChange }: { value: DataViewMode; onChange: (value: DataViewMode) => void }) {
  return <SegmentedControl value={value} options={DATA_VIEW_OPTIONS} onChange={onChange} aria-label="数据视图" />;
}
