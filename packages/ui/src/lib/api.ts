import { createClient } from '@interlock/client';
import { apiToken } from './apiToken';
export const api = createClient(window.location.origin, { token: apiToken });
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
export function download(name: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob),
    link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
