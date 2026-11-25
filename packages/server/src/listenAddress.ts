import { isIP } from 'node:net';

export const defaultHost = '127.0.0.1';

export function isListenHost(host: string) {
  return host === 'localhost' || (!host.includes('%') && isIP(host) !== 0);
}

export function urlHostname(host: string) {
  return new URL(`http://${isIP(host) === 6 ? `[${host}]` : host}`).hostname;
}

/** Takes the form `urlHostname` returns. Covers the IPv4-mapped spelling, which also binds every interface. */
export function isWildcardHost(host: string) {
  return host === '0.0.0.0' || host === '[::]' || host === '[::ffff:0:0]';
}

/** Match the spelling the HTTP adapter expects when it checks the URL authority. */
export function canonicalHostHeader(header: string) {
  const match = /^\[([a-f\d:.]+)\](:\d+)?$/i.exec(header);
  if (match && isIP(match[1]) === 6)
    return `${urlHostname(match[1])}${match[2] ?? ''}`;
  return header.toLowerCase();
}

export function internalEngineUrl(host: string, port: number) {
  const hostname = urlHostname(host);
  const address = !isWildcardHost(hostname)
    ? hostname
    : hostname === '[::]'
      ? '[::1]'
      : defaultHost;
  return `http://${address}:${port}`;
}
