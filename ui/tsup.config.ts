import { defineConfig } from 'tsup';

export default defineConfig([
  // npm package build (React apps import from node_modules)
  {
    entry: {
      index: 'src/index.ts',
      'auth/index': 'src/auth/index.ts',
      'chat/index': 'src/chat/index.ts'
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
  },
  // framework-agnostic AppNav for plain <script> consumers (window.rscNav) —
  // no React, so the static course pages can mount the shared nav
  {
    entry: { nav: 'src/components/nav-browser.ts' },
    outDir: 'dist/browser',
    format: ['esm', 'iife'],
    globalName: 'rscNav',
    minify: true,
    sourcemap: true,
    target: 'es2020',
    platform: 'browser'
  }
]);
