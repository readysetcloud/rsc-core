import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    // Vitest blanks CSS imports by default; keep the package's own stylesheets
    // so styles.test.tsx can check the real cascade.
    css: { include: [/\/styles\/[^/]+\.css/] }
  }
});
