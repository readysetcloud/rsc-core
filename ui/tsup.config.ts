import { defineConfig } from 'tsup';

export default defineConfig([
  // npm package build (React apps import from node_modules)
  {
    entry: {
      index: 'src/index.ts',
      'auth/index': 'src/auth/index.ts'
    },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: true,
    external: ['react', 'react-dom', 'react/jsx-runtime'],
    target: 'es2022'
  },
  // browser bundles (script-tag consumers via the assets bucket —
  // same model as Amplify's hosted UI assets)
  {
    entry: { auth: 'src/auth/browser.ts' },
    outDir: 'dist/browser',
    format: ['esm', 'iife'],
    globalName: 'rscAuth',
    minify: true,
    sourcemap: true,
    target: 'es2020',
    platform: 'browser'
  }
]);
