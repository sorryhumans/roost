// office-hq-server — read-only collector for the Studio observability dashboard.
//
// Phase 1 builds the collector primitives. Public exports are wired up as the
// source readers and assembler land (types.ts, agents.ts, redact.ts in this
// plan; sources + collectAllAgents() in Plan 02).
//
// This file is the package entry point and keeps `tsc --noEmit` honest from the
// very first scaffold commit (the project always has at least one input).

export const COLLECTOR_NAME = 'office-hq-server';
