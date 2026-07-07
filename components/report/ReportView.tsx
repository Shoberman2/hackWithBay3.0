"use client";

/**
 * Typographic renderer for the paid landscape report (markdown + GFM).
 * Handles its own loading skeleton, empty state, and inline error state.
 */

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

export interface ReportViewProps {
  markdown: string | null;
  loading?: boolean;
  error?: string | null;
}

const components: Components = {
  h1: ({ children }) => (
    <h1 className="mt-2 mb-8 text-3xl font-semibold tracking-tight text-ink">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-12 mb-4 text-xl font-semibold tracking-tight text-ink">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-8 mb-3 text-base font-semibold tracking-tight text-ink">
      {children}
    </h3>
  ),
  p: ({ children }) => (
    <p className="mb-5 text-[15px] leading-7 text-ink">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="mb-5 list-disc space-y-2 pl-5 text-[15px] leading-7 text-ink">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-5 list-decimal space-y-2 pl-5 text-[15px] leading-7 text-ink">
      {children}
    </ol>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-accent underline decoration-line underline-offset-2 hover:decoration-accent"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-ink">{children}</strong>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-5 border-l-2 border-line pl-4 text-ink-2">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-10 border-t border-line" />,
  code: ({ children }) => (
    <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-[13px] text-ink">
      {children}
    </code>
  ),
  table: ({ children }) => (
    <div className="mb-6 overflow-x-auto rounded-[8px] border border-line">
      <table className="w-full border-collapse font-mono text-[13px]">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-surface text-left">{children}</thead>
  ),
  th: ({ children }) => (
    <th className="border-b border-line px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-ink-2">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-line px-4 py-2.5 align-top text-ink last:border-b-0">
      {children}
    </td>
  ),
};

function ReportSkeleton() {
  const widths = ["w-2/3", "w-full", "w-11/12", "w-4/5", "w-full", "w-3/5"];
  return (
    <div aria-label="Generating report" className="space-y-4 py-2">
      <div className="shimmer h-8 w-1/2 rounded-[6px]" />
      {widths.map((w, i) => (
        <div key={i} className={`shimmer h-4 ${w} rounded-[4px]`} />
      ))}
      <div className="shimmer mt-6 h-32 w-full rounded-[8px]" />
    </div>
  );
}

export default function ReportView({ markdown, loading, error }: ReportViewProps) {
  if (loading) {
    return (
      <div className="mx-auto max-w-4xl">
        <ReportSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-4xl py-4">
        <p className="text-sm text-[#B42318]">{error}</p>
      </div>
    );
  }

  if (!markdown) {
    return (
      <div className="mx-auto max-w-4xl rounded-[10px] border border-line px-8 py-16 text-center">
        <p className="text-sm font-medium text-ink">No report yet</p>
        <p className="mt-2 text-sm text-ink-2">
          Generate the full landscape report once your graph has finished
          building.
        </p>
      </div>
    );
  }

  return (
    <article className="fade-up mx-auto max-w-4xl">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {markdown}
      </ReactMarkdown>
    </article>
  );
}
