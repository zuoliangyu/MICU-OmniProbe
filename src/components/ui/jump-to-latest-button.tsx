import { ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";

/** 浮在日志区右下角：用户上翻暂停跟随时出现，点击回到底部并恢复自动滚动 */
export function JumpToLatestButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      size="sm"
      variant="secondary"
      className="absolute bottom-3 right-5 z-10 h-7 gap-1 px-2.5 shadow-md"
      onClick={onClick}
      title="已暂停自动滚动，点击回到最新数据"
    >
      <ArrowDown className="h-3.5 w-3.5" />
      回到最新
    </Button>
  );
}
