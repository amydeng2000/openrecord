import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  outExtension: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.js' }),
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  target: 'node18',
  // Bundle the scraper sources into our package so consumers don't depend
  // on the workspace layout.
  noExternal: [/scrapers[\\/]myChart/],
});
