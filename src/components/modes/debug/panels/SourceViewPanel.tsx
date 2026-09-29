import { useEffect, useMemo, useRef, useState } from "react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { cpp } from "@codemirror/lang-cpp";
import { EditorView, gutter, GutterMarker } from "@codemirror/view";
import { useDebugStore } from "@/stores/debugStore";
import { useLogStore } from "@/stores/logStore";
import { debugClearBreakpoint, debugListBreakpoints, debugReadSource, debugSetSourceBreakpoint } from "@/lib/debug";

class PcArrowMarker extends GutterMarker {
  toDOM() {
    const span = document.createElement("span");
    span.textContent = "▶";
    span.style.color = "#f59e0b";
    span.style.fontSize = "10px";
    return span;
  }
}

class BpDotMarker extends GutterMarker {
  toDOM() {
    const span = document.createElement("span");
    span.textContent = "●";
    span.style.color = "#ef4444";
    span.style.fontSize = "12px";
    span.style.cursor = "pointer";
    return span;
  }
}

class BpEmptyMarker extends GutterMarker {
  toDOM() {
    const span = document.createElement("span");
    span.textContent = "●";
    span.style.color = "transparent";
    span.style.fontSize = "12px";
    span.style.cursor = "pointer";
    return span;
  }
}

const PC_MARKER = new PcArrowMarker();
const BP_DOT = new BpDotMarker();
const BP_EMPTY = new BpEmptyMarker();

function makePcGutter(line: number | null) {
  return gutter({
    class: "cm-pc-gutter",
    lineMarker(view, blockInfo) {
      if (line === null) return null;
      const docLine = view.state.doc.lineAt(blockInfo.from).number;
      return docLine === line ? PC_MARKER : null;
    },
    initialSpacer: () => PC_MARKER,
  });
}

function makeBpGutter(activeLines: Set<number>, onToggle: (line: number) => void) {
  return gutter({
    class: "cm-bp-gutter",
    lineMarker(view, blockInfo) {
      const docLine = view.state.doc.lineAt(blockInfo.from).number;
      return activeLines.has(docLine) ? BP_DOT : BP_EMPTY;
    },
    domEventHandlers: {
      click(view, blockInfo) {
        const docLine = view.state.doc.lineAt(blockInfo.from).number;
        onToggle(docLine);
        return true;
      },
    },
    initialSpacer: () => BP_DOT,
  });
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

export function SourceViewPanel() {
  const frames = useDebugStore((s) => s.frames);
  const currentFrameId = useDebugStore((s) => s.currentFrameId);
  const currentFrame = frames.find((f) => f.id === currentFrameId) ?? null;
  const breakpoints = useDebugStore((s) => s.breakpoints);
  const setBreakpoints = useDebugStore((s) => s.setBreakpoints);
  const addLog = useLogStore((s) => s.addLog);

  const [loadedPath, setLoadedPath] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editorRef = useRef<ReactCodeMirrorRef | null>(null);

  // 当前 frame 的源文件变化 → 重新加载
  useEffect(() => {
    const targetPath = currentFrame?.file ?? null;
    if (!targetPath) {
      setContent("");
      setLoadedPath(null);
      setError(null);
      return;
    }
    if (targetPath === loadedPath) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    debugReadSource(targetPath)
      .then((res) => {
        if (cancelled) return;
        setContent(res.content);
        setLoadedPath(res.path);
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = String(err);
        setError(msg);
        setContent("");
        setLoadedPath(null);
        addLog("warn", `读源文件失败: ${msg}`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentFrame?.file, loadedPath, addLog]);

  // 滚动到 PC 行
  useEffect(() => {
    const view = editorRef.current?.view;
    if (!view || !currentFrame?.line) return;
    const lineNum = currentFrame.line;
    if (lineNum > view.state.doc.lines) return;
    const linePos = view.state.doc.line(lineNum);
    view.dispatch({
      effects: EditorView.scrollIntoView(linePos.from, { y: "center" }),
    });
  }, [content, currentFrame?.line]);

  // 当前文件中有断点的行号集合
  const breakpointLines = useMemo(() => {
    if (!loadedPath) return new Set<number>();
    const target = normalizePath(loadedPath);
    const set = new Set<number>();
    for (const bp of breakpoints) {
      if (!bp.file || !bp.line) continue;
      if (normalizePath(bp.file) === target) {
        set.add(bp.line);
      }
    }
    return set;
  }, [breakpoints, loadedPath]);

  const handleToggleBreakpoint = async (line: number) => {
    if (!loadedPath) return;
    const target = normalizePath(loadedPath);
    const existing = breakpoints.find((bp) => bp.file && normalizePath(bp.file) === target && bp.line === line);
    try {
      if (existing) {
        await debugClearBreakpoint(existing.address);
        addLog("info", `断点已清除: ${target}:${line}`);
      } else {
        await debugSetSourceBreakpoint(loadedPath, line);
        addLog("success", `断点已设置: ${target}:${line}`);
      }
      const list = await debugListBreakpoints();
      setBreakpoints(list);
    } catch (error) {
      addLog("error", `切换断点失败: ${error}`);
    }
  };

  const extensions = useMemo(
    () => [cpp(), makeBpGutter(breakpointLines, handleToggleBreakpoint), makePcGutter(currentFrame?.line ?? null)],
    // handleToggleBreakpoint 闭包只捕获 loadedPath 与 breakpoints；后两者足以触发重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [breakpointLines, currentFrame?.line, loadedPath, breakpoints]
  );

  const fileName = loadedPath ? loadedPath.split(/[\\/]/).pop() : null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
        <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          源码
          {fileName && (
            <span className="ml-2 normal-case tracking-normal text-foreground" title={loadedPath ?? ""}>
              {fileName}
              {currentFrame?.line && ` : ${currentFrame.line}`}
            </span>
          )}
        </span>
      </div>

      {!currentFrame?.file ? (
        <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-muted-foreground">
          {currentFrame ? "当前帧无源码位置（PC 不在 DWARF 行表中或未加载 ELF）" : "暂停后从调用栈选择一帧查看源码"}
        </div>
      ) : loading ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">读取中...</div>
      ) : error ? (
        <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-red-500">{error}</div>
      ) : (
        <div className="flex-1 overflow-hidden text-xs">
          <CodeMirror
            ref={editorRef}
            value={content}
            extensions={extensions}
            editable={false}
            readOnly
            basicSetup={{
              lineNumbers: true,
              foldGutter: false,
              highlightActiveLine: false,
              highlightActiveLineGutter: false,
            }}
            height="100%"
            style={{ height: "100%", fontSize: "12px" }}
          />
        </div>
      )}
    </div>
  );
}
