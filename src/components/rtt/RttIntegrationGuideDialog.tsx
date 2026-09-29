import { useState, type ReactNode } from "react";
import { BookOpen, Check, Copy, FileCode2, Github, ExternalLink } from "lucide-react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface RttIntegrationGuideDialogProps {
  trigger?: ReactNode;
}

const RTT_REPO_URL = "https://github.com/zuoliangyu/MICU-OmniProbe/tree/main/RTTBSP";
const EXAMPLE_REPO_URL = "https://github.com/zuoliangyu/MICU-OmniProbe/tree/main/examples/gd32-rtt";

const SNIPPET_INCLUDE = `#include "SEGGER_RTT.h"`;

const SNIPPET_HELLO = `int main(void) {
    HAL_Init();
    SystemClock_Config();

    while (1) {
        SEGGER_RTT_printf(0, "tick=%d\\r\\n", HAL_GetTick());
        HAL_Delay(500);
    }
}`;

const SNIPPET_NUMERIC = `// 单数值（折线 / 波形）
SEGGER_RTT_printf(0, "%d\\n", adc_value);

// XY 散点
SEGGER_RTT_printf(0, "%d,%d\\n", x, y);

// 多通道 CSV
SEGGER_RTT_printf(0, "%d,%d,%d\\n", v1, v2, v3);

// JSON（字段名会作为通道名）
SEGGER_RTT_printf(0, "{\\"temp\\":%d,\\"hum\\":%d}\\n", temp, hum);`;

const SNIPPET_COLOR = `// 标准 ANSI 颜色码，MICU-OmniProbe 会渲染颜色
SEGGER_RTT_printf(0, "\\x1b[32m[OK]\\x1b[0m boot done\\r\\n");
SEGGER_RTT_printf(0, "\\x1b[31m[ERR]\\x1b[0m sensor lost\\r\\n");
SEGGER_RTT_printf(0, "\\x1b[33m[WARN]\\x1b[0m low battery\\r\\n");`;

export function RttIntegrationGuideDialog({ trigger }: RttIntegrationGuideDialogProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" variant="outline" className="gap-1.5" title="查看如何在固件里接入 RTT">
            <BookOpen className="h-3.5 w-3.5" />
            接入指南
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-3xl rounded-[28px] p-0">
        <DialogHeader className="space-y-1 border-b border-border/60 px-6 py-4">
          <DialogTitle className="flex items-center gap-2 text-base">
            <BookOpen className="h-4 w-4 text-primary" />
            RTT 接入指南
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            把 SEGGER RTT 集成到目标固件的最小步骤。代码片段右上角点一下即可复制。
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[min(70vh,640px)] overflow-y-auto px-6 py-4">
          <div className="space-y-5 pb-2">
            <Step number={1} title="把 4 个 SEGGER 源文件加入工程">
              <p className="text-xs leading-6 text-muted-foreground">
                MICU-OmniProbe 仓库的 <Code>RTTBSP/</Code> 目录已经备好这 4 个文件，复制到目标工程里即可：
              </p>
              <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs font-mono text-foreground">
                <li>· SEGGER_RTT.c</li>
                <li>· SEGGER_RTT.h</li>
                <li>· SEGGER_RTT_Conf.h</li>
                <li>· SEGGER_RTT_printf.c</li>
              </ul>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                <li>把 .c 文件加到 IDE 的源文件列表（Keil 直接拖进 Source Group）</li>
                <li>把存放它们的目录加到工程的 Include Path</li>
                <li>裸机 / FreeRTOS / RT-Thread 都能直接用，不需要额外适配</li>
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                <ExternalLinkButton url={RTT_REPO_URL} label="仓库内 RTTBSP/ 目录" />
                <ExternalLinkButton url={EXAMPLE_REPO_URL} label="examples/gd32-rtt 完整工程" />
              </div>
            </Step>

            <Step number={2} title="在代码里包含头文件">
              <CodeSnippet language="c" code={SNIPPET_INCLUDE} />
            </Step>

            <Step number={3} title="像 printf 一样调用">
              <p className="text-xs leading-6 text-muted-foreground">
                通道 0 是默认 stdout 通道，MICU-OmniProbe 默认读取该通道：
              </p>
              <CodeSnippet language="c" code={SNIPPET_HELLO} />
            </Step>

            <Step number={4} title="按需选择数据格式">
              <p className="text-xs leading-6 text-muted-foreground">
                MICU-OmniProbe 的图表能自动识别下面 4 种格式，每行一条记录，记得带换行符：
              </p>
              <CodeSnippet language="c" code={SNIPPET_NUMERIC} />
              <p className="mt-3 text-xs leading-6 text-muted-foreground">
                数据流入后，在 RTT 工具栏点「智能启用」可以让程序自动识别格式并配置图表。
              </p>
            </Step>

            <Step number={5} title="想要彩色日志？支持 ANSI 转义">
              <CodeSnippet language="c" code={SNIPPET_COLOR} />
            </Step>

            <div className="rounded-[18px] border border-amber-500/30 bg-amber-500/8 p-3 text-xs leading-6 text-amber-700 dark:text-amber-400">
              <div className="font-medium">几个常见坑</div>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                <li>
                  <Code>SEGGER_RTT_printf</Code> 不支持 <Code>%f</Code>，要输出浮点请自己拆成整数部分 和小数部分（例如{" "}
                  <Code>%d.%03d</Code>）。
                </li>
                <li>编译报找不到头文件 → 检查 Include Path 是否加上了 RTTBSP 目录。</li>
                <li>
                  MICU-OmniProbe 启动 RTT 后看不到输出 → 在「扫描模式」试试「全片扫描」， 或在 map 文件里查{" "}
                  <Code>_SEGGER_RTT</Code> 地址手动指定。
                </li>
                <li>中文乱码 → 源文件保存为 UTF-8（含 BOM 也行），并避免 GB2312。</li>
              </ul>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Step({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <section className="rounded-[20px] border border-border/60 bg-white/65 p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/12 text-xs font-semibold text-primary">
          {number}
        </span>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      <div className="pl-8">{children}</div>
    </section>
  );
}

function CodeSnippet({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <div className="relative mt-2 overflow-hidden rounded-[14px] border border-border/60 bg-muted/40">
      <div className="flex items-center justify-between border-b border-border/50 bg-muted/30 px-3 py-1.5">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          <FileCode2 className="h-3 w-3" />
          {language ?? "code"}
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className={cn(
            "flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] transition-colors",
            copied ? "bg-green-500/15 text-green-600" : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre className="overflow-x-auto px-3 py-2.5 text-xs leading-5 font-mono text-foreground">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-muted/60 px-1 py-0.5 font-mono text-[11px] text-foreground">{children}</code>;
}

function ExternalLinkButton({ url, label }: { url: string; label: string }) {
  return (
    <button
      type="button"
      onClick={() => void openExternal(url).catch(() => undefined)}
      className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-white/70 px-3 py-1 text-[11px] text-foreground transition-colors hover:border-primary/40 hover:bg-primary/8"
    >
      <Github className="h-3 w-3 text-primary" />
      {label}
      <ExternalLink className="h-3 w-3 text-muted-foreground" />
    </button>
  );
}
