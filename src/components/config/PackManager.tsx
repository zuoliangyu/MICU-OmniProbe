import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { listen } from "@tauri-apps/api/event";
import {
  importPack,
  listImportedPacks,
  deletePack,
  getPackScanReport,
  getPacksDirectory,
  setCustomPacksDirectory,
} from "@/lib/tauri";
import type { PackInfo, PackScanReport, AlgorithmStat, DeviceScanResult } from "@/lib/types";
import { useLogStore } from "@/stores/logStore";
import {
  Package,
  Upload,
  Trash2,
  ChevronDown,
  ChevronRight,
  FileText,
  AlertCircle,
  CheckCircle,
  FolderOpen,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Pack扫描进度类型
interface PackScanProgress {
  phase: string;
  current_item: string;
  current: number;
  total: number;
  progress: number;
  message: string;
}

// 阶段标签映射
function getPhaseLabel(phase: string): string {
  const labels: Record<string, string> = {
    Parsing: "解析PDSC",
    ExtractingDevices: "提取设备",
    FindingAlgorithms: "查找算法",
    MatchingAlgorithms: "匹配算法",
    GeneratingYaml: "生成配置",
    Registering: "注册设备",
    Complete: "完成",
  };
  return labels[phase] || phase;
}

export function PackManager() {
  const [packs, setPacks] = useState<PackInfo[]>([]);
  const [importing, setImporting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [scanProgress, setScanProgress] = useState<PackScanProgress | null>(null);
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [selectedPackReport, setSelectedPackReport] = useState<PackScanReport | null>(null);
  const [packsDirectory, setPacksDirectory] = useState<string>("");
  const [showDirectorySettings, setShowDirectorySettings] = useState(false);
  const addLog = useLogStore((state) => state.addLog);

  const loadPacksDirectory = useCallback(async () => {
    try {
      const dir = await getPacksDirectory();
      setPacksDirectory(dir);
    } catch (error) {
      addLog("error", `获取Pack目录失败: ${error}`);
    }
  }, [addLog]);

  // Load Pack directory
  useEffect(() => {
    void loadPacksDirectory();
  }, [loadPacksDirectory]);

  const handleChangeDirectory = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "选择Pack存储目录",
      });

      if (selected) {
        await setCustomPacksDirectory(selected as string);
        await loadPacksDirectory();
        addLog("success", `Pack目录已更改为: ${selected}`);
        addLog("info", "请重启应用以使更改生效");
      }
    } catch (error) {
      addLog("error", `更改Pack目录失败: ${error}`);
    }
  };

  const handleResetDirectory = async () => {
    try {
      await setCustomPacksDirectory(null);
      await loadPacksDirectory();
      addLog("success", "Pack目录已重置为默认位置");
      addLog("info", "请重启应用以使更改生效");
    } catch (error) {
      addLog("error", `重置Pack目录失败: ${error}`);
    }
  };

  // Listen for pack scan progress events
  useEffect(() => {
    const unlisten = listen<PackScanProgress>("pack-scan-progress", (event) => {
      setScanProgress(event.payload);

      // 当扫描完成时，清除进度显示
      if (event.payload.phase === "Complete") {
        setTimeout(() => {
          setScanProgress(null);
        }, 2000);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const loadPacks = useCallback(async () => {
    try {
      setLoading(true);
      const packList = await listImportedPacks();
      setPacks(packList);
    } catch (error) {
      addLog("error", `加载Pack列表失败: ${error}`);
    } finally {
      setLoading(false);
    }
  }, [addLog]);

  // Load imported Pack list
  useEffect(() => {
    void loadPacks();
  }, [loadPacks]);

  // Import multiple Pack files
  const importMultiplePacks = useCallback(
    async (filePaths: string[]) => {
      if (filePaths.length === 0) return;

      setImporting(true);
      addLog("info", `开始导入 ${filePaths.length} 个Pack文件...`);

      let successCount = 0;
      let failCount = 0;

      for (const filePath of filePaths) {
        try {
          const packInfo = await importPack(filePath);
          addLog("success", `成功导入: ${packInfo.name} v${packInfo.version}`);
          successCount++;
        } catch (error) {
          addLog("error", `导入失败 ${filePath.split(/[\\/]/).pop()}: ${error}`);
          failCount++;
        }
      }

      if (successCount > 0) {
        addLog("info", `导入完成: ${successCount} 成功, ${failCount} 失败`);
        await loadPacks();
      }

      setImporting(false);
    },
    [addLog, loadPacks]
  );

  // Listen for file drag-drop events
  useEffect(() => {
    const webview = getCurrentWebviewWindow();

    const unlisten = webview.onDragDropEvent(async (event) => {
      if (event.payload.type === "enter") {
        // Check if any dragged file is a .pack file
        const paths = event.payload.paths || [];
        const hasPackFile = paths.some((p: string) => p.toLowerCase().endsWith(".pack"));
        if (hasPackFile) {
          setIsDragging(true);
          // Auto-expand when dragging pack files
          setIsOpen(true);
        }
      } else if (event.payload.type === "drop") {
        setIsDragging(false);
        const paths = event.payload.paths || [];
        const packFiles = paths.filter((p: string) => p.toLowerCase().endsWith(".pack"));

        if (packFiles.length > 0) {
          await importMultiplePacks(packFiles);
        }
      } else if (event.payload.type === "leave") {
        setIsDragging(false);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [importMultiplePacks]);

  // Import Pack file via dialog (supports multiple files)
  const handleImport = async () => {
    try {
      const selected = await open({
        filters: [{ name: "CMSIS Pack", extensions: ["pack"] }],
        multiple: true,
      });

      if (selected) {
        const files = Array.isArray(selected) ? selected : [selected];
        await importMultiplePacks(files);
      }
    } catch (error) {
      addLog("error", `导入Pack失败: ${error}`);
    }
  };

  // Delete Pack
  const handleDelete = async (packName: string) => {
    addLog("info", `准备删除Pack: ${packName}`);

    if (!confirm(`确定要删除Pack "${packName}" 吗？\n\n删除后需要重新导入才能使用。`)) {
      addLog("info", "取消删除操作");
      return;
    }

    try {
      addLog("info", `正在删除Pack: ${packName}`);
      await deletePack(packName);
      addLog("success", `成功删除Pack: ${packName}`);
      await loadPacks();
    } catch (error) {
      addLog("error", `删除Pack失败: ${error}`);
    }
  };

  // View scan report
  const handleViewReport = async (packName: string) => {
    try {
      const report = await getPackScanReport(packName);
      setSelectedPackReport(report);
      setReportDialogOpen(true);
    } catch (error) {
      addLog("error", `加载扫描报告失败: ${error}`);
    }
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card
        className={cn(
          "transition-all duration-200",
          isDragging && "ring-2 ring-primary ring-offset-2 ring-offset-background"
        )}
      >
        <CollapsibleTrigger asChild>
          <CardHeader className="py-3 cursor-pointer hover:bg-accent/50 transition-colors">
            <div className="flex items-center justify-between">
              <div className="flex min-w-0 items-center gap-2">
                <Package className="h-4 w-4" />
                <CardTitle className="truncate whitespace-nowrap text-sm" title="CMSIS-Pack 管理">
                  Pack 管理
                </CardTitle>
                {packs.length > 0 && <span className="text-xs text-muted-foreground">({packs.length})</span>}
              </div>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowDirectorySettings(!showDirectorySettings);
                  }}
                  className="gap-1 h-7"
                  title="Pack 目录设置"
                  aria-label="Pack 目录设置"
                >
                  <Settings className="h-3 w-3" />
                </Button>
                <Button
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleImport();
                  }}
                  disabled={importing || loading}
                  className="gap-1 h-7"
                >
                  <Upload className="h-3 w-3" />
                  {importing ? "导入中..." : "导入"}
                </Button>
                {isOpen ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="space-y-2">
            {/* Pack目录设置 */}
            {showDirectorySettings && (
              <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Pack存储目录</span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={handleChangeDirectory} className="h-7 gap-1">
                      <FolderOpen className="h-3 w-3" />
                      更改目录
                    </Button>
                    <Button size="sm" variant="outline" onClick={handleResetDirectory} className="h-7">
                      重置
                    </Button>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground break-all bg-background/50 p-2 rounded">
                  {packsDirectory || "加载中..."}
                </div>
                <p className="text-xs text-muted-foreground">更改Pack目录后需要重启应用才能生效</p>
              </div>
            )}

            {/* Drag-drop hint */}
            {isDragging && (
              <div className="border-2 border-dashed border-primary rounded-lg p-4 text-center bg-primary/5">
                <Upload className="h-6 w-6 mx-auto mb-2 text-primary animate-bounce" />
                <p className="text-sm text-primary font-medium">释放以导入 Pack 文件</p>
              </div>
            )}

            {/* Pack scan progress */}
            {scanProgress && (
              <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">扫描进度</span>
                  <span className="text-xs text-muted-foreground">{Math.round(scanProgress.progress * 100)}%</span>
                </div>
                <Progress value={scanProgress.progress * 100} className="h-2" />
                <div className="text-xs text-muted-foreground space-y-1">
                  <div className="flex items-center justify-between">
                    <span>阶段: {getPhaseLabel(scanProgress.phase)}</span>
                    {scanProgress.current > 0 && scanProgress.total > 0 && (
                      <span>
                        {scanProgress.current}/{scanProgress.total}
                      </span>
                    )}
                  </div>
                  {scanProgress.current_item && <div className="truncate">当前: {scanProgress.current_item}</div>}
                  <div>{scanProgress.message}</div>
                </div>
              </div>
            )}

            {loading ? (
              <div className="text-center text-sm text-muted-foreground py-4">加载中...</div>
            ) : packs.length === 0 && !isDragging ? (
              <div className="text-center text-sm text-muted-foreground py-4">
                <p>暂无已导入的 Pack 包</p>
                <p className="text-xs mt-1">点击导入按钮或拖放 .pack 文件到此处</p>
              </div>
            ) : (
              packs.map((pack) => (
                <div key={pack.name} className="border rounded-lg p-3 space-y-2 hover:bg-muted/50 transition-colors">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="font-medium text-sm">{pack.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {pack.vendor} • v{pack.version}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleViewReport(pack.name);
                        }}
                        title="查看扫描报告"
                      >
                        <FileText className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-destructive"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleDelete(pack.name);
                        }}
                        title="删除Pack"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                  {pack.description && (
                    <div className="text-xs text-muted-foreground line-clamp-2">{pack.description}</div>
                  )}
                  <div className="text-xs text-muted-foreground">包含 {pack.device_count} 个设备</div>
                </div>
              ))
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>

      {/* Scan Report Dialog */}
      <Dialog open={reportDialogOpen} onOpenChange={setReportDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto p-7">
          <DialogHeader>
            <DialogTitle>Pack 扫描报告</DialogTitle>
            <DialogDescription>
              {selectedPackReport && `${selectedPackReport.pack_name} - ${selectedPackReport.scan_time}`}
            </DialogDescription>
          </DialogHeader>

          {selectedPackReport && (
            <div className="space-y-4">
              {/* Statistics Cards */}
              <div className="grid grid-cols-3 gap-4">
                <div className="glass-section rounded-2xl p-3 text-center">
                  <div className="text-2xl font-bold">{selectedPackReport.total_devices}</div>
                  <div className="text-xs text-muted-foreground">总设备数</div>
                </div>
                <div className="glass-section rounded-2xl p-3 text-center">
                  <div className="text-2xl font-bold text-green-600">{selectedPackReport.devices_with_algo}</div>
                  <div className="text-xs text-muted-foreground">有算法</div>
                </div>
                <div className="glass-section rounded-2xl p-3 text-center">
                  <div className="text-2xl font-bold text-yellow-600">{selectedPackReport.devices_without_algo}</div>
                  <div className="text-xs text-muted-foreground">无算法</div>
                </div>
              </div>

              {/* Algorithm Statistics */}
              {selectedPackReport.algorithm_stats.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-medium">算法使用统计</h3>
                  <div className="space-y-1">
                    {selectedPackReport.algorithm_stats.slice(0, 5).map((stat: AlgorithmStat) => (
                      <div
                        key={stat.algorithm_name}
                        className="glass-section flex items-center justify-between rounded-2xl p-2 text-xs"
                      >
                        <span className="font-mono">{stat.algorithm_name}</span>
                        <span className="text-muted-foreground">{stat.device_count} 个设备</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Devices without algorithm */}
              {selectedPackReport.devices_without_algo > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-medium flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-yellow-600" />
                    无算法的设备
                  </h3>
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {selectedPackReport.devices
                      .filter((d: DeviceScanResult) => d.status === "Warning")
                      .slice(0, 20)
                      .map((device: DeviceScanResult) => (
                        <div key={device.name} className="glass-section rounded-2xl p-2 text-xs">
                          <div className="font-medium">{device.name}</div>
                          <div className="text-muted-foreground">
                            {device.core} • Flash: {(device.flash_size / 1024).toFixed(0)}KB
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* All devices summary */}
              <div className="space-y-2">
                <h3 className="text-sm font-medium">设备列表</h3>
                <div className="text-xs text-muted-foreground">
                  共 {selectedPackReport.total_devices} 个设备
                  {selectedPackReport.devices_with_algo > 0 && (
                    <span className="ml-2 text-green-600">
                      <CheckCircle className="inline h-3 w-3 mr-1" />
                      {selectedPackReport.devices_with_algo} 个已配置算法
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Collapsible>
  );
}
