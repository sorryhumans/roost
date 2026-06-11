// Source B — optional tmux presence (online signal for idle agents).
//
// READ-ONLY (SAFE-03), proven structurally:
//  - Spawned via execFile (NOT exec) with FIXED arg arrays -> no shell, so there
//    is no shell-injection surface.
//  - ONLY two subcommands are ever used: `list-windows` and `capture-pane`.
//    No mutating tmux subcommand appears anywhere in this file (the read-only
//    proof test scans the source for the forbidden subcommand strings, so we do
//    not even name them here).
//  - Session names come from roost.config.json and are passed as a single argv
//    element (never through a shell).
//  - A short timeout prevents a hung tmux from blocking the collector.
//  - capture-pane output (an unstructured TUI footer that may contain secrets)
//    is passed through redact() before returning.
//
// Both functions catch ALL errors (no tmux installed, no session, no pane) and
// return a safe empty value; they never throw.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { redact } from '../redact.js';

const execFileAsync = promisify(execFile);

/** Kill a hung tmux call after this many ms so it cannot block the collector. */
const TMUX_TIMEOUT_MS = 2000;

/** Conservative session/window name guard (single argv element, no separators). */
const SAFE_NAME = /^[\w.-]{1,64}$/;

/**
 * List the window names of one tmux session.
 * Read-only: `tmux list-windows -t <session> -F #{window_name}`.
 * Returns [] on any error (no tmux, no session). Never throws.
 */
export async function listWindows(session: string): Promise<string[]> {
  if (!SAFE_NAME.test(session)) return [];
  try {
    const { stdout } = await execFileAsync(
      'tmux',
      ['list-windows', '-t', session, '-F', '#{window_name}'],
      { timeout: TMUX_TIMEOUT_MS },
    );
    return stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  } catch {
    return [];
  }
}

/**
 * Capture the (read-only) pane footer for one window of one session. The
 * captured text is redact()'d before returning. Returns '' on any error or
 * when the names fail the conservative guard. Never throws.
 */
export async function capturePane(session: string, window: string): Promise<string> {
  if (!SAFE_NAME.test(session) || !SAFE_NAME.test(window)) return '';
  try {
    const { stdout } = await execFileAsync(
      'tmux',
      ['capture-pane', '-p', '-t', `${session}:${window}`],
      { timeout: TMUX_TIMEOUT_MS },
    );
    return redact(stdout);
  } catch {
    return '';
  }
}
