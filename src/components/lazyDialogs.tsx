// 低频大对话框的按需加载入口。
//
// 图表配置（含协议设计器）只有用户点开时才用到，却会经由侧栏被静态 import 进首屏 chunk。
// 这里把触发按钮留在首屏，对话框本体在第一次打开时才加载；打开过一次后保持挂载，
// 这样关闭动画和下次打开都不受影响。
import { cloneElement, isValidElement, lazy, Suspense, useState, type MouseEvent, type ReactElement } from "react";
import { useMountedAfterOpen } from "@/hooks/useMountedAfterOpen";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ChartConfigDialogProps } from "@/components/rtt/ChartConfigDialog";

const ChartConfigDialogImpl = lazy(() =>
  import("@/components/rtt/ChartConfigDialog").then((m) => ({ default: m.ChartConfigDialog }))
);

export function LazyChartConfigDialog({
  trigger = (
    <Button size="sm" variant="outline" className="gap-1">
      <Settings className="h-3.5 w-3.5" />
      配置图表
    </Button>
  ),
  open: controlledOpen,
  onOpenChange,
  ...rest
}: ChartConfigDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const mounted = useMountedAfterOpen(open);

  const setOpen = (nextOpen: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  // 本体懒加载后触发按钮由这里渲染，点击时直接切到受控 open
  const triggerElement = isValidElement<{ onClick?: (event: MouseEvent) => void }>(trigger)
    ? cloneElement(trigger as ReactElement<{ onClick?: (event: MouseEvent) => void }>, {
        onClick: (event: MouseEvent) => {
          trigger.props.onClick?.(event);
          setOpen(true);
        },
      })
    : null;

  return (
    <>
      {triggerElement}
      {mounted && (
        <Suspense fallback={null}>
          <ChartConfigDialogImpl {...rest} trigger={null} open={open} onOpenChange={setOpen} />
        </Suspense>
      )}
    </>
  );
}
