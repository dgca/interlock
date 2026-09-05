import { defineConfig } from 'vite';
export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/trpc': 'http://127.0.0.1:4310',
      '/events': 'http://127.0.0.1:4310',
      '/health': 'http://127.0.0.1:4310',
    },
  },
  build: {
    rollupOptions: { output: { manualChunks: { flow: ['@xyflow/react'] } } },
  },
});
