type Cb = (() => void)[];
const now = () => new Date().toISOString();
const terminal = (s: string) =>
  ['completed', 'failed', 'cancelled'].includes(s);
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export { type Cb, now, terminal, message };
