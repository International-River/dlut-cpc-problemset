import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

// 业界标准渲染栈：react-markdown 把 markdown 解析成真正的 React 组件；
// remark-math 把 $...$ / $$...$$ 作为独立数学节点解析（公式里的 _ * \ 不会被破坏）；
// rehype-katex 用 KaTeX 渲染这些节点。全程不碰 innerHTML，不与 React 争夺 DOM。
export function Markdown({ source }: { source?: string | null }) {
  if (!source) return null;
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false }]]}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
