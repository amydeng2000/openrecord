// Shared scraper code (e.g. shared/telemetry.ts) probes for the Bun runtime
// with `typeof Bun !== 'undefined'`. The MCPB bundle runs under Claude
// Desktop's Node, where `Bun` is absent — declare it loosely so the guard
// typechecks under both runtimes without pulling in all of @types/bun.
declare const Bun: { version: string } | undefined;
