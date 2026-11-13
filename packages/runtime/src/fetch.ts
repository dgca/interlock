import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import {
  InterlockError,
  jsonSchema,
  type DiagnosticCheck,
  type FetchNode,
  type Json,
  type FetchRequest,
  type PrivateNetworkTarget,
  type Workflow,
} from '@interlock/core';
import type { Store } from '@interlock/storage';

const ranges: [
  PrivateNetworkTarget['range'],
  string,
  number,
  'ipv4' | 'ipv6',
][] = [
  ['loopback', '127.0.0.0', 8, 'ipv4'],
  ['loopback', '0.0.0.0', 8, 'ipv4'],
  ['private', '10.0.0.0', 8, 'ipv4'],
  ['private', '172.16.0.0', 12, 'ipv4'],
  ['private', '192.168.0.0', 16, 'ipv4'],
  ['private', '100.64.0.0', 10, 'ipv4'],
  ['link-local', '169.254.0.0', 16, 'ipv4'],
  ['loopback', '::1', 128, 'ipv6'],
  ['loopback', '::', 128, 'ipv6'],
  ['private', 'fc00::', 7, 'ipv6'],
  ['link-local', 'fe80::', 10, 'ipv6'],
];
const blockLists = ranges.map(([range, network, prefix, type]) => {
  const list = new BlockList();
  list.addSubnet(network, prefix, type);
  return { range, list, type };
});

/** Classify one IP address literal, including IPv4-mapped IPv6 forms. */
function privateAddressRange(
  address: string,
): PrivateNetworkTarget['range'] | undefined {
  let value = address.replace(/^\[|\]$/g, '').toLowerCase();
  const mapped = /^::ffff:(?:([\d.]+)|([\da-f]{1,4}):([\da-f]{1,4}))$/.exec(
    value,
  );
  if (mapped)
    value =
      mapped[1] ??
      [
        parseInt(mapped[2], 16) >> 8,
        parseInt(mapped[2], 16) & 255,
        parseInt(mapped[3], 16) >> 8,
        parseInt(mapped[3], 16) & 255,
      ].join('.');
  const version = isIP(value);
  if (!version) return undefined;
  const type = version === 4 ? 'ipv4' : 'ipv6';
  return blockLists.find(
    (entry) => entry.type === type && entry.list.check(value, type),
  )?.range;
}

function urlHost(url: string) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/** Literal URL hosts only, for static inspection without name resolution. */
function literalPrivateNetworkTarget(
  url: string,
): PrivateNetworkTarget | undefined {
  const host = urlHost(url);
  if (!host) return undefined;
  if (host === 'localhost' || host.endsWith('.localhost'))
    return { host, address: host, range: 'loopback' };
  const range = privateAddressRange(host);
  return range
    ? { host, address: host.replace(/^\[|\]$/g, ''), range }
    : undefined;
}

/**
 * Report whether a Fetch URL reaches a loopback, private or link-local
 * address. Name resolution is best effort: failures and slow lookups report
 * nothing and leave the request to succeed or fail as before.
 */
export async function privateNetworkTarget(
  url: string,
  resolve: (host: string) => Promise<string[]> = async (host) =>
    (await lookup(host, { all: true, verbatim: true })).map(
      (entry) => entry.address,
    ),
): Promise<PrivateNetworkTarget | undefined> {
  const literal = literalPrivateNetworkTarget(url);
  const host = urlHost(url);
  if (literal || !host || isIP(host.replace(/^\[|\]$/g, ''))) return literal;
  let timer: NodeJS.Timeout | undefined;
  try {
    const addresses = await Promise.race([
      resolve(host),
      new Promise<string[]>((done) => {
        timer = setTimeout(() => done([]), 1000);
      }),
    ]);
    for (const address of addresses) {
      const range = privateAddressRange(address);
      if (range) return { host, address, range };
    }
  } catch {
    // Leave resolution failures to the request itself.
  } finally {
    clearTimeout(timer);
  }
  return undefined;
}

/** Doctor warning for published Fetch steps with literal private hosts. */
export function privateFetchCheck(
  workflow: Workflow,
  store: Pick<Store, 'getVersion'>,
): DiagnosticCheck | undefined {
  const definition =
    workflow.latestVersion && !workflow.archived
      ? store.getVersion(workflow.id, workflow.latestVersion)?.definition
      : undefined;
  const fetches = (definition?.nodes ?? []).flatMap((node) => {
    if (node.kind !== 'fetch' || node.blockPrivateNetwork) return [];
    const target = literalPrivateNetworkTarget(node.url);
    return target ? [{ nodeId: node.id, label: node.label, ...target }] : [];
  });
  if (!fetches.length) return undefined;
  return {
    category: 'workflows',
    name: `Private network Fetch in workflow: ${workflow.name}`,
    status: 'warn',
    message: `Published workflow "${workflow.name}" has ${fetches.length} Fetch step(s) calling loopback, private or link-local addresses: ${fetches.map((f) => `${f.label} (${f.address})`).join(', ')}`,
    details: {
      workflowId: workflow.id,
      version: workflow.latestVersion,
      fetches,
    },
    remediation:
      'Confirm these addresses are intended. Set blockPrivateNetwork: true on a Fetch step to refuse them.',
  };
}

/** Report a Fetch step's private target, and refuse it when the step opts in. */
export async function checkPrivateNetwork(
  node: FetchNode,
  url: string,
  record: (target: PrivateNetworkTarget, message: string) => void,
) {
  const target = await privateNetworkTarget(url);
  if (!target) return;
  const { range, address, host } = target;
  const blocked = !!node.blockPrivateNetwork;
  record(
    target,
    `${node.label}: ${blocked ? 'blocked a request to' : 'requested'} ${range} address ${address} (${host})`,
  );
  if (blocked)
    throw new InterlockError(
      `${node.label}: Fetch blocks ${range} address ${address} (${host}). Use a public address or turn off blockPrivateNetwork for this step.`,
    );
}

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
