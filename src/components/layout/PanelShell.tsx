import type { ComponentType, ReactNode } from "react";

// 串口 / RTT / 蓝牙三个数据面板共用的外壳与流程提示卡片

interface PanelHintCardProps {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
}

export function PanelHintCard({ icon: Icon, title, description }: PanelHintCardProps) {
  return (
    <div className="flex items-center gap-2 rounded-[18px] border border-border/60 bg-white/60 px-3 py-2 text-sm shadow-[0_6px_14px_rgba(73,93,142,0.05)]">
      <div className="rounded-full bg-primary/10 p-1.5 text-primary">
        <Icon className="h-3.5 w-3.5" />
      </div>
      <span className="font-medium text-foreground">{title}</span>
      <span className="min-w-0 flex-1 text-xs text-muted-foreground">{description}</span>
    </div>
  );
}

interface PanelShellProps {
  title: string;
  subtitle: string;
  badge: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function PanelShell({ title, subtitle, badge, actions, children }: PanelShellProps) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[28px] border border-border/60 bg-white/75 shadow-[0_12px_26px_rgba(73,93,142,0.08)] backdrop-blur">
      {/* 单行标题：副标题跟在标题后面，节省纵向空间 */}
      <div className="panel-shell-header flex items-center justify-between gap-3 border-b border-border/60 bg-muted/20 px-4 py-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 text-sm font-medium text-foreground">{title}</span>
          <span className="panel-shell-subtitle truncate text-xs text-muted-foreground">{subtitle}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {actions}
          <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">
            {badge}
          </span>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
