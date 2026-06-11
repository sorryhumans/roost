import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev-only same-origin shim: EventSource('/events') in the browser hits the Vite dev
// server, which proxies SSE through to the Plan 01 Fastify server on 127.0.0.1:7600.
// In production the Fastify server static-serves web/dist, so /events is already
// same-origin and no proxy is involved. (SSE streams through Vite's proxy by default.)
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/events': { target: 'http://127.0.0.1:7600', changeOrigin: true },
      '/healthz': { target: 'http://127.0.0.1:7600', changeOrigin: true },
    },
  },
});
