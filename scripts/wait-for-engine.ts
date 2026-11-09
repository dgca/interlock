import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const healthUrl = 'http://127.0.0.1:4310/health';

export async function waitForEngine(url = healthUrl, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(
          Math.max(1, Math.min(1000, deadline - Date.now())),
        ),
      });
      if (response.ok && (await response.json())?.ok === true) return;
    } catch {
      // Connection refusals and incomplete responses are expected during startup.
    }
    const remaining = deadline - Date.now();
    if (remaining > 0) await delay(Math.min(100, remaining));
  }
  throw new Error(
    `Timed out waiting for Interlock at ${url} after ${timeoutMs / 1000} seconds. Check the server output above.`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  console.log(`Waiting for Interlock at ${healthUrl}…`);
  waitForEngine().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
