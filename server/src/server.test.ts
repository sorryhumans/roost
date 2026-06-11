// Hermetic, READ-ONLY backend test for the Studio SSE server.
//
// Everything here runs against an INJECTED FAKE collector — the test never
// touches the real filesystem, tmux, or any agent transcript/metric file. It
// proves the three contract guarantees:
//   1. GET /events streams text/event-stream and the FIRST `data:` frame is a
//      length-4 AgentState array (the live snapshot the UI subscribes to).
//   2. GET /healthz -> { ok: true }.
//   3. SAFE-01 / read-only: the server exposes NO mutating or input-accepting
//      route — POST /events (and other non-GET methods) return 404, so nothing
//      a client sends can ever reach an agent.

import { describe, it, expect } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { buildServer } from './server.js';
import type { AgentState } from './types.js';

/**
 * Four minimal-but-valid AgentState entries in registry order, mirroring the
 * real collector's contract (exactly 4, ids general/etsy/upwork/appdev). Used
 * as the injected collector so the test is fully hermetic.
 */
function fakeState(): AgentState[] {
  const ids = ['general', 'etsy', 'upwork', 'appdev'] as const;
  const statuses = ['working', 'online-idle', 'offline', 'unknown'] as const;
  return ids.map((id, i) => ({
    id,
    displayName: id[0].toUpperCase() + id.slice(1),
    status: statuses[i],
    currentActivity: statuses[i] === 'working' ? 'Running a command' : null,
    recentEvents: [],
    metric: { label: 'Status', value: i },
    lastActiveTs: statuses[i] === 'unknown' ? null : '2026-06-08T20:00:00.000Z',
  }));
}

describe('buildServer (read-only SSE backend)', () => {
  it('GET /healthz -> 200 { ok: true }', async () => {
    const app = buildServer({ collect: async () => fakeState() });
    try {
      const res = await app.inject({ method: 'GET', url: '/healthz' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    } finally {
      await app.close();
    }
  });

  it('GET /events streams text/event-stream and the first data frame is a length-4 array', async () => {
    // SSE hijacks the reply, so drive a REAL request against an ephemeral
    // loopback port and read the first `data:` frame off the live stream.
    const app = buildServer({ collect: async () => fakeState() });
    try {
      await app.listen({ host: '127.0.0.1', port: 0 });
      const { port } = app.server.address() as AddressInfo;

      const { contentType, firstData } = await readFirstSseFrame(port);

      expect(contentType).toContain('text/event-stream');

      const parsed = JSON.parse(firstData) as unknown;
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed as unknown[]).toHaveLength(4);
    } finally {
      await app.close();
    }
  });

  it('SAFE-01/read-only: exposes no mutating or input-accepting route (POST/PUT/PATCH/DELETE -> 404)', async () => {
    // The server must accept nothing that could carry agent-directed input.
    // Every non-GET method on every endpoint is unhandled => 404.
    const app = buildServer({ collect: async () => fakeState() });
    try {
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
        for (const url of ['/events', '/healthz', '/']) {
          const res = await app.inject({ method, url });
          expect(res.statusCode).toBe(404);
        }
      }
    } finally {
      await app.close();
    }
  });
});

/**
 * Open a real GET /events request on 127.0.0.1:<port>, resolve with the
 * response Content-Type and the payload of the first `data:` line, then abort
 * the request. A short timeout guard makes a regression FAIL FAST instead of
 * hanging the suite.
 */
function readFirstSseFrame(
  port: number,
): Promise<{ contentType: string; firstData: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: '/events' },
      (res) => {
        const contentType = String(res.headers['content-type'] ?? '');
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          buf += chunk;
          // SSE frames are terminated by a blank line. Grab the first complete
          // `data:` line as soon as we have one.
          const match = buf.match(/^data: (.*)$/m);
          if (match) {
            cleanup();
            req.destroy();
            resolve({ contentType, firstData: match[1] });
          }
        });
        res.on('error', onError);
      },
    );

    const timer = setTimeout(() => {
      cleanup();
      req.destroy();
      reject(new Error('timed out waiting for the first SSE data frame'));
    }, 4000);
    timer.unref?.();

    req.on('error', onError);

    function onError(err: Error): void {
      cleanup();
      req.destroy();
      reject(err);
    }
    function cleanup(): void {
      clearTimeout(timer);
    }
  });
}
