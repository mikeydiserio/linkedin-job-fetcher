import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const src = fileURLToPath(new URL('./src', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': src,
      '@components': `${src}/components`,
      '@hooks': `${src}/hooks`,
      '@lib': `${src}/lib`,
      '@styles': `${src}/styles`,
    },
  },
  server: {
    port: 5173,
    // `vercel dev` serves the /api functions on 3000; proxying keeps the client
    // calling same-origin /api paths in both dev and production.
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
