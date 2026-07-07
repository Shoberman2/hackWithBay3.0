"use client";

/**
 * Rivalry marketing page. Same design system as the product — paper canvas,
 * ink type, one green accent, node-colors reserved for graph elements —
 * pushed to editorial scale: oversized Geist headings, mono eyebrows,
 * hairline structure, double-bezel cards, staggered blur-up reveals.
 */

import Link from "next/link";
import { type ReactNode, useRef } from "react";
import {
  MotionConfig,
  motion,
  useScroll,
  useTransform,
} from "framer-motion";
import {
  ArrowUpRight,
  ChatCircleText,
  CircleDashed,
  ClockCountdown,
  Crosshair,
  GitBranch,
  Quotes,
  UsersThree,
} from "@phosphor-icons/react";
import HeroGraph from "./HeroGraph";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/* ---------- primitives ---------- */

function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 28, filter: "blur(8px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.9, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-ink-2">
      <span className="h-1 w-1 rounded-full bg-accent" />
      {children}
    </span>
  );
}

function CtaButton({
  href,
  children,
  tone = "accent",
  large = false,
}: {
  href: string;
  children: ReactNode;
  tone?: "accent" | "ink" | "ghost";
  large?: boolean;
}) {
  const shells = {
    accent: "bg-accent text-white",
    ink: "bg-ink text-white",
    ghost: "border border-line bg-white text-ink",
  } as const;
  const wells = {
    accent: "bg-white/15 text-white",
    ink: "bg-white/15 text-white",
    ghost: "bg-ink/5 text-ink",
  } as const;
  return (
    <Link
      href={href}
      className={`group inline-flex items-center gap-3 rounded-full font-medium tracking-tight transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98] ${shells[tone]} ${
        large ? "py-2.5 pl-7 pr-2.5 text-lg" : "py-2 pl-5 pr-2 text-sm"
      }`}
    >
      {children}
      <span
        className={`flex items-center justify-center rounded-full transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:-translate-y-px group-hover:translate-x-0.5 group-hover:scale-105 ${wells[tone]} ${large ? "h-10 w-10" : "h-7 w-7"}`}
      >
        <ArrowUpRight size={large ? 18 : 14} weight="light" />
      </span>
    </Link>
  );
}

/* ---------- feature-card mini diagrams ---------- */

function SharedInvestorDiagram() {
  return (
    <svg viewBox="0 0 260 96" className="w-full" aria-hidden>
      <line x1="52" y1="66" x2="130" y2="28" stroke="var(--node-investor)" strokeWidth="1.4" />
      <line x1="208" y1="66" x2="130" y2="28" stroke="var(--node-investor)" strokeWidth="1.4" />
      <circle cx="130" cy="28" r="8" fill="var(--node-investor)" />
      <circle cx="52" cy="66" r="9" fill="var(--node-company)" />
      <circle cx="208" cy="66" r="9" fill="var(--node-company)" />
      <text x="130" y="12" textAnchor="middle" fontSize="9" letterSpacing="0.1em" className="fill-[var(--ink-2)] font-mono">LEAD INVESTOR</text>
      <text x="52" y="88" textAnchor="middle" fontSize="9" letterSpacing="0.1em" className="fill-[var(--ink-2)] font-mono">RIVAL A</text>
      <text x="208" y="88" textAnchor="middle" fontSize="9" letterSpacing="0.1em" className="fill-[var(--ink-2)] font-mono">RIVAL B</text>
    </svg>
  );
}

function ClusterDiagram() {
  const dots = [
    [36, 34], [52, 22], [58, 44], [40, 52], [24, 44],
    [150, 30], [166, 42], [158, 56], [140, 46],
  ] as const;
  return (
    <svg viewBox="0 0 260 84" className="w-full" aria-hidden>
      {dots.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="5" fill={i < 5 ? "var(--node-company)" : "var(--node-segment)"} opacity="0.85" />
      ))}
      <circle cx="222" cy="42" r="22" fill="none" stroke="var(--accent)" strokeWidth="1.2" strokeDasharray="3 5" />
      <text x="222" y="78" textAnchor="middle" fontSize="9" letterSpacing="0.1em" className="fill-[var(--accent)] font-mono">WHITE SPACE</text>
    </svg>
  );
}

