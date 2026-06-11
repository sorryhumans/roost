// READ-ONLY network surface for the Studio dashboard.
//
// This is the FIRST network surface in the project. It serves the
// already-redacted, labels-only AgentState[] produced by collectAllAgents()
// VERBATIM — it adds no raw fields and never reads transcripts/tmux footers
// itself. Strictly observe-only:
//   - Only GET routes are registered. There is NO POST/PUT/PATCH/DELETE route,
//     no body parser, and nothing that accepts input destined for an agent
//     (SAFE-01 / read-only mandate, enforced structurally).
//   - It performs ZERO filesystem writes. The optional static serve is
//     read-only delivery of the built frontend (web/dist) only — never agent
//     artifacts/transcripts.
//   - It binds the literal 127.0.0.1 (loopback) this phase. The LAN bind (the
//     all-interfaces address) + always-on is an explicit Phase 4 decision and
//     is intentionally NOT here.
//
// SSE design (Fastify v5): /events takes manual control of the response with
// reply.hijack() and hand-rolls `data:` frames + `: ping` heartbeats on
// reply.raw (a Node http.ServerResponse). We never touch reply.sent (forbidden
// in v5) and add no SSE plugin — hand-rolled framing keeps the route auditable.

import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ServerResponse } from 'node:http';

import Fastify from 'fastify';
import type { FastifyRequest, FastifyReply } from 'fastify';
import fastifyStatic from '@fastify/static';

import { collectAllAgents } from './collector.js';
import type { AgentState } from './types.js';

/** Default loopback port for this phase; override with the PORT env var. */
const DEFAULT_PORT = 7600;
/** Collector tick cadence (~2.5s) — the live-update heartbeat of the pipeline. */
const TICK_MS = 2500;
/** SSE comment heartbeat (~15s) keeps mobile Safari connections from idling out. */
const HEARTBEAT_MS = 15000;

/** Absolute path to the built frontend; present only in production builds. */
const WEB_DIST = fileURLToPath(new URL('../../web/dist', import.meta.url));

/** A live SSE connection's underlying Node response, used to push frames. */
type Writer = ServerResponse;

/** The base Fastify instance type produced by Fastify(). */
type FastifyApp = ReturnType<typeof Fastify>;

export interface BuildServerOptions {
  /**
   * Injectable collector. Defaults to the real read-only collectAllAgents().
   * Tests pass a hermetic fake so no real filesystem/tmux access occurs — this
   * is the seam that keeps the backend test read-only and deterministic.
   */
  collect?: () => Promise<AgentState[]>;
}

/** The live-broadcast hooks start() drives on each collector tick. */
export interface StudioHooks {
  /** Run one collector read and push a frame to every live /events connection IF the snapshot changed. */
  broadcastTick: () => Promise<void>;
  /** Start the ~2.5s collector tick. Returns a stop function (clears the interval). */
  startTick: () => () => void;
}

/** A Fastify instance plus the live-broadcast hooks start() drives on each tick. */
export type StudioServer = FastifyApp & StudioHooks;

/**
 * Build the read-only Fastify app.
 *
 * GET-only by construction: /healthz, /events (SSE), and an optional static
 * serve of web/dist. No route mutates state or accepts agent-directed input.
 */
