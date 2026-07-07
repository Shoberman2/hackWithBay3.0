/**
 * SSE endpoint streaming PipelineEvents to the client.
 *
 * GET /api/pipeline/stream?idea=...&sessionId=...&tags=a,b&terms=x,y
 *
 * Named events (entity | status | insight | done) with a JSON payload,
 * 15s comment pings for keep-alive, cleanup on client abort.
 */

import type { NextRequest } from "next/server";
import { env } from "@/lib/env";
import { runPipeline } from "@/lib/pipeline/conductor";

export const dynamic = "force-dynamic";

const PING_INTERVAL_MS = 15_000;

function csv(value: string | null): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function GET(req: NextRequest): Promise<Response> {
  const params = req.nextUrl.searchParams;
  const idea = params.get("idea") ?? "internship platform";
  const sessionId = params.get("sessionId") ?? "demo-session";
  const tags = csv(params.get("tags"));
  const terms = csv(params.get("terms"));

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;

      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const send = (event: string, data: unknown) => {
        write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      const ping = setInterval(() => write(`: ping\n\n`), PING_INTERVAL_MS);
      const generator = runPipeline(idea, tags, sessionId, terms);

      const onAbort = () => {
        closed = true;
        clearInterval(ping);
        void generator.return(undefined);
      };
      req.signal.addEventListener("abort", onAbort);

      try {
        for await (const event of generator) {
          if (closed) break;
          send(event.type, event);
        }
      } catch (err) {
        if (env.DEBUG) console.error("[pipeline/stream]", err);
        send("status", {
          type: "status",
          stage: "extract",
          message: "Pipeline error; stream ended early",
        });
      } finally {
        clearInterval(ping);
        req.signal.removeEventListener("abort", onAbort);
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // already closed by abort
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
