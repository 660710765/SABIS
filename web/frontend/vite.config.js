import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
// The API is the Go backend (../backend, :8080). /api is proxied to it so the
// session cookie stays same-origin. Override the target with API_URL in .env.
export default defineConfig(({ mode }) => {
  const api = loadEnv(mode, process.cwd(), '').API_URL || 'http://localhost:8080';
  return {
    plugins: [react()],
    server: { proxy: { '/api': api } },
    preview: { proxy: { '/api': api } }
  };
});
