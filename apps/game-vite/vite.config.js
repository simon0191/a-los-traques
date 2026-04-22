import { defineConfig } from 'vite';
import { overlayExportPlugin } from '../../scripts/overlay-export-server.js';

export default defineConfig({
  base: './',
  plugins: [overlayExportPlugin()],
  server: {
    open: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
