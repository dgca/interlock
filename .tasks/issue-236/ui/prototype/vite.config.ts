import { defineConfig } from '../../../../packages/ui/node_modules/vite';
import { resolve } from 'node:path';
const repo = resolve(import.meta.dirname, '../../../..');
export default defineConfig({
  root: import.meta.dirname,
  cacheDir: '/tmp/interlock-ui-236-vite-cache',
  resolve: {
    alias: {
      react: resolve(repo, 'node_modules/react'),
      'react-dom': resolve(repo, 'node_modules/react-dom'),
      '@mantine/core': resolve(repo, 'packages/ui/node_modules/@mantine/core'),
      '@mantine/hooks': resolve(
        repo,
        'packages/ui/node_modules/@mantine/hooks',
      ),
      'lucide-react': resolve(repo, 'packages/ui/node_modules/lucide-react'),
      'react-router': resolve(repo, 'node_modules/react-router'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5196,
    strictPort: true,
    fs: { allow: [repo] },
  },
});
