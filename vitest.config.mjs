import { defineConfig } from 'vitest/config';

// Root config runs the Lambda function tests under functions/. The workspace
// packages (agent/, links/) have their own vitest configs and are excluded here.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['functions/**/*.test.mjs'],
  },
});
