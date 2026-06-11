import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { minutesAgoLabel, resolveMetric } from './metrics.js';
import type { AgentDefinition } from '../types.js';

const BASE: AgentDefinition = { id: 'a', displayName: 'A', transcriptDir: '/t/a' };

describe('minutesAgoLabel', () => {
  it('handles null, garbage, just-now and floored minutes', () => {
    expect(minutesAgoLabel(null)).toBe('--');
    expect(minutesAgoLabel('not-a-date')).toBe('--');
    expect(minutesAgoLabel(new Date(Date.now() - 30_000).toISOString())).toBe('just now');
    expect(minutesAgoLabel(new Date(Date.now() - 5 * 60_000 - 5_000).toISOString())).toBe('5m ago');
  });
});

describe('resolveMetric', () => {
  it('defaults to a last-active metric', async () => {
    const m = await resolveMetric(BASE, {
      lastActiveTs: new Date(Date.now() - 3 * 60_000).toISOString(),
    });
    expect(m.label).toBe('Last active');
    expect(m.value).toBe('3m ago');
  });

  it('honors a custom lastActive label', async () => {
    const m = await resolveMetric(
      { ...BASE, metric: { type: 'lastActive', label: 'Seen' } },
      { lastActiveTs: null },
    );
    expect(m).toEqual({ label: 'Seen', value: '--' });
  });

  it('fileCount counts visible entries and names the freshest (hidden/_ excluded)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'roost-metric-'));
    try {
      mkdirSync(join(dir, 'post-one'));
      writeFileSync(join(dir, 'post-two.md'), 'x');
      writeFileSync(join(dir, '.hidden'), 'x');
      mkdirSync(join(dir, '_draft'));
      const m = await resolveMetric(
        { ...BASE, metric: { type: 'fileCount', dir, label: 'Posts' } },
        { lastActiveTs: null },
      );
      expect(m.label).toBe('Posts');
      expect(m.value).toBe(2);
      expect(typeof m.detail).toBe('string');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fileCount degrades to -- when the dir is missing', async () => {
    const m = await resolveMetric(
      { ...BASE, metric: { type: 'fileCount', dir: '/definitely/missing', label: 'Posts' } },
      { lastActiveTs: null },
    );
    expect(m).toEqual({ label: 'Posts', value: '--' });
  });
});
