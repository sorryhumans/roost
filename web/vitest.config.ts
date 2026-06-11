import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Hermetic frontend tests: jsdom DOM, no real network, no real EventSource connection
// (stubbed in vitest.setup.ts). No server required.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
