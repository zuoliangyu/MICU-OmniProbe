import { lazy, Suspense, useState } from "react";
import { BookOpen, GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMountedAfterOpen } from "@/hooks/useMountedAfterOpen";
import { WORKSPACE_BY_MODE } from "@/components/modes/workspaceRegistry";
import { useAppStore } from "@/stores/appStore";
import { openUserDocs, workspaceDocUrl } from "@/lib/userDocs";

// 接入指南只在点开时才需要，本体按需加载，不进首屏 chunk。
const RttIntegrationGuideDialog = lazy(() =>
  import("@/components/rtt/RttIntegrationGuideDialog").then((m) => ({ default: m.RttIntegrationGuideDialog }))
);

/** 顶栏右上角的帮助入口：RTT 固件接入指南 + 当前工作台的使用教程。 */
export function HelpButtons() {
  const mode = useAppStore((state) => state.mode);
  const [guideOpen, setGuideOpen] = useState(false);
  const guideMounted = useMountedAfterOpen(guideOpen);
  const workspaceLabel = WORKSPACE_BY_MODE[mode].label;

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="gap-2 px-3"
        title="查看如何在固件里接入 SEGGER RTT"
        onClick={() => setGuideOpen(true)}
      >
        <BookOpen className="h-4 w-4" />
        <span>接入指南</span>
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="gap-2 px-3"
        title={`在浏览器中打开「${workspaceLabel}」使用教程`}
        onClick={() => openUserDocs(workspaceDocUrl(mode))}
      >
        <GraduationCap className="h-4 w-4" />
        <span>使用教程</span>
      </Button>
      {guideMounted && (
        <Suspense fallback={null}>
          <RttIntegrationGuideDialog open={guideOpen} onOpenChange={setGuideOpen} />
        </Suspense>
      )}
    </>
  );
}
