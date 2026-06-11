// Dev-only ESM resolver hook for running TypeScript directly via Node's
// --experimental-strip-types on Node 22.
//
// Why this exists: the project uses NodeNext, so relative imports in source
// carry the ".js" extension (e.g. `import { x } from './sources/transcript.js'`)
// — this is what `tsc` and Vitest require. But Node 22's type-stripping does NOT
// rewrite a ".js" specifier to its sibling ".ts" at runtime; it looks for a
// literal ".js" file and fails with ERR_MODULE_NOT_FOUND. (Verified on
// Node v22.22.x: bare `node --experimental-strip-types src/cli.ts` cannot resolve
// the `.js` imports.)
//
// This resolver maps a relative ".js" specifier to the sibling ".ts" file when
// that ".ts" exists, letting the dev CLI run straight from source with no build
// step and no extra runtime dependency. It is NOT product code: it resolves
// module specifiers only and lives outside src/ so the read-only-source audit
// (which scans server/src/) is unaffected. It performs no fs writes.
//
// Usage (see package.json "dev" script):
//   node --experimental-strip-types --import ./tools/register-ts-loader.mjs src/cli.ts

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function resolve(specifier, context, next) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && specifier.endsWith('.js')) {
    const tsSpecifier = specifier.slice(0, -3) + '.ts';
    try {
      const resolvedTs = new URL(tsSpecifier, context.parentURL);
      if (existsSync(fileURLToPath(resolvedTs))) {
        return next(tsSpecifier, context);
      }
    } catch {
      // fall through to default resolution
    }
  }
  return next(specifier, context);
}
