import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API = process.env.API_URL || 'http://127.0.0.1:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API, changeOrigin: true },
      '/files': { target: API, changeOrigin: true },
    },
  },
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: false },
});
