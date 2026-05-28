/**
 * MyChart instance catalog — sourced from scrapers/list-all-mycharts/mychart-instances.json.
 *
 * Inlined into the bundle at build time by tsup (via `resolveJsonModule`).
 * Provides search + hostname extraction so the setup wizard can offer an
 * autocomplete-style picker without dumping 1300+ entries into a flat dropdown.
 */

import rawInstances from '../../scrapers/list-all-mycharts/mychart-instances.json';

export interface Instance {
  /** Display name, e.g. "UCHealth" */
  name: string;
  /** MyChart login URL */
  url: string;
  /** S3 logo URL (or empty string if unavailable) */
  logoUrl: string;
  /** Cached hostname extracted from the URL */
  hostname: string;
}

/**
 * Test/demo entry pointing at the deployed fake-mychart sandbox. Lets users
 * (and developers) exercise the full connect flow with Homer Simpson fake data
 * without needing real Epic credentials. The "(test)" suffix makes it obvious
 * in the picker that this is not a real health system. Credentials:
 * `homer` / `donuts123`.
 */
const FAKE_MYCHART_TEST: Instance = {
  name: 'Springfield General Hospital (test)',
  url: 'https://fake-mychart.fanpierlabs.com/MyChart/',
  logoUrl: '',
  hostname: 'fake-mychart.fanpierlabs.com',
};

const realInstances: Instance[] = (rawInstances as Array<{ name: string; url: string; logoS3Url?: string; logoUrl?: string }>).map(raw => {
  let hostname = '';
  try { hostname = new URL(raw.url).hostname.toLowerCase(); } catch { /* keep empty */ }
  return {
    name: raw.name,
    url: raw.url,
    // Prefer the public Epic-hosted logo (ichart2.epic.com). The S3 mirror
    // (logoS3Url) lives in a PRIVATE bucket — it 403s without AWS creds, which
    // the MCPB has none of (it runs on the user's machine), so it can't be
    // used directly in the widget.
    logoUrl: raw.logoUrl || raw.logoS3Url || '',
    hostname,
  };
}).filter(i => i.hostname);

// The test entry is listed first so it surfaces as a default suggestion.
const all: Instance[] = [FAKE_MYCHART_TEST, ...realInstances];

export function allInstances(): Instance[] {
  return all;
}

/**
 * Instances to surface as default suggestions before the user types anything
 * (currently just the fake-mychart test sandbox).
 */
export function featuredInstances(): Instance[] {
  return [FAKE_MYCHART_TEST];
}

/**
 * Case-insensitive substring search across the display name. Returns up
 * to `limit` matches sorted by:
 *   1. Exact (case-insensitive) name match first
 *   2. Name startsWith match
 *   3. Substring match in name
 *   4. Substring match in hostname
 */
export function searchInstances(query: string, limit = 25): Instance[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const exact: Instance[] = [];
  const startsWith: Instance[] = [];
  const nameIncludes: Instance[] = [];
  const hostnameIncludes: Instance[] = [];

  for (const inst of all) {
    const name = inst.name.toLowerCase();
    if (name === q) exact.push(inst);
    else if (name.startsWith(q)) startsWith.push(inst);
    else if (name.includes(q)) nameIncludes.push(inst);
    else if (inst.hostname.includes(q)) hostnameIncludes.push(inst);
  }

  return [...exact, ...startsWith, ...nameIncludes, ...hostnameIncludes].slice(0, limit);
}

/** Look up by exact hostname (case-insensitive). Returns undefined if not in catalog. */
export function findByHostname(hostname: string): Instance | undefined {
  const h = hostname.trim().toLowerCase();
  return all.find(i => i.hostname === h);
}
