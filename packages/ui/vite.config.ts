import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
export default defineConfig({
  plugins: [
    {
      name: 'interlock-font-license',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'assets/ibm-plex-OFL.txt',
          source: readFileSync(
            new URL(
              './src/design-system/assets/fonts/OFL.txt',
              import.meta.url,
            ),
            'utf8',
          ),
        });
      },
    },
  ],
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
          core: ['@interlock/core'],
        },
      },
    },
  },
});
