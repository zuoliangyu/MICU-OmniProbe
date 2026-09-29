import { lazy, Suspense, useState } from "react";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMountedAfterOpen } from "@/hooks/useMountedAfterOpen";

// 设置中心只在点开时才需要，本体按需加载，不进首屏 chunk。
const SettingsCenterDialog = lazy(() => import("./SettingsCenterDialog"));

export function SettingsCenterButton() {
  const [open, setOpen] = useState(false);
  const mounted = useMountedAfterOpen(open);

  return (
    <>
      <Button size="sm" variant="outline" className="gap-2 px-3" title="打开设置中心" onClick={() => setOpen(true)}>
        <Settings2 className="h-4 w-4" />
        <span>设置</span>
      </Button>
      {mounted && (
        <Suspense fallback={null}>
          <SettingsCenterDialog open={open} onOpenChange={setOpen} />
        </Suspense>
      )}
    </>
  );
}
