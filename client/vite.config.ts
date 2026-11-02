import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { devServices } from './dev-services';

export default defineConfig({
  plugins: [react(), tailwindcss(), devServices()],
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
    fs: { allow: ['..'] }, // theme/ses-tokens.css lives one level up, shared with patient-portal
    proxy: {
      // Document endpoints served by FastAPI (port 8000) — must be before /api
      '/api/documents': 'http://localhost:8000',
      // All other /api calls go to Express (port 5000)
      '/api': 'http://localhost:5000',
    },
  },
});
