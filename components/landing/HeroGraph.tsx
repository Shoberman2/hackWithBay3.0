"use client";

/**
 * HeroGraph — the landing hero's product moment: a competitive landscape
 * assembling itself. Pure SVG + framer-motion. Edges draw in (pathLength),
 * nodes spring in as their edge lands, annotations arrive last. Colors come
 * from the same --node-* tokens the real graph uses.
 */

import { motion } from "framer-motion";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

type NodeKind =
  | "idea"
  | "company"
  | "founder"
  | "investor"
  | "feature"
  | "segment";

type GraphNode = {
  id: string;
  x: number;
  y: number;
  r: number;
  kind: NodeKind;
  label: string;
  labelDx?: number;
  labelDy?: number;
  t: number; // arrival time (s)
};

const FILL: Record<NodeKind, string> = {
  idea: "var(--accent)",
  company: "var(--node-company)",
  founder: "var(--node-founder)",
  investor: "var(--node-investor)",
  feature: "var(--node-feature)",
  segment: "var(--node-segment)",
};

const NODES: GraphNode[] = [
  { id: "idea", x: 320, y: 285, r: 11, kind: "idea", label: "your idea", labelDy: 30, t: 0 },
  // companies discovered around the idea
  { id: "c1", x: 176, y: 158, r: 9, kind: "company", label: "Loopwork", labelDx: -14, labelDy: -16, t: 0.55 },
  { id: "c2", x: 468, y: 140, r: 9, kind: "company", label: "Draftboard", labelDx: 16, labelDy: -14, t: 0.7 },
  { id: "c3", x: 522, y: 338, r: 9, kind: "company", label: "Nexa", labelDx: 22, labelDy: 4, t: 0.85 },
  { id: "c4", x: 196, y: 408, r: 9, kind: "company", label: "Archway", labelDx: -20, labelDy: 22, t: 1.0 },
  // founders attach
  { id: "f1", x: 82, y: 236, r: 7, kind: "founder", label: "founder", labelDx: -12, labelDy: 22, t: 1.35 },
  { id: "f2", x: 566, y: 224, r: 7, kind: "founder", label: "founder", labelDx: 14, labelDy: -12, t: 1.5 },
  // investors connect — two rivals share one
  { id: "v1", x: 312, y: 64, r: 8, kind: "investor", label: "Meridian Capital", labelDy: -16, t: 1.75 },
  { id: "v2", x: 618, y: 428, r: 7, kind: "investor", label: "angel", labelDx: 14, labelDy: 20, t: 1.95 },
  // features + segment fill in
  { id: "ft1", x: 414, y: 452, r: 6, kind: "feature", label: "matching", labelDy: 22, t: 2.15 },
  { id: "ft2", x: 268, y: 522, r: 6, kind: "feature", label: "payroll", labelDy: 22, t: 2.3 },
  { id: "s1", x: 96, y: 520, r: 7, kind: "segment", label: "university-partnered", labelDy: 24, t: 2.45 },
];

type GraphEdge = {
  from: string;
  to: string;
  t: number;
  shared?: boolean; // the shared-investor signal
};

const EDGES: GraphEdge[] = [
  { from: "idea", to: "c1", t: 0.3 },
  { from: "idea", to: "c2", t: 0.45 },
  { from: "idea", to: "c3", t: 0.6 },
  { from: "idea", to: "c4", t: 0.75 },
  { from: "f1", to: "c1", t: 1.15 },
  { from: "f1", to: "c4", t: 1.25 },
  { from: "f2", to: "c2", t: 1.3 },
  { from: "v1", to: "c1", t: 1.55, shared: true },
  { from: "v1", to: "c2", t: 1.65, shared: true },
  { from: "v2", to: "c3", t: 1.75 },
  { from: "c3", to: "ft1", t: 1.95 },
  { from: "c2", to: "ft1", t: 2.05 },
  { from: "c4", to: "ft2", t: 2.1 },
  { from: "c4", to: "s1", t: 2.25 },
  { from: "c1", to: "s1", t: 2.35 },
];

