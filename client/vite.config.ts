import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: {
      // Document endpoints served by FastAPI (port 8000) — must be before /api
      '/api/documents': 'http://localhost:8000',
      // All other /api calls go to Express (port 5000)
      '/api': 'http://localhost:5000',
    },
  },
});
