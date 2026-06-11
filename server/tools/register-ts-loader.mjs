// Registers the .js->.ts dev resolver hook (see ts-loader.mjs) on the module
// loader, then yields. Passed to Node via `--import` so the hook is active
// before src/cli.ts is loaded. Dev-only; no fs writes.

import { register } from 'node:module';

register('./ts-loader.mjs', import.meta.url);