function LagDiagram() {
  const rows = [
    { y: 18, w: 150, lag: null },
    { y: 40, w: 116, lag: "+34d" },
    { y: 62, w: 84, lag: "+87d" },
  ];
  return (
    <svg viewBox="0 0 260 84" className="w-full" aria-hidden>
      {rows.map((r, i) => (
        <g key={i}>
          <rect x="8" y={r.y - 5} width={r.w} height="10" rx="5" fill={i === 0 ? "var(--node-launch)" : "var(--border)"} opacity={i === 0 ? 0.9 : 1} />
          {r.lag && (
            <text x={r.w + 18} y={r.y + 3} fontSize="9" letterSpacing="0.08em" className="fill-[var(--ink-2)] font-mono">{r.lag}</text>
          )}
          {!r.lag && (
            <text x={r.w + 18} y={r.y + 3} fontSize="9" letterSpacing="0.08em" className="fill-[var(--node-launch)] font-mono">SHIPS FIRST</text>
          )}
        </g>
      ))}
    </svg>
  );
}

/* ---------- sections ---------- */

function Nav() {
  return (
    <motion.header
      className="fixed inset-x-0 top-0 z-40 flex justify-center px-4 pt-5"
      initial={{ y: -24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.9, delay: 0.15, ease: EASE }}
    >
      <div className="flex items-center gap-1 rounded-full border border-line/80 bg-white/75 p-1.5 shadow-[0_16px_48px_-20px_rgba(17,17,17,0.18)] backdrop-blur-xl">
        <Link href="/" className="flex items-center gap-2 py-1.5 pl-3.5 pr-4 text-sm font-semibold tracking-tight">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-40" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
          </span>
          Rivalry
        </Link>
        <nav className="hidden items-center md:flex">
          {[
            ["How it works", "#how-it-works"],
            ["Features", "#features"],
            ["Pricing", "#pricing"],
          ].map(([label, href]) => (
            <a
              key={href}
              href={href}
              className="rounded-full px-3.5 py-1.5 text-sm text-ink-2 transition-colors duration-300 hover:text-ink"
            >
              {label}
            </a>
          ))}
        </nav>
        <Link
          href="/start"
          className="ml-1 rounded-full bg-ink px-4 py-2 text-sm font-medium text-white transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:scale-[1.03] active:scale-[0.98]"
        >
          Try it out
        </Link>
      </div>
    </motion.header>
  );
}

