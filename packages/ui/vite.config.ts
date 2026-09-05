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
    rollupOptions: {
      onwarn(warning, warn) {
        // Client directives have no effect in this browser-only build.
        if (
          warning.code === 'MODULE_LEVEL_DIRECTIVE' &&
          warning.message.includes('use client') &&
          warning.id?.includes('node_modules')
        )
          return;
        warn(warning);
      },
      output: {
        manualChunks: {
          flow: ['@xyflow/react'],
          mantine: ['@mantine/core', '@mantine/hooks'],
        },
      },
    },
  },
});
