import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, copyFile, utimes, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTranscript, WORKING_THRESHOLD_MS } from './transcript.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', '..', 'test', 'fixtures', 'transcripts');

// Raw secret/PII strings embedded in secrets.jsonl. The structural-defense
// guarantee is that NONE of these ever appear in a derived label.
const RAW_TOKEN = '8755576837:AAHsecretTOKENvaluefakefakefake123456';
const RAW_PHONE = '+48555123760';

/**
 * Copy a committed fixture into a fresh tmp dir as the (only) .jsonl, then set
 * its mtime. Returns the tmp dir to hand to readTranscript. We never mutate the
 * committed fixture so reruns stay deterministic.
 */
interface Staged {
  /** Directory to hand to readTranscript. */
  dir: string;
  /** The staged .jsonl path. */
  file: string;
}

async function stageFixture(fixtureName: string, mtimeMs: number): Promise<Staged> {
  const dir = await mkdtemp(join(tmpdir(), 'tx-'));
  const file = join(dir, 'session.jsonl');
  await copyFile(join(FIXTURES, fixtureName), file);
  const t = new Date(mtimeMs);
  await utimes(file, t, t);
  return { dir, file };
}

/**
 * The ISO that readTranscript will report for `lastActiveTs` — derived from the
 * SAME source of truth (the staged file's actual stat().mtimeMs). The OS may
 * store mtime with sub-ms precision, so we must compare against what stat
 * round-trips, not the integer ms we passed to utimes.
 */
async function expectedLastActiveIso(file: string): Promise<string> {
  const st = await stat(file);
  return new Date(st.mtimeMs).toISOString();
}

const created: string[] = [];
async function staged(fixtureName: string, mtimeMs: number): Promise<Staged> {
  const s = await stageFixture(fixtureName, mtimeMs);
  created.push(s.dir);
  return s;
}

afterAll(async () => {
  await Promise.all(created.map((d) => rm(d, { recursive: true, force: true })));
});

describe('readTranscript', () => {
  it('exports WORKING_THRESHOLD_MS = 25000', () => {
    expect(WORKING_THRESHOLD_MS).toBe(25000);
  });

  it('fresh transcript ending in a Bash tool_use -> fresh, "Running a command"', async () => {
    const { dir } = await staged('working.jsonl', Date.now());
    const r = await readTranscript(dir);
    expect(r.ok).toBe(true);
    expect(r.fresh).toBe(true);
    expect(r.currentActivity).toBe('Running a command');
    expect(r.lastActiveTs).not.toBeNull();
  });

  it('recentEvents are newest-first, capped at 10, {ts,label} labels only', async () => {
    const { dir } = await staged('working.jsonl', Date.now());
    const r = await readTranscript(dir);
    expect(Array.isArray(r.recentEvents)).toBe(true);
    expect(r.recentEvents.length).toBeGreaterThan(0);
    expect(r.recentEvents.length).toBeLessThanOrEqual(10);
    // newest-first: the Bash tool_use is the last line, so first event reflects it.
    expect(r.recentEvents[0].label).toBe('Running a command');
    for (const e of r.recentEvents) {
      expect(typeof e.ts).toBe('string');
      expect(typeof e.label).toBe('string');
      // labels-only: no event carries any extra keys (no raw content fields).
      expect(Object.keys(e).sort()).toEqual(['label', 'ts']);
    }
  });

  it('stale transcript -> fresh:false with lastActiveTs at the file mtime', async () => {
    const old = Date.now() - 60 * 60 * 1000; // 1h ago
    const { dir, file } = await staged('idle.jsonl', old);
    const r = await readTranscript(dir);
    expect(r.ok).toBe(true);
    expect(r.fresh).toBe(false);
    // last meaningful line is an assistant text block.
    expect(r.currentActivity).toBe('Thinking / replying');
    // Compare against the actual stat'd mtime (OS sub-ms precision robust).
    expect(r.lastActiveTs).toBe(await expectedLastActiveIso(file));
    // And sanity: it is roughly an hour old (within a 2s window).
    expect(Math.abs(Date.parse(r.lastActiveTs!) - old)).toBeLessThan(2000);
  });

  it('partial/truncated final line is skipped without throwing; activity from prior lines', async () => {
    const { dir } = await staged('partial.jsonl', Date.now());
    const r = await readTranscript(dir);
    expect(r.ok).toBe(true);
    // The truncated final Bash line is invalid JSON and skipped; the newest valid
    // meaningful line is the Edit tool_use.
    expect(r.currentActivity).toBe('Editing a file');
  });

  it('missing dir -> { ok:false, ... } without throwing', async () => {
    const r = await readTranscript(join(tmpdir(), 'does-not-exist-' + Date.now()));
    expect(r.ok).toBe(false);
    expect(r.fresh).toBe(false);
    expect(r.currentActivity).toBeNull();
    expect(r.recentEvents).toEqual([]);
    expect(r.lastActiveTs).toBeNull();
  });

  it('SECRETS: no raw token/phone appears in currentActivity or any recentEvents label (structural defense)', async () => {
    const { dir } = await staged('secrets.jsonl', Date.now());
    const r = await readTranscript(dir);
    // Newest line is a telegram-reply tool_use -> friendly label, NOT raw input.
    expect(r.currentActivity).toBe('Replying on Telegram');
    const haystacks = [r.currentActivity ?? '', ...r.recentEvents.map((e) => e.label)];
    for (const secret of [RAW_TOKEN, RAW_PHONE]) {
      for (const h of haystacks) {
        expect(h).not.toContain(secret);
        // also assert the recognizable secret prefixes never leak
        expect(h).not.toContain('8755576837');
        expect(h).not.toContain('555123760');
      }
    }
    // And the whole serialized result must not contain the raw secrets either.
    const blob = JSON.stringify(r);
    expect(blob).not.toContain(RAW_TOKEN);
    expect(blob).not.toContain(RAW_PHONE);
  });
});