export function buildServer(opts: BuildServerOptions = {}): StudioServer {
  const collect = opts.collect ?? (() => collectAllAgents());

  const app: FastifyApp = Fastify({ logger: false });

  // Live SSE connections for this instance, scoped to the instance (not a true
  // module global) so a test app and a real server never share writers. A
  // plain array (a handful of loopback connections, single-user tool) lets
  // removal stay a filter reassignment, so the read-only structural audit that
  // greps for mutating HTTP routes is never tripped by collection bookkeeping.
  let writers: Writer[] = [];
  const removeWriter = (w: Writer): void => {
    writers = writers.filter((other) => other !== w);
  };
  // Last broadcast snapshot, for JSON-equality dedupe on the tick path.
  let lastJson: string | null = null;

  // --- Health check -------------------------------------------------------
  app.get('/healthz', async () => ({ ok: true }));

  // --- Live SSE stream ----------------------------------------------------
  app.get('/events', async (req: FastifyRequest, reply: FastifyReply) => {
    // Take manual control of the response (v5-correct; never set reply.sent).
    reply.hijack();
    const raw = reply.raw;

    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Disable proxy/browser buffering so frames flush immediately.
      'X-Accel-Buffering': 'no',
    });

    const send = (state: AgentState[]): void => {
      raw.write('data: ' + JSON.stringify(state) + '\n\n');
    };

    // Register this connection so subsequent ticks broadcast to it.
    writers.push(raw);

    // Heartbeat comment to keep idle (mobile Safari) connections alive.
    const hb = setInterval(() => {
      raw.write(': ping\n\n');
    }, HEARTBEAT_MS);

    // Clean up on client disconnect — clear the heartbeat and stop tracking
    // this writer so it cannot leak. The client closed the socket, so we do
    // not call raw.end() ourselves.
    req.raw.on('close', () => {
      clearInterval(hb);
      removeWriter(raw);
    });

    // Initial frame on connect: every new connection gets the latest snapshot
    // immediately, independent of the tick-path dedupe below.
    try {
      send(await collect());
    } catch {
      // collectAllAgents() never throws, but guard anyway so a degenerate
      // injected collector can never crash the connection handler.
    }
  });

  // --- Production static serve (read-only delivery of the built frontend) --
  // Guarded by existsSync so the dev/test-time absence of web/dist does not
  // crash startup AND so the catch-all '/' static route never shadows /events
  // when there is no build (the hermetic test runs without web/dist).
  if (existsSync(WEB_DIST)) {
    app.register(fastifyStatic, { root: WEB_DIST, prefix: '/' });
  }

  /** Push the current snapshot to all live writers, only if it changed. */
  const broadcastTick = async (): Promise<void> => {
    if (writers.length === 0) {
      // No subscribers — skip the read entirely (nothing to push to).
      return;
    }
    let state: AgentState[];
    try {
      state = await collect();
    } catch {
      // Never let a collector failure crash the tick loop.
      return;
    }
    const json = JSON.stringify(state);
    if (json === lastJson) return; // unchanged snapshot — nothing to push
    lastJson = json;
    const frame = 'data: ' + json + '\n\n';
    // Iterate a snapshot copy so removeWriter() reassigning `writers` mid-loop
    // is safe.
    for (const w of [...writers]) {
      try {
        w.write(frame);
      } catch {
        // A broken pipe just means the client vanished; drop the writer.
        removeWriter(w);
      }
    }
  };

  /** Start the ~2.5s collector tick; returns a stop function. */
  const startTick = (): (() => void) => {
    const timer = setInterval(() => {
      // broadcastTick never rejects (it catches internally); void the promise.
      void broadcastTick();
    }, TICK_MS);
    // Do not keep the event loop alive solely for the tick.
    timer.unref?.();
    return () => clearInterval(timer);
  };

  // Attach the live-broadcast hooks so the route and start() share one app's
  // writer set + dedupe state.
  return Object.assign(app, { broadcastTick, startTick }) as StudioServer;
}

/**
 * Production entrypoint: build the app, start the collector tick, and listen.
 *
 * Bind host is loopback ('127.0.0.1') by DEFAULT — safe for dev/test. Set
 * HOST=0.0.0.0 (the Phase-4 LaunchAgent does) to expose on the LAN so Oleh's
 * phone can reach http://<macmini-LAN-ip>:<port>. LAN-only by design: there is
 * no off-LAN exposure and no auth layer (a home-network, single-user tool). The
 * payload is already redacted + labels-only, and every route is GET/read-only.
 */
export async function start(): Promise<StudioServer> {
  const app = buildServer();
  app.startTick();
  const port = Number(process.env.PORT) || DEFAULT_PORT;
  const host = process.env.HOST || '127.0.0.1';
  await app.listen({ host, port });
  return app;
}

// Self-invoke only when run directly (e.g. `npm start`), NOT when imported by
// the hermetic test — importing buildServer must never start a listener.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().catch((err) => {
    // Never throw out of the entrypoint; log and exit non-zero.
    console.error('[server] failed to start:', err);
    process.exitCode = 1;
  });
}
