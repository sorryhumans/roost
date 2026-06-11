// Dev entrypoint: print the collected AgentState[] snapshot as JSON to stdout.
//
// This is the ONLY place in src/ that produces output, and it writes ONLY to
// process.stdout — never to the filesystem (SAFE-03). Run via the project's
// `dev` script, which loads TypeScript through a small .js->.ts resolver so the
// NodeNext `.js` import specifiers resolve at runtime on Node 22.
//
// It is resilient: collectAllAgents() never throws, but we still guard so a
// catastrophic failure prints an empty array instead of crashing.

import { collectAllAgents } from './collector.js';

async function main(): Promise<void> {
  try {
    const state = await collectAllAgents();
    process.stdout.write(JSON.stringify(state, null, 2) + '\n');
  } catch {
    // Never throw out of the CLI; emit an empty array on total failure.
    process.stdout.write('[]\n');
  }
}

void main();
