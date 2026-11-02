import { Check, Copy } from "lucide-react";
import { isValidElement, useRef, useState, type ComponentProps, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";

const languageOf = (children: ReactNode): string => {
  if (isValidElement<{ className?: string }>(children)) {
    const match = /language-([\w-]+)/.exec(children.props.className ?? "");
    return match?.[1] ?? "";
  }
  return "";
};

const CodeBlock = ({ children }: ComponentProps<"pre">) => {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const language = languageOf(children);

  const copy = (): void => {
    void navigator.clipboard.writeText(ref.current?.innerText ?? "").then(() => {
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 1500);
    });
  };

  return (
    <div className="group/code my-3 overflow-hidden rounded-lg border bg-code">
      <div className="flex items-center justify-between border-b px-3 py-1 text-xs text-muted-foreground">
        <span>{language || "code"}</span>
        <Button variant="subtle" size="sm" onClick={copy} aria-label="Copy code" className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover/code:opacity-100">
          {copied ? <Check /> : <Copy />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre ref={ref} className="overflow-hidden whitespace-pre-wrap p-3 font-mono text-[13px] leading-5 [overflow-wrap:anywhere]">{children}</pre>
    </div>
  );
};

// Model output as markdown, with code highlighted and diffs coloured. Raw HTML in the text is not rendered, and links keep
// react-markdown's safe-scheme filtering.
export const Markdown = ({ text }: { text: string }) => {
  return (
    <div className="prose-chat min-w-0 [overflow-wrap:anywhere]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]}
        components={{
          pre: CodeBlock,
          a: ({ children, href }) => {
            return <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>;
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
};
