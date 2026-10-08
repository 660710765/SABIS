import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
// Dev: `npm run server` (API on :3000) + `npm run dev` (React on :5173, /api proxied).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': 'http://localhost:3000' }
  },
  preview: {
    proxy: { '/api': 'http://localhost:3000' }
  }
});
