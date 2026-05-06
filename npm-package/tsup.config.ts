import { defineConfig } from 'tsup';
import path from 'path';
import fs from 'fs';

const repoRoot = path.resolve(__dirname, '..');

// Resolve a shim file path to a string esbuild's `alias` accepts.
function shim(name: string): string {
  return path.resolve(__dirname, 'src', 'shims', name);
}

/**
 * Custom esbuild plugin that rewrites a handful of relative imports inside
 * `scrapers/myChart/**` so the published library never reaches into shared/
 * (which contains telemetry, chdir helpers, etc. that are inappropriate for
 * a third-party-developer-facing library) and never bundles the playwright-
 * dependent imaging downloader.
 */
const rewriteSharedImports = {
  name: 'rewrite-shared-imports',
  setup(build: { onResolve: (filter: { filter: RegExp }, cb: (args: { path: string; importer: string }) => { path: string } | null) => void }) {
    build.onResolve({ filter: /shared\/(util|telemetry|blockedInstances|env)$/ }, (args) => {
      // Only rewrite when imported from the bundled scraper sources.
      if (!args.importer.startsWith(repoRoot)) return null;
      if (args.path.endsWith('/shared/util'))             return { path: shim('util.ts') };
      if (args.path.endsWith('/shared/telemetry'))        return { path: shim('telemetry.ts') };
      if (args.path.endsWith('/shared/blockedInstances')) return { path: shim('blockedInstances.ts') };
      if (args.path.endsWith('/shared/env'))              return { path: shim('env.ts') };
      return null;
    });

    // Make sure the playwright-dependent file is never resolved even if the
    // bundler walks into it transitively.
    build.onResolve({ filter: /imagingDownloader$/ }, (args) => {
      if (!args.importer.startsWith(repoRoot)) return null;
      // Resolve to an empty stub.
      const stubPath = path.resolve(__dirname, 'src', 'shims', 'empty.ts');
      if (!fs.existsSync(stubPath)) {
        fs.writeFileSync(stubPath, 'export {};\n');
      }
      return { path: stubPath };
    });
  },
};

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  outExtension: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.js' }),
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  target: 'node18',
  // Keep heavy runtime deps external — consumers install them once.
  external: [
    'cheerio',
    'tough-cookie',
    'date-fns',
    'mkdirp',
    'totp-generator',
    'fzstd',
    'sharp',
    'uuid',
    'fetch-cookie',
    'playwright',
  ],
  // Bundle the scraper sources into our package so consumers don't depend
  // on the workspace layout.
  noExternal: [/scrapers[\\/]myChart/],
  esbuildPlugins: [rewriteSharedImports],
});
