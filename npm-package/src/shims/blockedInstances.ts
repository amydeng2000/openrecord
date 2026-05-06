export const BLOCKED_MYCHART_INSTANCES: readonly string[] = [
  'central.mychart.org',
];

export function isBlockedInstance(hostname: string): boolean {
  const normalized = hostname.toLowerCase().trim();
  return BLOCKED_MYCHART_INSTANCES.some(
    (blocked) => normalized === blocked || normalized.endsWith('.' + blocked)
  );
}
