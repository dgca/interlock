import { jsonSchema, type Json, type FetchRequest } from '@interlock/core';

/** One request per explicit attempt. Timeout includes reading the response body. */
export async function executeFetch(
  request: FetchRequest,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<Json> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`Fetch exceeded ${timeoutMs}ms`)),
    timeoutMs,
  );
  const abort = () => controller.abort(new Error('Fetch cancelled'));
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body:
        request.body === undefined ? undefined : JSON.stringify(request.body),
      signal: controller.signal,
    });
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 5 * 1024 * 1024) {
            await reader.cancel();
            throw new Error('Fetch response exceeds 5 MiB');
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
    }
    const text = Buffer.concat(chunks).toString('utf8');
    const contentType =
      response.headers
        .get('content-type')
        ?.split(';')[0]
        .trim()
        .toLowerCase() ?? '';
    let body: Json = text || null;
    if (
      text &&
      (contentType === 'application/json' || contentType.endsWith('+json'))
    ) {
      try {
        body = jsonSchema.parse(JSON.parse(text));
      } catch {
        throw new Error(
          'Fetch response declares JSON but contains invalid JSON',
        );
      }
    }
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body,
    };
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}
