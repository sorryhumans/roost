import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Stub node:child_process.execFile. The promisified form (util.promisify) calls
// execFile(file, args, options, callback); we drive that callback per test.
const execFileMock = vi.fn();
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

import { listWindows, capturePane } from './tmux.js';

const HERE = dirname(fileURLToPath(import.meta.url));

function lastCall() {
  const call = execFileMock.mock.calls.at(-1)!;
  const file = call[0] as string;
  const argv = call[1] as string[];
  return { file, argv };
}

function resolveWith(stdout: string) {
  execFileMock.mockImplementation((_file: string, _args: string[], _opts: unknown, cb: unknown) => {
    const callback = (typeof _opts === 'function' ? _opts : cb) as (
      e: Error | null,
      r: { stdout: string; stderr: string },
    ) => void;
    callback(null, { stdout, stderr: '' });
  });
}

function rejectWith(message: string) {
  execFileMock.mockImplementation((_file: string, _args: string[], _opts: unknown, cb: unknown) => {
    const callback = (typeof _opts === 'function' ? _opts : cb) as (e: Error | null) => void;
    callback(new Error(message));
  });
}

beforeEach(() => {
  execFileMock.mockReset();
});

describe('tmux source (read-only)', () => {
  it('listWindows parses #{window_name} lines via fixed-arg list-windows', async () => {
    resolveWith('writer\ncoder\n');
    const windows = await listWindows('agents');
    expect(windows).toEqual(['writer', 'coder']);
    const { file, argv } = lastCall();
    expect(file).toBe('tmux');
    expect(argv).toEqual(['list-windows', '-t', 'agents', '-F', '#{window_name}']);
  });

  it('listWindows returns [] on execFile error (no throw)', async () => {
    rejectWith('no server running');
    await expect(listWindows('agents')).resolves.toEqual([]);
  });

  it('listWindows rejects an unsafe session name WITHOUT invoking tmux', async () => {
    resolveWith('SHOULD NOT BE CALLED');
    await expect(listWindows('bad; rm -rf /')).resolves.toEqual([]);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('capturePane builds capture-pane args and redacts output', async () => {
    resolveWith('working... token ' + ['8755576837', 'XXHsecretTOKENvaluefakefakefake123456'].join(':') + ' +48555123760');
    const out = await capturePane('agents', 'writer');
    const { file, argv } = lastCall();
    expect(file).toBe('tmux');
    expect(argv).toEqual(['capture-pane', '-p', '-t', 'agents:writer']);
    expect(out).not.toContain(['8755576837', 'XXHsecretTOKENvaluefakefakefake123456'].join(':'));
    expect(out).not.toContain('+48555123760');
    expect(out).toContain('[token]');
  });

  it('capturePane rejects an unsafe window name WITHOUT invoking tmux', async () => {
    resolveWith('SHOULD NOT BE CALLED');
    const out = await capturePane('agents', 'not-an-agent; rm -rf /');
    expect(out).toBe('');
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('capturePane returns "" on execFile error (no throw)', async () => {
    rejectWith('pane gone');
    await expect(capturePane('agents', 'writer')).resolves.toBe('');
  });

  it('SOURCE FILE contains no mutating tmux subcommands (read-only proof)', async () => {
    const src = await readFile(join(HERE, 'tmux.ts'), 'utf8');
    for (const forbidden of ['send-keys', 'kill', 'attach', 'new-window', 'set-option']) {
      expect(src).not.toContain(forbidden);
    }
    expect(src).toContain('execFile');
    expect(src).toContain('list-windows');
    expect(src).toContain('capture-pane');
  });
});
