import { claudeAdapter } from './claude.js';
import { codexAdapter } from './codex.js';
import { customAdapter } from './custom.js';
import { piAdapter } from './pi.js';
export const nativeAdapters = [
  claudeAdapter,
  codexAdapter,
  piAdapter,
  customAdapter,
];
