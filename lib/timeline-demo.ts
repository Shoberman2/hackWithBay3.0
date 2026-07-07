/**
 * Canned live-enrichment timelines for demo mode, keyed by lowercase
 * company name. These carry the well-documented history that is NOT in
 * fixtures/demo-graph.json (early rounds, rebrands, expansions, exits)
 * so the timeline popup reads as a complete startup story with zero
 * credentials. Server-side only (imported by the timeline API route).
 */

import type { TimelineEvent } from "@/lib/timeline";

function ev(
  company: string,
  n: number,
  event: Omit<TimelineEvent, "id" | "origin">,
): TimelineEvent {
  return { id: `demo:${company}:${n}`, origin: "live", ...event };
}

const DEMO_TIMELINES: Record<string, TimelineEvent[]> = {
  handshake: [
    ev("handshake", 1, {
      kind: "milestone",
      date: "2014",
      title: "Started at Michigan Tech to fix non-coastal campus recruiting",
      detail:
        "The founding team built the first version so students far from Bay Area career fairs could reach the same employers.",
      source_url: "https://joinhandshake.com/about",
    }),
    ev("handshake", 2, {
      kind: "funding",
      date: "2015-10",
      title: "Series A — $10.5M",
      detail: "Led by Kleiner Perkins to expand the university network beyond the Midwest.",
      actors: ["Kleiner Perkins"],
      source_url: "https://techcrunch.com/2015/10/07/handshake-series-a/",
    }),
    ev("handshake", 3, {
      kind: "funding",
      date: "2017",
      title: "Series B — $20M",
      detail: "Led by Spark Capital as campus partnerships crossed into the hundreds.",
      actors: ["Spark Capital"],
      source_url: "https://techcrunch.com/2017/04/05/handshake-series-b/",
    }),
    ev("handshake", 4, {
      kind: "funding",
      date: "2018-06",
      title: "Series C — $40M",
      detail: "Led by EQT Ventures; employer side of the marketplace opened to all companies.",
      actors: ["EQT Ventures"],
      source_url: "https://techcrunch.com/2018/06/12/handshake-series-c/",
    }),
    ev("handshake", 5, {
      kind: "funding",
      date: "2021-05",
      title: "Series E — $80M at a $1.55B valuation",
      detail: "Unicorn round led by GGV Capital with Spark Capital participating.",
      actors: ["GGV Capital", "Spark Capital"],
      source_url: "https://techcrunch.com/2021/05/12/handshake-series-e/",
    }),
    ev("handshake", 6, {
      kind: "milestone",
      date: "2021-11",
      title: "Acquires Berlin-based Talentspace to enter Europe",
      detail: "First acquisition; anchors the UK and Germany expansion announced alongside the Series F.",
      source_url: "https://joinhandshake.com/blog/talentspace/",
    }),
    ev("handshake", 7, {
      kind: "hiring",
      date: "2022-10",
      title: "Launches in the UK and opens a London office",
      detail: "First international hiring push: go-to-market and university-partnerships teams in Europe.",
      source_url: "https://joinhandshake.com/blog/handshake-uk-launch/",
    }),
    ev("handshake", 8, {
      kind: "launch",
      date: "2025-06",
      title: "Launches Handshake AI, a human-data business",
      detail:
        "New division hiring PhD-level experts to produce training data for frontier AI labs — a second revenue line beyond recruiting.",
      source_url: "https://joinhandshake.com/blog/handshake-ai/",
    }),
  ],

  wayup: [
    ev("wayup", 1, {
      kind: "launch",
      date: "2014-11",
      title: "Launches as Campus Job",
      detail: "Marketplace for part-time campus jobs; grew to hundreds of campuses in its first year.",
      source_url: "https://techcrunch.com/2015/03/18/campus-job/",
    }),
    ev("wayup", 2, {
      kind: "milestone",
      date: "2016-05",
      title: "Rebrands from Campus Job to WayUp",
      detail: "Expands from campus jobs into internships and entry-level roles for recent grads.",
      source_url: "https://techcrunch.com/2016/05/17/campus-job-rebrands-wayup/",
    }),
    ev("wayup", 3, {
      kind: "funding",
      date: "2017-06",
      title: "Series B — $18.5M",
      detail: "Raised to double down on early-career recruiting as employer demand grew.",
      source_url: "https://techcrunch.com/2017/06/22/wayup-series-b/",
    }),
    ev("wayup", 4, {
      kind: "acquisition",
      date: "2021-10",
      title: "Acquired by Yello",
      detail:
        "Recruiting-events company Yello acquires WayUp to add early-career and diversity candidate supply; terms undisclosed.",
      source_url: "https://www.yello.co/press/yello-acquires-wayup/",
    }),
  ],

  ripplematch: [
    ev("ripplematch", 1, {
      kind: "milestone",
      date: "2016",
      title: "Started out of a Yale dorm room",
      detail: "Andrew Myers left Yale to build matching software that replaces the career-fair funnel.",
      source_url: "https://ripplematch.com/about",
    }),
    ev("ripplematch", 2, {
      kind: "funding",
      date: "2019-08",
      title: "Series A — $6M",
      detail: "Raised to scale the candidate-to-employer matching engine beyond the Northeast.",
      source_url: "https://ripplematch.com/press",
    }),
    ev("ripplematch", 3, {
      kind: "hiring",
      date: "2022-03",
      title: "Doubles headcount after the Goldman-led Series B",
      detail: "Sales and engineering hiring wave in New York following the $45M round.",
      source_url: "https://ripplematch.com/press",
    }),
  ],

  forage: [
    ev("forage", 1, {
      kind: "milestone",
      date: "2019-01",
      title: "Joins Y Combinator as InsideSherpa",
      detail: "Virtual work-experience programs with a handful of banking and consulting employers.",
      source_url: "https://www.ycombinator.com/companies/forage",
    }),
    ev("forage", 2, {
      kind: "funding",
      date: "2021-01",
      title: "Series A — $9.3M",
      detail: "Led by Lightspeed Venture Partners as enrollments passed one million learners.",
      actors: ["Lightspeed"],
      source_url: "https://techcrunch.com/2021/01/13/insidesherpa-series-a/",
    }),
    ev("forage", 3, {
      kind: "milestone",
      date: "2021-02",
      title: "Rebrands from InsideSherpa to Forage",
      detail: "New name for the job-simulation platform ahead of US expansion.",
      source_url: "https://www.theforage.com/blog/forage-rebrand",
    }),
  ],

  simplify: [
    ev("simplify", 1, {
      kind: "post",
      date: "2021-08",
      title: "Copilot extension goes viral among job-seeking students",
      detail: "The Show HN launch drove the first 10K installs of the autofill extension in weeks.",
      actors: ["Michael Yan"],
      source_url: "https://news.ycombinator.com/item?id=28219343",
    }),
    ev("simplify", 2, {
      kind: "traction",
      date: "2023-01",
      title: "Reaches 500K job seekers",
      detail: "Growth driven by the free Copilot extension; monetization via employer-side matching.",
      source_url: "https://simplify.jobs/blog",
    }),
  ],
};

/** Canned enrichment for a company (demo mode), [] when unknown. */
export function demoTimeline(companyName: string): TimelineEvent[] {
  return DEMO_TIMELINES[companyName.trim().toLowerCase()] ?? [];
}