function Hero() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  });
  const graphY = useTransform(scrollYProgress, [0, 1], [0, 90]);

  const heroLine = (text: string, delay: number) => (
    <span className="block overflow-hidden">
      <motion.span
        className="block"
        initial={{ y: "110%" }}
        animate={{ y: 0 }}
        transition={{ duration: 1, delay, ease: EASE }}
      >
        {text}
      </motion.span>
    </span>
  );

  return (
    <section ref={ref} className="relative overflow-hidden">
      {/* dot-grid field, fading out toward the fold */}
      <div
        className="pointer-events-none absolute inset-0 [mask-image:radial-gradient(85%_70%_at_60%_20%,black,transparent)]"
        style={{
          backgroundImage: "radial-gradient(var(--border) 1px, transparent 1px)",
          backgroundSize: "26px 26px",
        }}
      />
      <div
        className="pointer-events-none absolute -top-48 right-[-14%] h-[560px] w-[560px] rounded-full opacity-[0.09] blur-3xl"
        style={{
          background:
            "radial-gradient(circle, var(--accent) 0%, transparent 65%)",
        }}
      />

      <div className="relative mx-auto grid max-w-6xl grid-cols-1 items-center gap-14 px-6 pb-24 pt-36 md:pt-44 lg:grid-cols-12 lg:gap-8 lg:pb-32">
        <div className="lg:col-span-6">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.3, ease: EASE }}
          >
            <Eyebrow>Competitive intelligence for day zero</Eyebrow>
          </motion.div>

          <h1 className="mt-7 text-[2.75rem] font-semibold leading-[1.04] tracking-tight md:text-[4rem]">
            {heroLine("See every rival", 0.4)}
            {heroLine("before you build.", 0.52)}
          </h1>

          <motion.p
            className="mt-7 max-w-md text-lg leading-relaxed text-ink-2"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.75, ease: EASE }}
          >
            Type your idea in plain language. Rivalry assembles the companies,
            founders, investors, and features around it into a live graph —
            in front of you, every claim cited.
          </motion.p>

          <motion.div
            className="mt-10 flex flex-wrap items-center gap-4"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.9, ease: EASE }}
          >
            <CtaButton href="/start">Try it out</CtaButton>
            <Link
              href="/session/demo"
              className="group inline-flex items-center gap-2 text-sm font-medium text-ink-2 transition-colors duration-300 hover:text-ink"
            >
              Explore the live demo
              <ArrowUpRight
                size={14}
                weight="light"
                className="transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:-translate-y-px group-hover:translate-x-0.5"
              />
            </Link>
          </motion.div>

          <motion.p
            className="mt-14 font-mono text-[10px] uppercase tracking-[0.2em] text-ink-2/70"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1, delay: 1.2 }}
          >
            Built on Neo4j&ensp;·&ensp;RocketRide Cloud&ensp;·&ensp;Butterbase
          </motion.p>
        </div>

        {/* double-bezel graph frame */}
        <motion.div
          className="lg:col-span-6"
          style={{ y: graphY }}
          initial={{ opacity: 0, y: 40, filter: "blur(10px)" }}
          animate={{ opacity: 1, filter: "blur(0px)" }}
          transition={{ duration: 1.1, delay: 0.5, ease: EASE }}
        >
          <div className="rounded-[2rem] border border-line/70 bg-ink/[0.03] p-2">
            <div className="relative overflow-hidden rounded-[calc(2rem-0.5rem)] border border-line bg-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.9),0_24px_64px_-32px_rgba(17,17,17,0.2)]">
              <div
                className="pointer-events-none absolute inset-0 opacity-60"
                style={{
                  backgroundImage:
                    "radial-gradient(var(--border) 1px, transparent 1px)",
                  backgroundSize: "22px 22px",
                }}
              />
              <div className="flex items-center justify-between border-b border-line px-5 py-3">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-2">
                  internship platform · landscape
                </span>
                <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                  Assembling
                </span>
              </div>
              <div className="aspect-[660/560] w-full">
                <HeroGraph />
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function Problem() {
  return (
    <section className="border-t border-line">
      <div className="mx-auto max-w-6xl px-6 py-28 md:py-40">
        <Reveal>
          <Eyebrow>The problem</Eyebrow>
        </Reveal>
        <Reveal delay={0.1}>
          <p className="mt-8 max-w-4xl text-3xl font-medium leading-[1.15] tracking-tight text-ink md:text-[3.25rem]">
            Competitive research at day zero is{" "}
            <span className="text-ink-2">40 open tabs, a LinkedIn stalk,</span>{" "}
            and a spreadsheet{" "}
            <span className="text-ink-2">
              that hides everything that matters.
            </span>
          </p>
        </Reveal>
        <Reveal delay={0.25}>
          <p className="mt-10 max-w-2xl text-xl leading-relaxed text-ink-2">
            A flat list can&apos;t show you that three of your competitors
            share a lead investor, that four founders in the space left the
            same company, or that everyone clusters around one feature set
            while an adjacent segment sits empty.
          </p>
        </Reveal>
        <Reveal delay={0.35}>
          <p className="mt-10 inline-block border-b-2 border-accent pb-1 text-xl font-semibold tracking-tight text-ink md:text-2xl">
            Relationships are the intelligence. Rows destroy them.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

const STEPS = [
  {
    n: "01",
    title: "Type the idea",
    body: "One line is enough. “Internship platform.” No forms, no category pickers, no setup.",
  },
  {
    n: "02",
    title: "Sharpen it",
    body: "An agent asks 4–6 questions that narrow what you actually mean. Marketplace or ATS? Students or employers paying?",
  },
  {
    n: "03",
    title: "Watch it assemble",
    body: "Companies appear, founders attach, investors connect, features fill in. The landscape builds itself live, node by node.",
  },
  {
    n: "04",
    title: "Interrogate it",
    body: "Ask in plain English. Answers run as real graph traversals — with the Cypher, the paths, and the sources to prove it.",
  },
];

function HowItWorks() {
  return (
    <section id="how-it-works" className="scroll-mt-24 border-t border-line bg-surface">
      <div className="mx-auto max-w-6xl px-6 py-28 md:py-40">
        <Reveal>
          <Eyebrow>How it works</Eyebrow>
        </Reveal>
        <Reveal delay={0.1}>
          <h2 className="mt-8 max-w-2xl text-4xl font-semibold leading-[1.08] tracking-tight md:text-5xl">
            From one sentence to a living landscape.
          </h2>
        </Reveal>
        <div className="mt-20 grid grid-cols-1 gap-x-10 gap-y-14 md:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={0.12 * i}>
              <div className="border-t border-ink/15 pt-6">
                <span className="font-mono text-xs tracking-[0.2em] text-accent">
                  {s.n}
                </span>
                <h3 className="mt-4 text-xl font-semibold tracking-tight">
                  {s.title}
                </h3>
                <p className="mt-3 leading-relaxed text-ink-2">{s.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-[1.75rem] border border-line/70 bg-ink/[0.03] p-1.5 ${className}`}>
      <div className="flex h-full flex-col rounded-[calc(1.75rem-0.375rem)] border border-line bg-white p-7 shadow-[inset_0_1px_1px_rgba(255,255,255,0.9)]">
        {children}
      </div>
    </div>
  );
}

function CardIcon({ children }: { children: ReactNode }) {
  return (
    <span className="mb-5 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface text-ink">
      {children}
    </span>
  );
}

function Features() {
  return (
    <section id="features" className="scroll-mt-24 border-t border-line">
      <div className="mx-auto max-w-6xl px-6 py-28 md:py-40">
        <Reveal>
          <Eyebrow>Graph-native intelligence</Eyebrow>
        </Reveal>
        <Reveal delay={0.1}>
          <h2 className="mt-8 max-w-3xl text-4xl font-semibold leading-[1.08] tracking-tight md:text-5xl">
            Signals a spreadsheet can&apos;t hold.
          </h2>
        </Reveal>

        <div className="mt-20 grid grid-cols-1 gap-5 lg:grid-cols-12">
          {/* row 1 */}
          <Reveal className="lg:col-span-7" delay={0}>
            <Card className="h-full">
              <CardIcon>
                <ChatCircleText size={20} weight="light" />
              </CardIcon>
              <h3 className="text-2xl font-semibold tracking-tight">
                Ask the graph anything
              </h3>
              <p className="mt-3 max-w-md leading-relaxed text-ink-2">
                Natural-language questions become Cypher traversals, and heavy
                number-crunching runs in a sandboxed compute environment.
                Answers come back with the paths that produced them.
              </p>
              <div className="mt-7 space-y-3">
                <div className="ml-auto w-fit max-w-full rounded-2xl rounded-br-md bg-ink px-4 py-2.5 text-sm text-white">
                  Which of these companies share investors?
                </div>
                <div className="w-fit max-w-full rounded-2xl rounded-bl-md border border-line bg-surface px-4 py-2.5">
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">
                    2-hop traversal · 3 paths found
                  </span>
                  <code className="mt-1.5 block font-mono text-xs text-ink-2">
                    MATCH (a)&lt;-[:INVESTED_IN]-(v)-[:INVESTED_IN]-&gt;(b)
                  </code>
                </div>
              </div>
            </Card>
          </Reveal>

          <Reveal className="lg:col-span-5" delay={0.12}>
            <Card className="h-full">
              <CardIcon>
                <GitBranch size={20} weight="light" />
              </CardIcon>
              <h3 className="text-2xl font-semibold tracking-tight">
                Shared-investor paths
              </h3>
              <p className="mt-3 leading-relaxed text-ink-2">
                Two “competitors” funded by the same lead investor is a major
                strategic signal — they won&apos;t both die; one may absorb
                the other. It&apos;s a two-hop path, invisible in rows.
              </p>
              <div className="mt-auto pt-7">
                <SharedInvestorDiagram />
              </div>
            </Card>
          </Reveal>

          {/* row 2 */}
          <Reveal className="lg:col-span-4" delay={0}>
            <Card className="h-full">
              <CardIcon>
                <UsersThree size={20} weight="light" />
              </CardIcon>
              <h3 className="text-xl font-semibold tracking-tight">
                Founder lineage
              </h3>
              <p className="mt-3 leading-relaxed text-ink-2">
                WORKED_AT edges expose talent clusters: “four founders in this
                space came out of Handshake.” Patterns across relationships,
                not rows.
              </p>
            </Card>
          </Reveal>

          <Reveal className="lg:col-span-4" delay={0.1}>
            <Card className="h-full">
              <CardIcon>
                <CircleDashed size={20} weight="light" />
              </CardIcon>
              <h3 className="text-xl font-semibold tracking-tight">
                White-space detection
              </h3>
              <p className="mt-3 leading-relaxed text-ink-2">
                Community detection over the company–feature–audience subgraph
                finds the real competitive clusters. Your opening is the gap
                between them.
              </p>
              <div className="mt-auto pt-6">
                <ClusterDiagram />
              </div>
            </Card>
          </Reveal>

          <Reveal className="lg:col-span-4" delay={0.2}>
            <Card className="h-full">
              <CardIcon>
                <ClockCountdown size={20} weight="light" />
              </CardIcon>
              <h3 className="text-xl font-semibold tracking-tight">
                Table stakes &amp; fast-followers
              </h3>
              <p className="mt-3 leading-relaxed text-ink-2">
                SHIPPED_AFTER edges between launches, with lag in days, show
                who leads, who copies, and which features you must treat as
                table stakes.
              </p>
              <div className="mt-auto pt-6">
                <LagDiagram />
              </div>
            </Card>
          </Reveal>

          {/* row 3 */}
          <Reveal className="lg:col-span-5" delay={0}>
            <Card className="h-full">
              <CardIcon>
                <Crosshair size={20} weight="light" />
              </CardIcon>
              <h3 className="text-xl font-semibold tracking-tight">
                The center of gravity
              </h3>
              <p className="mt-3 leading-relaxed text-ink-2">
                Centrality over the full graph surfaces the company everyone
                else positions against — the one you must differentiate from
                on day one.
              </p>
            </Card>
          </Reveal>

          <Reveal className="lg:col-span-7" delay={0.12}>
            <Card className="h-full">
              <CardIcon>
                <Quotes size={20} weight="light" />
              </CardIcon>
              <h3 className="text-xl font-semibold tracking-tight">
                Every claim has a receipt
              </h3>
              <p className="mt-3 max-w-lg leading-relaxed text-ink-2">
                Each fact in the graph traces back to a source node — Hacker
                News, Product Hunt, GitHub, the company&apos;s own site. Click
                any edge and see where it came from. No orphan facts, no
                hallucinated landscape.
              </p>
              <div className="mt-7 flex flex-wrap gap-2">
                {["Hacker News", "Product Hunt", "GitHub", "Company sites", "Funding announcements"].map(
                  (s) => (
                    <span
                      key={s}
                      className="rounded-full border border-line bg-surface px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-2"
                    >
                      {s}
                    </span>
                  ),
                )}
              </div>
            </Card>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function Pricing() {
  return (
    <section id="pricing" className="scroll-mt-24 border-t border-line bg-surface">
      <div className="mx-auto max-w-6xl px-6 py-28 md:py-40">
        <Reveal>
          <Eyebrow>Pricing</Eyebrow>
        </Reveal>
        <Reveal delay={0.1}>
          <h2 className="mt-8 max-w-2xl text-4xl font-semibold leading-[1.08] tracking-tight md:text-5xl">
            The map is free. The playbook is one purchase.
          </h2>
        </Reveal>

        <div className="mt-20 grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Reveal delay={0}>
            <Card className="h-full">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-2">
                Explore
              </span>
              <p className="mt-4 text-5xl font-semibold tracking-tight">$0</p>
              <ul className="mt-8 space-y-3.5 text-ink-2">
                {[
                  "The full live landscape graph, assembled for your idea",
                  "5 agent questions, answered by graph traversal",
                  "Node expansion, company timelines, source citations",
                ].map((f) => (
                  <li key={f} className="flex gap-3 leading-relaxed">
                    <span className="mt-2.5 h-1 w-1 shrink-0 rounded-full bg-ink/40" />
                    {f}
                  </li>
                ))}
              </ul>
              <div className="mt-auto pt-10">
                <CtaButton href="/start" tone="ghost">
                  Try it out
                </CtaButton>
              </div>
            </Card>
          </Reveal>

          <Reveal delay={0.12}>
            <div className="h-full rounded-[1.75rem] border border-accent/25 bg-accent/[0.04] p-1.5">
              <div className="flex h-full flex-col rounded-[calc(1.75rem-0.375rem)] border border-line bg-white p-7 shadow-[inset_0_1px_1px_rgba(255,255,255,0.9)]">
                <span className="flex items-center justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">
                    Landscape report
                  </span>
                  <span className="rounded-full bg-wash-green px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-accent">
                    One-time
                  </span>
                </span>
                <p className="mt-4 text-5xl font-semibold tracking-tight">
                  One purchase
                </p>
                <ul className="mt-8 space-y-3.5 text-ink-2">
                  {[
                    "Full written report generated from your graph",
                    "Competitive clusters and white-space analysis",
                    "Founder pattern analysis across the space",
                    "A positioning recommendation you can act on",
                    "Unlimited agent questions",
                  ].map((f) => (
                    <li key={f} className="flex gap-3 leading-relaxed">
                      <span className="mt-2.5 h-1 w-1 shrink-0 rounded-full bg-accent" />
                      {f}
                    </li>
                  ))}
                </ul>
                <div className="mt-auto pt-10">
                  <CtaButton href="/start">Start free, upgrade in-app</CtaButton>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="relative overflow-hidden border-t border-line">
      <div
        className="pointer-events-none absolute inset-0 [mask-image:radial-gradient(60%_80%_at_50%_100%,black,transparent)]"
        style={{
          backgroundImage: "radial-gradient(var(--border) 1px, transparent 1px)",
          backgroundSize: "26px 26px",
        }}
      />
      <div className="relative mx-auto max-w-4xl px-6 py-32 text-center md:py-44">
        <Reveal>
          <Eyebrow>Day zero starts now</Eyebrow>
        </Reveal>
        <Reveal delay={0.1}>
          <h2 className="mt-8 text-5xl font-semibold leading-[1.05] tracking-tight md:text-7xl">
            The landscape is
            <br />
            already forming.
          </h2>
        </Reveal>
        <Reveal delay={0.22}>
          <p className="mx-auto mt-8 max-w-md text-lg leading-relaxed text-ink-2">
            Type one sentence. Watch who&apos;s already building your idea —
            and where they&apos;ve left you room.
          </p>
        </Reveal>
        <Reveal delay={0.34}>
          <div className="mt-12 flex flex-col items-center gap-5">
            <CtaButton href="/start" large>
              Try it out
            </CtaButton>
            <Link
              href="/session/demo"
              className="text-sm text-ink-2 underline decoration-line underline-offset-4 transition-colors duration-300 hover:text-ink"
            >
              or explore the live demo first
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-10 md:flex-row md:items-center md:justify-between">
        <p className="text-sm text-ink-2">
          <span className="font-semibold text-ink">Rivalry</span> — competitive
          landscape graphs for idea-stage founders.
        </p>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-2/70">
          HackwithBay 3.0 · Neo4j · RocketRide Cloud · Butterbase
        </p>
      </div>
    </footer>
  );
}

/* ---------- page ---------- */

export default function LandingPage() {
  return (
    <MotionConfig reducedMotion="user">
      <div className="relative min-h-[100dvh] bg-canvas text-ink">
        {/* film grain */}
        <div
          className="pointer-events-none fixed inset-0 z-50 opacity-[0.035]"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
          }}
        />
        <Nav />
        <main>
          <Hero />
          <Problem />
          <HowItWorks />
          <Features />
          <Pricing />
          <FinalCta />
        </main>
        <Footer />
      </div>
    </MotionConfig>
  );
}
