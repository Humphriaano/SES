import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const CHARCOAL = '#252B2D';
const CREAM = '#FBFAF7';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest', // custom sw.ts: push notifications + deep links
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt', // we show our own "new version ready" toast
      injectRegister: null,   // registered manually in src/pwa.ts for full control
      devOptions: { enabled: true, type: 'module' },
      injectManifest: {
        // Google Fonts + portal API caching is registered inside sw.ts itself.
        globPatterns: ['**/*.{js,css,html,png,svg,ico}'],
      },
      manifest: {
        name: 'SES Health',
        short_name: 'SES Health',
        description: 'Your chronic-care dashboard — vitals, appointments, and monthly check-ins from SES Health.',
        theme_color: CHARCOAL,
        background_color: CREAM,
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 5175,
    allowedHosts: true,
    fs: { allow: ['..'] }, // theme/ses-tokens.css lives one level up, shared with client
    proxy: {
      '/api': { target: 'http://localhost:5000', changeOrigin: true },
    },
  },
});
