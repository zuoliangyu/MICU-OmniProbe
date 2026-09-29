import { lazy, Suspense, useState } from "react";
import { Binary } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMountedAfterOpen } from "@/hooks/useMountedAfterOpen";
import type { BinaryProtocolDesignerProps } from "./BinaryProtocolDesignerDialog";

// 设计器本体 1000 余行，只有点开时才用到，按需加载，不进首屏 chunk。
const BinaryProtocolDesignerDialog = lazy(() => import("./BinaryProtocolDesignerDialog"));

export function BinaryProtocolDesigner(props: BinaryProtocolDesignerProps) {
  const [open, setOpen] = useState(false);
  // 每次打开换一个 key，让对话框按当前 value / 样本 / 协议库重新初始化草稿
  const [session, setSession] = useState(0);
  const mounted = useMountedAfterOpen(open);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="w-full justify-start gap-2"
        onClick={() => {
          setSession((current) => current + 1);
          setOpen(true);
        }}
      >
        <Binary className="h-4 w-4" />
        打开协议设计器
      </Button>
      {mounted && (
        <Suspense fallback={null}>
          <BinaryProtocolDesignerDialog key={session} {...props} open={open} onOpenChange={setOpen} />
        </Suspense>
      )}
    </>
  );
}
