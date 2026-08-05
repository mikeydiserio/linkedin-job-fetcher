import { defineConfig } from 'vite';

const API_PORT = process.env.API_PORT || 3400;

export default defineConfig({
  root: 'web',
  build: {
    // Served by Express in production, so keep it outside web/.
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    // In dev the UI runs on Vite (HMR) and the API on Express; proxying keeps
    // the frontend calling same-origin /api paths in both modes.
    proxy: {
      '/api': {
        target: `http://localhost:${API_PORT}`,
        changeOrigin: true,
      },
    },
  },
});
