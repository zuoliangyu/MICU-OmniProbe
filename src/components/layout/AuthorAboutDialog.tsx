import { open } from "@tauri-apps/plugin-shell";
import { BadgeInfo, ExternalLink, Github, UserRound, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const AUTHOR_NAME = "左岚";
const BILIBILI_URL = "https://space.bilibili.com/27619688";
const PROJECT_GITHUB_URL = "https://github.com/zuoliangyu/MICU-OmniProbe";

async function openExternalLink(url: string) {
  try {
    await open(url);
  } catch (error) {
    console.error("打开外部链接失败:", error);
  }
}

export function AuthorAboutDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-2 px-3" title="关于作者">
          <BadgeInfo className="h-4 w-4" />
          <span>关于作者</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl gap-3 rounded-[14px] p-4 sm:p-5">
        <DialogHeader className="space-y-1">
          <DialogTitle className="flex items-center gap-2">
            <UserRound className="h-5 w-5 text-primary" />
            关于作者
          </DialogTitle>
          <DialogDescription className="text-sm text-[hsl(var(--secondary-foreground))]/88">
            MICU-OmniProbe 由米醋电子工作室左岚进行维护，下方是作者主页与项目仓库的链接。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 pt-1">
          <section className="rounded-[12px] border border-border/60 bg-background/60 p-3">
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">作者</div>
            <div className="mt-1 text-xl font-semibold text-foreground">{AUTHOR_NAME}</div>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">
              专注嵌入式工具链与桌面端开发，主导 MICU-OmniProbe 的功能设计与核心实现。
            </p>
          </section>

          <section className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => openExternalLink(BILIBILI_URL)}
              className="group rounded-[12px] border border-border/60 bg-background/60 p-3 text-left transition-colors hover:border-primary/35 hover:bg-muted/50"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Video className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium text-foreground">Bilibili</span>
                </div>
                <ExternalLink className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary" />
              </div>
              <div className="mt-2 break-all text-xs leading-5 text-muted-foreground">{BILIBILI_URL}</div>
            </button>

            <button
              type="button"
              onClick={() => openExternalLink(PROJECT_GITHUB_URL)}
              className="group rounded-[12px] border border-border/60 bg-background/60 p-3 text-left transition-colors hover:border-primary/35 hover:bg-muted/50"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Github className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium text-foreground">项目 GitHub</span>
                </div>
                <ExternalLink className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary" />
              </div>
              <div className="mt-2 break-all text-xs leading-5 text-muted-foreground">{PROJECT_GITHUB_URL}</div>
            </button>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
