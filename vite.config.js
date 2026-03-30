import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
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