const byId = Object.fromEntries(NODES.map((n) => [n.id, n]));

export default function HeroGraph() {
  return (
    <div className="relative h-full w-full select-none">
      <motion.svg
        viewBox="0 0 660 600"
        className="h-full w-full"
        initial={false}
        animate={{ y: [0, -7, 0] }}
        transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
        aria-hidden
      >
        {/* edges */}
        {EDGES.map((e) => {
          const a = byId[e.from];
          const b = byId[e.to];
          return (
            <motion.line
              key={`${e.from}-${e.to}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={e.shared ? "var(--node-investor)" : "#d3d3cd"}
              strokeWidth={e.shared ? 1.6 : 1.2}
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: e.shared ? 0.95 : 0.9 }}
              transition={{ delay: e.t, duration: 0.7, ease: EASE }}
            />
          );
        })}

        {/* white-space marker: the gap nobody occupies */}
        <motion.circle
          cx={520}
          cy={520}
          r={40}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={1.2}
          strokeDasharray="4 6"
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 0.7, scale: 1, rotate: 360 }}
          style={{ transformOrigin: "520px 520px" }}
          transition={{
            opacity: { delay: 2.9, duration: 0.8, ease: EASE },
            scale: { delay: 2.9, duration: 0.8, ease: EASE },
            rotate: { delay: 2.9, duration: 60, repeat: Infinity, ease: "linear" },
          }}
        />
        <motion.text
          x={520}
          y={524}
          textAnchor="middle"
          className="fill-[var(--accent)] font-mono"
          fontSize={9}
          letterSpacing="0.12em"
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.9 }}
          transition={{ delay: 3.15, duration: 0.6 }}
        >
          WHITE SPACE
        </motion.text>

        {/* pulsing halo on the idea node */}
        <motion.circle
          cx={320}
          cy={285}
          r={11}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={1}
          initial={{ opacity: 0 }}
          animate={{ opacity: [0.5, 0], scale: [1, 2.6] }}
          style={{ transformOrigin: "320px 285px" }}
          transition={{ delay: 1, duration: 2.4, repeat: Infinity, ease: "easeOut" }}
        />

        {/* nodes */}
        {NODES.map((n) => (
          <motion.g
            key={n.id}
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            style={{ transformOrigin: `${n.x}px ${n.y}px` }}
            transition={{ delay: n.t, type: "spring", stiffness: 260, damping: 18 }}
          >
            <circle cx={n.x} cy={n.y} r={n.r + 3} fill="var(--canvas)" />
            <circle cx={n.x} cy={n.y} r={n.r} fill={FILL[n.kind]} />
            <motion.text
              x={n.x + (n.labelDx ?? 0)}
              y={n.y + (n.labelDy ?? -14)}
              textAnchor={n.labelDx ? (n.labelDx > 0 ? "start" : "end") : "middle"}
              className="fill-[var(--ink-2)] font-mono"
              fontSize={9.5}
              letterSpacing="0.08em"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: n.t + 0.35, duration: 0.5 }}
            >
              {n.label}
            </motion.text>
          </motion.g>
        ))}
      </motion.svg>

      {/* annotation: the strategic signal, arrives last */}
      <motion.div
        className="absolute left-[38%] top-[6%] flex items-center gap-2 rounded-full border border-line bg-white/90 py-1.5 pl-2 pr-3.5 shadow-[0_12px_32px_-16px_rgba(17,17,17,0.25)] backdrop-blur-sm"
        initial={{ opacity: 0, y: 10, filter: "blur(4px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{ delay: 3.5, duration: 0.8, ease: EASE }}
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-wash-yellow">
          <span className="h-1.5 w-1.5 rounded-full bg-node-investor" />
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink">
          2 rivals share a lead investor
        </span>
      </motion.div>
    </div>
  );
}
