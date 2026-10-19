import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // a porta da API vem do .env da raiz do projeto
  const env = loadEnv(mode, path.resolve(__dirname, '../..'), '');
  const api = process.env.API_URL || `http://127.0.0.1:${env.API_PORT || 3001}`;
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': { target: api, changeOrigin: true },
        '/files': { target: api, changeOrigin: true },
      },
    },
    worker: { format: 'es' as const },
    build: { target: 'es2022', sourcemap: false },
  };
});
