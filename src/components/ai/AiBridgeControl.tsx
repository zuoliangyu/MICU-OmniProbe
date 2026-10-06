import { useEffect, useState } from "react";
import { Bot, Copy, PackageOpen, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { useLogStore } from "@/stores/logStore";
import { useAiBridgeStore } from "@/stores/aiBridgeStore";
import { AI_SOURCE_LABELS, type AiSource } from "@/lib/aiBridge";
import { getAiBridgeStatus, setAiBridgeWriteEnabled, startAiBridge, stopAiBridge } from "@/lib/tauri";

// 沿用最早串口版本的存储键，升级后保留用户设置的端口
const PORT_KEY = "serial_ai_bridge_port";
const SKILL_URL = "https://github.com/zuoliangyu/MICU-OmniProbe/tree/main/skills/micu-omniprobe-ai";

const WRITE_TARGET_TEXT: Record<AiSource, { title: string; hint: string }> = {
  serial: { title: "允许 AI 写串口", hint: "默认关闭；开启后单条最多 1024 字节" },
  rtt: { title: "允许 AI 写 RTT 下行通道", hint: "默认关闭；固件需调用 SEGGER_RTT_Read 读取" },
  ble: { title: "允许 AI 写蓝牙特征值", hint: "默认关闭；写入当前选中的可写特征值" },
};

function savedPort(): number {
  const value = Number(localStorage.getItem(PORT_KEY));
  return Number.isInteger(value) && value >= 1024 ? value : 8765;
}

interface AiBridgeControlProps {
  source: AiSource;
  /** 当前工作台是否启用了数据解析；未启用时 AI 只能收到文本行 */
  parsingEnabled: boolean;
}

export function AiBridgeControl({ source, parsingEnabled }: AiBridgeControlProps) {
  const status = useAiBridgeStore((state) => state.status);
  const setStatus = useAiBridgeStore((state) => state.setStatus);
  const addLog = useLogStore((state) => state.addLog);
  const [port, setPort] = useState(() => String(savedPort()));
  const [busy, setBusy] = useState(false);
  const label = AI_SOURCE_LABELS[source];
  const writeText = WRITE_TARGET_TEXT[source];
  const otherWritable = (Object.keys(AI_SOURCE_LABELS) as AiSource[]).filter(
    (other) => other !== source && status.allowWrite[other]
  );

  useEffect(() => {
    const refresh = () =>
      void getAiBridgeStatus()
        .then(setStatus)
        .catch(() => undefined);
    refresh();
    if (!status.running) return;
    const timer = window.setInterval(refresh, 1000);
    return () => window.clearInterval(timer);
  }, [setStatus, status.running]);

  const handleStart = async () => {
    const value = Number(port);
    if (!Number.isInteger(value) || value < 1024 || value > 65535) {
      addLog("error", "AI 数据桥接端口必须在 1024-65535 之间");
      return;
    }
    setBusy(true);
    try {
      localStorage.setItem(PORT_KEY, String(value));
      setStatus(await startAiBridge(value));
      addLog("success", `AI 数据桥接已监听 127.0.0.1:${value}`);
      if (!parsingEnabled) addLog("warn", `${label}未启用数据解析，AI 只能收到文本行，收不到标准样本`);
    } catch (error) {
      addLog("error", `AI 数据桥接启动失败: ${error}`);
    } finally {
      setBusy(false);
    }
  };

  const handleStop = async () => {
    setBusy(true);
    try {
      setStatus(await stopAiBridge());
      addLog("info", "AI 数据桥接已停止");
    } catch (error) {
      addLog("error", `AI 数据桥接停止失败: ${error}`);
    } finally {
      setBusy(false);
    }
  };

  const handleWriteToggle = async (allowWrite: boolean) => {
    try {
      setStatus(await setAiBridgeWriteEnabled(source, allowWrite));
      addLog(allowWrite ? "warn" : "info", `${allowWrite ? "已允许" : "已禁止"} AI 向${label}发送命令`);
    } catch (error) {
      addLog("error", `更新 AI 写权限失败: ${error}`);
    }
  };

  const copyCommand = async () => {
    await navigator.clipboard.writeText(
      `python skills/micu-omniprobe-ai/scripts/client.py watch --port ${status.port || port} --source ${source}`
    );
    addLog("success", "已复制 AI 数据流监听命令");
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant={status.running ? "secondary" : "outline"} className="gap-1">
          <Bot className="h-3.5 w-3.5" />
          AI{status.running ? ` · ${status.clients}` : ""}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[340px] rounded-[24px] border-border/70 p-4">
        <div className="space-y-4">
          <div>
            <div className="text-sm font-medium">AI 数据桥接</div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              将{label}文本行和图表解析后的样本以 NDJSON 输出到本机 TCP，AI 与界面看到同一批数据。串口、RTT
              和蓝牙共用同一端口，按 source 区分。
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">127.0.0.1:</span>
            <Input
              type="number"
              min={1024}
              max={65535}
              value={status.running ? status.port : port}
              disabled={status.running}
              onChange={(event) => setPort(event.target.value)}
              className="h-8 flex-1 text-xs"
            />
            {status.running ? (
              <Button size="sm" variant="destructive" disabled={busy} onClick={handleStop} className="gap-1">
                <Square className="h-3.5 w-3.5" />
                停止
              </Button>
            ) : (
              <Button size="sm" disabled={busy} onClick={handleStart} className="gap-1">
                <Play className="h-3.5 w-3.5" />
                启动
              </Button>
            )}
          </div>

          <label className="flex items-center justify-between rounded-[18px] border border-border/60 p-3">
            <span>
              <span className="block text-xs font-medium">{writeText.title}</span>
              <span className="mt-1 block text-xs text-muted-foreground">{writeText.hint}</span>
            </span>
            <Switch
              checked={status.allowWrite[source]}
              disabled={!status.running}
              onCheckedChange={handleWriteToggle}
            />
          </label>

          {otherWritable.length > 0 && (
            <p className="text-xs text-amber-600">
              AI 当前还可写入：{otherWritable.map((other) => AI_SOURCE_LABELS[other]).join("、")}
            </p>
          )}

          {status.running && (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                客户端 {status.clients} · 丢弃批次 {status.droppedBatches}
              </span>
              <Button size="sm" variant="ghost" onClick={copyCommand} className="h-7 gap-1 px-2 text-xs">
                <Copy className="h-3.5 w-3.5" />
                复制监听命令
              </Button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function AiSkillLink({ source }: { source: AiSource }) {
  const activePort = useAiBridgeStore((state) => state.status.port);
  const addLog = useLogStore((state) => state.addLog);
  const port = activePort || savedPort();
  const label = AI_SOURCE_LABELS[source];
  const prompt = `请安装并使用这个 Skill：\n${SKILL_URL}\n\nMICU-OmniProbe AI 数据桥接地址是 127.0.0.1:${port}，本次使用${label}数据（--source ${source}）。\n安装后请先采集并分析数据，未经我确认不要向${label}发送调参命令。`;

  const copy = async (text: string, success: string) => {
    try {
      await navigator.clipboard.writeText(text);
      addLog("success", success);
    } catch (error) {
      addLog("error", `复制失败: ${error}`);
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1">
          <PackageOpen className="h-3.5 w-3.5" />
          Skill
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[400px] rounded-[24px] border-border/70 p-4">
        <div className="space-y-4">
          <div>
            <div className="text-sm font-medium">获取 AI Skill</div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              软件不会修改 AI 工具目录。复制链接或安装文案，让用户交给自己的 AI 安装。
            </p>
          </div>

          <div className="rounded-[18px] border border-border/60 bg-muted/20 p-3">
            <div className="break-all font-mono text-[11px] leading-5 text-muted-foreground">{SKILL_URL}</div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => copy(SKILL_URL, "已复制 Skill 链接")}
              className="mt-2 h-7 gap-1 text-xs"
            >
              <Copy className="h-3.5 w-3.5" />
              复制链接
            </Button>
          </div>

          <pre className="max-h-40 whitespace-pre-wrap rounded-[18px] border border-border/60 bg-muted/20 p-3 text-xs leading-5 text-muted-foreground">
            {prompt}
          </pre>
          <Button size="sm" onClick={() => copy(prompt, "已复制 Skill 安装文案")} className="w-full gap-1">
            <Copy className="h-3.5 w-3.5" />
            复制给 AI 的安装文案
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
