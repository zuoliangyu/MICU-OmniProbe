import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLogStore } from "@/stores/logStore";

interface WorkspaceErrorBoundaryProps {
  /** 出错区域的名称，用于提示与日志 */
  label: string;
  children: ReactNode;
}

interface WorkspaceErrorBoundaryState {
  error: Error | null;
}

/**
 * 工作台级错误边界：某个组件渲染出错时只替换这一块区域，
 * 不让整棵 React 树卸载成白屏。切换工作台时由外层 key 重置。
 */
export class WorkspaceErrorBoundary extends Component<WorkspaceErrorBoundaryProps, WorkspaceErrorBoundaryState> {
  state: WorkspaceErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): WorkspaceErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.label}] 渲染出错`, error, info.componentStack);
    useLogStore.getState().addLog("error", `${this.props.label}渲染出错: ${error.message}`);
  }

  private reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="surface-strong flex h-full items-center justify-center rounded-[14px] p-6">
        <div className="flex max-w-lg flex-col items-center gap-3 text-center">
          <div className="rounded-full bg-destructive/10 p-3 text-destructive">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="text-sm font-semibold text-foreground">{this.props.label}出现错误</div>
          <p className="text-xs leading-5 text-muted-foreground">
            其他工作台不受影响。可以尝试重新加载此区域；如果反复出现，请把下面的错误信息反馈给开发者。
          </p>
          <pre className="max-h-32 w-full overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-left font-mono text-[11px] text-muted-foreground">
            {error.message}
          </pre>
          <Button size="sm" onClick={this.reset} className="gap-1.5">
            <RotateCcw className="h-3.5 w-3.5" />
            重新加载此区域
          </Button>
        </div>
      </div>
    );
  }
}
