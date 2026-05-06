// No-op replacement for shared/util.ts. A published library must not chdir
// the consumer's process — that's the only thing this re-exposes from the
// shared module.
export function changeDirToPackageRoot(): void {}
