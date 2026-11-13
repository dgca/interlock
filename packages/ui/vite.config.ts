import { readFileSync } from 'node:fs';
import { defineConfig, type ProxyOptions } from 'vite';
import { readApiToken } from '@interlock/core/apiToken';

// The development page is not served by the engine, so the proxy adds its token.
const engine: ProxyOptions = {
  target: 'http://127.0.0.1:4310',
  configure: (proxy) =>
    proxy.on('proxyReq', (request) => {
      const token = readApiToken();
      if (token) request.setHeader('Authorization', `Bearer ${token}`);
    }),
};
// The component gallery exists only in the dev server and in the separate
// `gallery` mode build used by browser tests. Production builds drop it.
export default defineConfig(({ command, mode }) => ({
  define: {
    'import.meta.env.INTERLOCK_GALLERY': JSON.stringify(
      command === 'serve' || mode === 'gallery',
    ),
  },
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
      '/trpc': engine,
      '/events': engine,
      '/health': engine,
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
}));
