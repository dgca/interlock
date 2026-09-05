import { fileURLToPath } from 'node:url';

export type ConnectionConfig = {
  command: string;
  args: string[];
  env?: Record<string, string>;
  engineUrl: string;
  development: boolean;
  fallback?: { command: string; args: string[] };
};

export function developmentConnection(): ConnectionConfig {
  return {
    command: process.execPath,
    args: [
      '--import',
      fileURLToPath(
        new URL('../../../node_modules/tsx/dist/loader.mjs', import.meta.url),
      ),
      fileURLToPath(new URL('../../mcp/src/index.ts', import.meta.url)),
    ],
    engineUrl: 'http://127.0.0.1:4310',
    development: true,
  };
}
