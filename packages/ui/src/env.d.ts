/// <reference types="vite/client" />

interface Window {
  __INTERLOCK_CONFIG__?: unknown;
}

interface ImportMetaEnv {
  /** True only in the Vite dev server and the `gallery` mode build. */
  readonly INTERLOCK_GALLERY?: boolean;
}
