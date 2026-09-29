import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// 发布说明 Markdown 的紧凑渲染样式（仅 release notes 这一处使用）
const releaseNotesComponents = {
  h1: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h3 className="mt-3 mb-1 text-sm font-semibold text-foreground first:mt-0" {...props} />
  ),
  h2: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h3 className="mt-3 mb-1 text-sm font-semibold text-foreground first:mt-0" {...props} />
  ),
  h3: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h3 className="mt-3 mb-1 text-sm font-semibold text-foreground first:mt-0" {...props} />
  ),
  p: (props: React.HTMLAttributes<HTMLParagraphElement>) => <p className="mb-1.5 last:mb-0" {...props} />,
  ul: (props: React.HTMLAttributes<HTMLUListElement>) => (
    <ul className="mb-1.5 list-disc space-y-0.5 pl-5" {...props} />
  ),
  ol: (props: React.HTMLAttributes<HTMLOListElement>) => (
    <ol className="mb-1.5 list-decimal space-y-0.5 pl-5" {...props} />
  ),
  li: (props: React.LiHTMLAttributes<HTMLLIElement>) => <li className="marker:text-muted-foreground" {...props} />,
  strong: (props: React.HTMLAttributes<HTMLElement>) => <strong className="font-semibold text-foreground" {...props} />,
  code: (props: React.HTMLAttributes<HTMLElement>) => (
    <code className="rounded bg-black/5 px-1 py-0.5 font-mono text-xs" {...props} />
  ),
  a: ({ href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-blue-600 underline" {...props} />
  ),
};

export default function ReleaseNotes({ markdown }: { markdown: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={releaseNotesComponents}>
      {markdown}
    </ReactMarkdown>
  );
}
