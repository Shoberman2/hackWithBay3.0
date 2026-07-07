"use client";

/**
 * StreamStatus -- current pipeline stage in mono with a subtle pulse dot,
 * plus running node/link counts. Inline error state when the stream drops.
 */

import type { PipelineStage } from "@/lib/types";
import type { GraphStreamStatus } from "@/hooks/useGraphStream";

const STAGE_TEXT: Record<PipelineStage, string> = {
  expand: "Expanding search queries",
  discover: "Discovering sources",
  extract: "Extracting entities",
  dedupe: "Resolving duplicates",
  write: "Writing to graph",
  insight: "Running graph analysis",
};

interface StreamStatusProps {
  status: GraphStreamStatus;
  stage: PipelineStage | null;
  nodeCount: number;
  linkCount: number;
}

export default function StreamStatus({
  status,
  stage,
  nodeCount,
  linkCount,
}: StreamStatusProps) {
  const text =
    status === "connecting"
      ? "Connecting to pipeline"
      : status === "done"
        ? "Landscape complete"
        : status === "error"
          ? "Stream interrupted"
          : stage
            ? STAGE_TEXT[stage]
            : "Streaming";

  const dotClass =
    status === "error"
      ? "bg-[#B42318]"
      : status === "done"
        ? "bg-accent"
        : "animate-pulse bg-accent";

  return (
    <div aria-live="polite">
      <div className="flex items-center gap-2">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} />
        <span className="font-mono text-xs text-ink">{text}</span>
      </div>
      <p className="mt-1 pl-3.5 font-mono text-[11px] text-ink-2">
        {nodeCount} nodes · {linkCount} links
      </p>
      {status === "error" && (
        <p className="mt-1 pl-3.5 text-xs text-[#B42318]">
          Showing everything captured before the interruption.
        </p>
      )}
    </div>
  );
}
