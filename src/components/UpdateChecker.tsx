import { cloneElement, isValidElement, lazy, Suspense, useCallback, useState, useEffect, useRef } from "react";
import { check, type Update, type DownloadEvent } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Download, RefreshCw, CheckCircle } from "lucide-react";
import { useLogStore } from "@/stores/logStore";

// 发布说明的 Markdown 渲染链路（react-markdown + remark-gfm）体积约 370KB，
// 只在弹出更新对话框时才用到，拆成独立 chunk 按需加载，不进首屏。
const ReleaseNotes = lazy(() => import("./ReleaseNotes"));

interface UpdateCheckerProps {
  autoCheck?: boolean;
  showTrigger?: boolean;
  trigger?: React.ReactNode;
}

export function UpdateChecker({ autoCheck = true, showTrigger = true, trigger }: UpdateCheckerProps) {
  const [checking, setChecking] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<Update | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const addLog = useLogStore((state) => state.addLog);
  const downloadedBytesRef = useRef(0);

  const checkForUpdates = useCallback(
    async (silent = false) => {
      try {
        setChecking(true);
        if (!silent) {
          addLog("info", "正在检查更新...");
        }

        const update = await check();

        if (update) {
          setUpdateInfo(update);
          setDialogOpen(true);
          addLog("success", `发现新版本: ${update.version}`);
        } else if (!silent) {
          addLog("info", "当前已是最新版本");
        }
      } catch (error) {
        // 静默模式下不显示错误(启动时检查)
        if (!silent) {
          addLog("error", `检查更新失败: ${error}`);
        }
      } finally {
        setChecking(false);
      }
    },
    [addLog]
  );

  // 启动时自动检查更新(静默模式)
  useEffect(() => {
    if (autoCheck) {
      void checkForUpdates(true);
    }
  }, [autoCheck, checkForUpdates]);

  const downloadAndInstall = async () => {
    if (!updateInfo) return;
    downloadedBytesRef.current = 0;

    try {
      setDownloading(true);
      addLog("info", "开始下载更新...");

      await updateInfo.downloadAndInstall((event: DownloadEvent) => {
        switch (event.event) {
          case "Started": {
            const data = event.data as { contentLength?: number };
            downloadedBytesRef.current = 0; // 重置累计字节
            if (data.contentLength) {
              addLog("info", `开始下载: ${data.contentLength} 字节`);
            }
            break;
          }
          case "Progress": {
            const data = event.data as { chunkLength: number; contentLength: number };
            downloadedBytesRef.current += data.chunkLength;
            const progress = data.contentLength > 0 ? (downloadedBytesRef.current / data.contentLength) * 100 : 0;
            setDownloadProgress(Math.min(progress, 100));
            break;
          }
          case "Finished":
            setDownloadProgress(100);
            addLog("success", "下载完成，准备安装...");
            break;
        }
      });

      addLog("success", "更新安装完成，即将重启应用...");

      // 等待2秒后重启
      setTimeout(async () => {
        await relaunch();
      }, 2000);
    } catch (error) {
      addLog("error", `更新失败: ${error}`);
      setDownloading(false);
    }
  };

  return (
    <>
      {showTrigger &&
        (trigger && isValidElement(trigger) ? (
          cloneElement(trigger, {
            onClick: () => checkForUpdates(false),
            disabled: checking || downloading || (trigger.props as { disabled?: boolean }).disabled,
          })
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => checkForUpdates(false)}
            disabled={checking || downloading}
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${checking ? "animate-spin" : ""}`} />
            {checking ? "检查中..." : "检查更新"}
          </Button>
        ))}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {downloading ? (
                <>
                  <Download className="h-5 w-5 text-blue-500" />
                  正在下载更新
                </>
              ) : (
                <>
                  <CheckCircle className="h-5 w-5 text-green-500" />
                  发现新版本
                </>
              )}
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 mt-2">
                {updateInfo && (
                  <>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">当前版本:</span>
                      <span className="font-mono">{updateInfo.currentVersion}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">最新版本:</span>
                      <span className="font-mono text-green-600">{updateInfo.version}</span>
                    </div>
                    {updateInfo.body && (
                      <div className="mt-4">
                        <div className="text-sm font-medium mb-2">更新内容:</div>
                        <div className="glass-section rounded-2xl p-3 max-h-48 overflow-y-auto text-sm text-muted-foreground">
                          <Suspense fallback={<div className="whitespace-pre-wrap">{updateInfo.body}</div>}>
                            <ReleaseNotes markdown={updateInfo.body} />
                          </Suspense>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>

          {downloading && (
            <div className="space-y-2">
              <Progress value={downloadProgress} className="h-2" />
              <p className="text-xs text-center text-muted-foreground">{Math.round(downloadProgress)}%</p>
            </div>
          )}

          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={downloading}>
              稍后更新
            </Button>
            <Button onClick={downloadAndInstall} disabled={downloading} className="gap-2">
              {downloading ? (
                <>
                  <Download className="h-4 w-4 animate-bounce" />
                  下载中...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" />
                  立即更新
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
