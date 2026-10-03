import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Button } from "@/components/ui/button";
import { ArrowLeftRight, MonitorUp, X } from "lucide-react";
import { ChartViewer } from "./ChartViewer";
import type { ChartWorkspaceSnapshot, ChartWorkspaceSource } from "@/lib/chartWorkspace";
import { CHART_WORKSPACE_SNAPSHOT_EVENT, getChartWorkspaceWindowTitle } from "@/lib/chartWorkspace";
import { dispatchChartWorkspaceAction, notifyChartWorkspaceReady } from "@/hooks/useChartWorkspaceHost";

interface ChartWorkspaceWindowPageProps {
  source: ChartWorkspaceSource;
}

export function ChartWorkspaceWindowPage({ source }: ChartWorkspaceWindowPageProps) {
  const currentWindow = useMemo(() => getCurrentWebviewWindow(), []);
  const [snapshot, setSnapshot] = useState<ChartWorkspaceSnapshot | null>(null);
  const restoringRef = useRef(false);

  useEffect(() => {
    let active = true;
    const unlistenSnapshot = currentWindow.listen<ChartWorkspaceSnapshot>(
      CHART_WORKSPACE_SNAPSHOT_EVENT,
      ({ payload }) => {
        if (payload.source !== source) return;
        setSnapshot(payload);
      }
    );
    const unlistenCloseRequested = currentWindow.onCloseRequested(async () => {
      if (restoringRef.current) return;

      restoringRef.current = true;
      await dispatchChartWorkspaceAction({
        source,
        type: "restore-inline",
      }).catch(() => undefined);
    });

    void Promise.all([unlistenSnapshot, unlistenCloseRequested])
      .then(() => {
        if (active) return notifyChartWorkspaceReady(source);
      })
      .catch((error) => {
        console.error(`[图表窗口:${source}] 独立窗口事件初始化失败`, error);
      });

    return () => {
      active = false;
      void unlistenSnapshot.then((fn) => fn());
      void unlistenCloseRequested.then((fn) => fn());
    };
  }, [currentWindow, source]);

  const handleRestoreInline = async () => {
    restoringRef.current = true;
    await dispatchChartWorkspaceAction({
      source,
      type: "restore-inline",
    }).catch(() => undefined);
    await currentWindow.destroy().catch((error) => {
      console.error(`[图表窗口:${source}] 收回后销毁窗口失败`, error);
    });
  };

  const handleCloseWindow = async () => {
    restoringRef.current = true;
    await dispatchChartWorkspaceAction({
      source,
      type: "restore-inline",
    }).catch(() => undefined);
    await currentWindow.destroy().catch((error) => {
      console.error(`[图表窗口:${source}] 关闭窗口失败`, error);
    });
  };

  return (
    <div className="surface-strong flex h-screen flex-col gap-2 overflow-hidden p-3 text-foreground">
      <div className="flex items-center justify-between rounded-[26px] border border-border/60 bg-white/72 px-4 py-3 shadow-[0_12px_26px_rgba(73,93,142,0.08)] backdrop-blur">
        <div>
          <div className="text-sm font-medium text-foreground">
            {snapshot?.title ?? getChartWorkspaceWindowTitle(source)}
          </div>
          <div className="text-xs text-muted-foreground">
            {snapshot?.subtitle ?? "独立窗口模式。主窗口继续负责接收与状态同步。"}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="gap-1" onClick={handleRestoreInline}>
            <ArrowLeftRight className="h-3.5 w-3.5" />
            收回主窗口
          </Button>
          <Button size="sm" variant="outline" className="gap-1" onClick={handleCloseWindow}>
            <X className="h-3.5 w-3.5" />
            关闭
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-[30px]">
        {snapshot ? (
          <ChartViewer
            chartData={snapshot.chartData}
            processedData={snapshot.processedChartData ?? snapshot.chartData}
            filterActive={snapshot.filterActive}
            chartConfig={snapshot.chartConfig}
            chartPaused={snapshot.chartPaused}
            parseSuccessCount={snapshot.parseSuccessCount}
            parseFailCount={snapshot.parseFailCount}
            setChartPaused={(paused) =>
              void dispatchChartWorkspaceAction({
                source,
                type: "set-paused",
                paused,
              })
            }
            clearChartData={() =>
              void dispatchChartWorkspaceAction({
                source,
                type: "clear-data",
              })
            }
            setChartConfig={(config) =>
              void dispatchChartWorkspaceAction({
                source,
                type: "set-config",
                config,
              })
            }
          />
        ) : (
          <div className="flex h-full items-center justify-center rounded-[32px] border border-dashed border-border/80 bg-white/65">
            <div className="space-y-2 text-center">
              <MonitorUp className="mx-auto h-7 w-7 text-muted-foreground" />
              <div className="text-sm font-medium text-foreground">等待主窗口同步图表工作台…</div>
              <div className="text-xs text-muted-foreground">保持主窗口开启，独立窗口会自动接收当前图表状态。</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
