import { InterlockError, type Json, type WorkflowNode } from './index.js';
export type FetchNode = Extract<WorkflowNode, { kind: 'fetch' }>;
export type FetchBinding = FetchNode['query'][number]['value'];
export type FetchField = FetchNode['query'][number];
export interface FetchRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Json;
}
const fieldPath = /^(?:[A-Za-z_$][\w$]*|\d+)(?:\.(?:[A-Za-z_$][\w$]*|\d+))*$/;
function pathParts(path: string): string[] {
  if (!fieldPath.test(path))
    throw new InterlockError(
      `Invalid input field path "${path}". Use dot-separated field names or array indexes.`,
    );
  return path.split('.');
}
function inputField(input: Json, path: string): Json {
  let value = input;
  for (const key of pathParts(path)) {
    if (
      value === null ||
      typeof value !== 'object' ||
      !Object.hasOwn(value, key)
    )
      throw new InterlockError(`Input is missing "${path}"`);
    value = (value as Record<string, Json>)[key];
  }
  return value;
}
function resolve(binding: FetchBinding, input: Json): Json {
  return binding.kind === 'fixed'
    ? binding.value
    : inputField(input, binding.path);
}
function scalar(value: Json, label: string): string {
  if (value !== null && typeof value === 'object')
    throw new InterlockError(`${label} requires a scalar value`);
  return String(value);
}
function interpolate(template: string, read: (path: string) => Json): string {
  const result = template.replace(
    /\{\{\s*input\.([^{}]+?)\s*\}\}/g,
    (_, path: string) =>
      encodeURIComponent(scalar(read(path.trim()), 'URL binding')),
  );
  if (/[{}]/.test(result))
    throw new InterlockError(
      'URL bindings must use {{input.field}} without expressions',
    );
  const url = new URL(result);
  if (!['http:', 'https:'].includes(url.protocol))
    throw new InterlockError('Fetch requires an http or https URL');
  if (url.username || url.password)
    throw new InterlockError(
      'Use a request header for credentials instead of embedding them in the URL',
    );
  return url.href;
}
export function validateFetch(node: FetchNode): void {
  // Keep the origin fixed; interpolation is for path and query values.
  const origin = node.url.match(/^https?:\/\/[^/?#]+/i)?.[0];
  if (!origin || /[{}]/.test(origin))
    throw new InterlockError(
      'Enter an absolute http or https URL with a fixed host',
    );
  interpolate(node.url, (path) => {
    pathParts(path);
    return 'value';
  });
  for (const [label, fields] of [
    ['Query parameter', node.query],
    ['Header', node.headers],
    ['Body field', node.body.kind === 'fields' ? node.body.fields : []],
  ] as const) {
    const names = new Set<string>();
    for (const field of fields) {
      if (!field.name.trim()) throw new InterlockError(`${label} needs a name`);
      const name = label === 'Header' ? field.name.toLowerCase() : field.name;
      if (names.has(name))
        throw new InterlockError(
          `Duplicate ${label.toLowerCase()} "${field.name}"`,
        );
      names.add(name);
      if (field.value.kind === 'input') pathParts(field.value.path);
      else if (label !== 'Body field') scalar(field.value.value, label);
      if (label === 'Header')
        new Headers({
          [field.name]:
            field.value.kind === 'fixed' ? String(field.value.value) : 'value',
        });
    }
  }
  if (['GET', 'HEAD'].includes(node.method) && node.body.kind !== 'none')
    throw new InterlockError(`${node.method} requests cannot have a body`);
}
/** Pure request resolution shared by execution and the sample-input preview. */
export function resolveFetch(node: FetchNode, input: Json): FetchRequest {
  validateFetch(node);
  const url = new URL(interpolate(node.url, (path) => inputField(input, path)));
  for (const field of node.query)
    url.searchParams.append(
      field.name,
      scalar(resolve(field.value, input), `Query parameter ${field.name}`),
    );
  const headers = new Headers();
  for (const field of node.headers)
    headers.set(
      field.name,
      scalar(resolve(field.value, input), `Header ${field.name}`),
    );
  const body =
    node.body.kind === 'none'
      ? undefined
      : node.body.kind === 'input'
        ? input
        : node.body.kind === 'fixed'
          ? node.body.value
          : Object.fromEntries(
              node.body.fields.map((field) => [
                field.name,
                resolve(field.value, input),
              ]),
            );
  if (body !== undefined && !headers.has('content-type'))
    headers.set('content-type', 'application/json');
  return {
    url: url.href,
    method: node.method,
    headers: Object.fromEntries(headers),
    ...(body === undefined ? {} : { body }),
  };
}
