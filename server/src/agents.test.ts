import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildAgents } from './agents.js';
import { MAX_AGENTS, resolveTranscriptDir, loadConfig } from './config.js';
import type { RoostConfig } from './config.js';

const here = dirname(fileURLToPath(import.meta.url));

const CFG: RoostConfig = {
  agents: [
    { id: 'writer', name: 'Writer', project: '/home/me/projects/blog_agent' },
    {
      id: 'coder',
      name: 'Coder',
      project: '/home/me/projects/coder',
      tmux: { session: 'agents', window: 'coder' },
      metric: { type: 'fileCount', dir: '/home/me/projects/coder/out', label: 'Builds' },
    },
  ],
};

describe('buildAgents (config -> registry)', () => {
  it('keeps config order and maps fields', () => {
    const agents = buildAgents(CFG, (p) => `/resolved${p}`);
    expect(agents.map((a) => a.id)).toEqual(['writer', 'coder']);
    expect(agents[0].displayName).toBe('Writer');
    expect(agents[0].tmuxSession).toBeUndefined();
    expect(agents[1].tmuxSession).toBe('agents');
    expect(agents[1].tmuxWindow).toBe('coder');
    expect(agents[1].metric).toEqual({
      type: 'fileCount',
      dir: '/home/me/projects/coder/out',
      label: 'Builds',
    });
  });

  it('records a null transcriptDir when the project cannot be located', () => {
    const agents = buildAgents(CFG, () => null);
    expect(agents[0].transcriptDir).toBeNull();
  });
});

describe('loadConfig validation', () => {
  const load = (obj: unknown) => {
    const p = join(tmpdir(), `roost-config-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(p, JSON.stringify(obj));
    try {
      return loadConfig(p);
    } finally {
      unlinkSync(p);
    }
  };

  it('accepts a minimal valid config', () => {
    const cfg = load({ agents: [{ id: 'a', name: 'A', project: '/x' }] });
    expect(cfg.agents).toHaveLength(1);
  });

  it('rejects empty agents, duplicates, too many, bad ids and relative paths', () => {
    expect(() => load({ agents: [] })).toThrow(/non-empty/);
    expect(() =>
      load({
        agents: [
          { id: 'a', name: 'A', project: '/x' },
          { id: 'a', name: 'B', project: '/y' },
        ],
      }),
    ).toThrow(/duplicate/);
    expect(() =>
      load({
        agents: Array.from({ length: MAX_AGENTS + 1 }, (_, i) => ({
          id: `a${i}`,
          name: 'A',
          project: '/x',
        })),
      }),
    ).toThrow(/4 desks/);
    expect(() => load({ agents: [{ id: 'bad id!', name: 'A', project: '/x' }] })).toThrow(/id/);
    expect(() => load({ agents: [{ id: 'a', name: 'A', project: 'relative' }] })).toThrow(
      /absolute/,
    );
  });

  it('throws a setup hint when no config file exists anywhere', () => {
    expect(() => loadConfig(join(here, 'definitely-missing.json'))).toThrow(
      /roost\.config\.json/,
    );
  });
});

describe('resolveTranscriptDir', () => {
  it('matches the encoded Claude Code dir by normalized name', () => {
    // fixture: a fake ~/.claude/projects with one encoded entry
    const root = mkdtempSync(join(tmpdir(), 'roost-projects-'));
    const encoded = '-home-me-projects-blog-agent';
    mkdirSync(join(root, encoded));
    try {
      expect(resolveTranscriptDir('/home/me/projects/blog_agent', root)).toBe(
        join(root, encoded),
      );
      expect(resolveTranscriptDir('/home/me/projects/unknown', root)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// No machine coupling: the registry source must not hardcode any user's home path.
it('agents.ts + config.ts hardcode no absolute /Users path', () => {
  for (const f of ['agents.ts', 'config.ts']) {
    const source = readFileSync(join(here, f), 'utf8');
    expect(source.includes('/Users/')).toBe(false);
  }
});
