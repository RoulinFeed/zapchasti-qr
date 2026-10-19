import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Учёт запчастей',
        short_name: 'Запчасти',
        description: 'Учёт запчастей по QR-кодам',
        lang: 'ru',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#1f6f43',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ['**/*.{js,css,html,svg,png,wasm}'],
        // Однажды просмотренные фото запчастей доступны и без связи.
        runtimeCaching: [
          {
            urlPattern: /\/api\/photos\//,
            handler: 'CacheFirst',
            options: { cacheName: 'photos', expiration: { maxEntries: 3000 } },
          },
        ],
      },
    }),
  ],
  server: {
    fs: { allow: ['..'] },
    proxy: { '/api': 'http://localhost:3000' },
  },
});
