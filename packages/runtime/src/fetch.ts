import { jsonSchema, type Json, type FetchRequest } from '@interlock/core';

/** The client stopped observing a dispatched request before its full response. */
export class UncertainFetch extends Error {}

/** One request per explicit attempt. Timeout includes reading the response body. */
export async function executeFetch(
  request: FetchRequest,
  timeoutMs: number,
  signal: AbortSignal,
  { allowRedirects }: { allowRedirects: boolean },
) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`Fetch exceeded ${timeoutMs}ms`)),
    timeoutMs,
  );
  const abort = () => controller.abort(new Error('Fetch cancelled'));
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  let dispatched = false,
    responseComplete = false;
  try {
    const options: RequestInit = {
      method: request.method,
      headers: request.headers,
      body:
        request.body === undefined ? undefined : JSON.stringify(request.body),
      redirect: allowRedirects ? 'follow' : 'manual',
      signal: controller.signal,
    };
    controller.signal.throwIfAborted();
    dispatched = true;
    const response = await fetch(request.url, options);
    if (
      !allowRedirects &&
      [301, 302, 303, 307, 308].includes(response.status) &&
      response.headers.has('location')
    ) {
      await response.body?.cancel();
      throw new Error(
        'Fetch with a Secret header cannot follow a redirect. Use the final URL.',
      );
    }
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
    responseComplete = true;
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
    const failure = controller.signal.aborted
      ? controller.signal.reason
      : error;
    if (dispatched && !responseComplete)
      throw new UncertainFetch(
        failure instanceof Error ? failure.message : String(failure),
      );
    throw failure;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}
