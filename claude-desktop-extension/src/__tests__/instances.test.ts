import { describe, expect, test } from 'bun:test';
import {
  allInstances,
  searchInstances,
  findByHostname,
  featuredInstances,
} from '../instances';

const FAKE_HOST = 'fake-mychart.fanpierlabs.com';

describe('instances catalog', () => {
  test('includes the real MyChart directory', () => {
    // The bundled directory has well over a thousand entries; the exact count
    // changes when the directory is refreshed, so just assert a sane floor.
    expect(allInstances().length).toBeGreaterThan(1000);
  });

  test('includes the fake-mychart test entry, labeled "(test)"', () => {
    const fake = allInstances().find((i) => i.hostname === FAKE_HOST);
    expect(fake).toBeDefined();
    expect(fake!.name.toLowerCase()).toContain('(test)');
    expect(fake!.url).toContain(FAKE_HOST);
  });

  test('featuredInstances() surfaces the fake-mychart test entry', () => {
    const featured = featuredInstances();
    expect(featured.length).toBeGreaterThan(0);
    expect(featured.some((i) => i.hostname === FAKE_HOST)).toBe(true);
  });
});

describe('searchInstances', () => {
  test('finds the test entry by name fragment', () => {
    const byCity = searchInstances('springfield');
    expect(byCity.some((i) => i.hostname === FAKE_HOST)).toBe(true);

    const byTest = searchInstances('test');
    expect(byTest.some((i) => i.hostname === FAKE_HOST)).toBe(true);
  });

  test('finds the test entry by hostname fragment', () => {
    const byHost = searchInstances('fake-mychart');
    expect(byHost.some((i) => i.hostname === FAKE_HOST)).toBe(true);
  });

  test('returns [] for an empty query', () => {
    expect(searchInstances('')).toEqual([]);
  });

  test('still resolves real health systems', () => {
    // Sanity: a real entry from the directory is still searchable.
    const matches = searchInstances('mychart');
    expect(matches.length).toBeGreaterThan(0);
  });
});

describe('findByHostname', () => {
  test('resolves the fake-mychart test entry (case-insensitive)', () => {
    expect(findByHostname(FAKE_HOST)?.hostname).toBe(FAKE_HOST);
    expect(findByHostname(FAKE_HOST.toUpperCase())?.hostname).toBe(FAKE_HOST);
  });

  test('returns undefined for unknown hostnames', () => {
    expect(findByHostname('not-a-real-host.example')).toBeUndefined();
  });
});
