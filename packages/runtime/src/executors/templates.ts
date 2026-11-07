import type { ExternalTask } from '@interlock/core';

export interface TemplateContext {
  externalTask?: Partial<ExternalTask>;
  node?: {
    id?: string;
    label?: string;
    kind?: string;
  };
  run?: {
    id?: string;
    status?: string;
    workflowId?: string;
    workflowName?: string;
  };
  work?: {
    id?: string;
    attempt?: number;
    nodeId?: string;
    label?: string;
  };
  runId?: string;
  workId?: string;
  nodeId?: string;
  sessionId?: string;
  cwd?: string;
  sessionName?: string;
  attempt?: number | string;
  [key: string]: unknown;
}

function resolveProperty(path: string, context: TemplateContext): string {
  const normalized = path.trim();
  // Handle shortcuts
  if (normalized === 'runId') {
    return String(context.runId ?? context.run?.id ?? '');
  }
  if (normalized === 'workId') {
    return String(context.workId ?? context.work?.id ?? '');
  }
  if (normalized === 'nodeId') {
    return String(
      context.nodeId ?? context.node?.id ?? context.work?.nodeId ?? '',
    );
  }
  if (normalized === 'sessionId') {
    return String(context.sessionId ?? '');
  }

  const parts = normalized.split('.');
  let current: unknown = context;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') {
      return '';
    }
    current = (current as Record<string, unknown>)[part];
  }

  if (current == null) return '';
  if (typeof current === 'object') return '';
  return String(current);
}

/**
 * Evaluates a mustache-style session name template against run data.
 * Sanitizes control characters, collapses whitespace, trims, and bounds length to 200 chars.
 */
export function evaluateSessionNameTemplate(
  template: string,
  context: TemplateContext,
): string {
  if (!template || typeof template !== 'string') return '';

  const evaluated = template.replace(
    /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g,
    (_, path) => resolveProperty(path, context),
  );

  return evaluated
    .replace(/[\r\n\t\x00-\x1f\x7f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/**
 * Evaluates template variables in command or link templates.
 * Replaces both {{var}} and $VAR/${VAR} tokens.
 */
export function evaluateCommandOrUrlTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  if (!template || typeof template !== 'string') return '';

  return template
    .replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key) => {
      return key in vars ? vars[key] : '';
    })
    .replace(/\$(?:([A-Z0-9_]+)|\{([A-Z0-9_]+)\})/g, (_, name1, name2) => {
      const key = name1 || name2;
      return key in vars ? vars[key] : `$${key}`;
    })
    .trim();
}

/**
 * Validates that deep links use http: or https: protocols without embedded credentials.
 */
export function sanitizeDeepLink(url?: string): string | undefined {
  if (!url || typeof url !== 'string') return undefined;
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    if (
      ['http:', 'https:'].includes(parsed.protocol) &&
      !parsed.username &&
      !parsed.password
    ) {
      return trimmed;
    }
  } catch {}
  return undefined;
}

/**
 * Strips or redacts authorization tokens, tickets, and credentials from progress messages.
 * Bounds message to 1000 characters.
 */
export function sanitizeMessage(message: string): string {
  if (!message || typeof message !== 'string') return '';

  return message
    .replace(/(Bearer\s+)[a-zA-Z0-9_.\-]+/gi, '$1[REDACTED]')
    .replace(
      /((?:claim_?)?(?:token|ticket|auth|secret|password|api_?key)[=:\s]+["']?)[a-zA-Z0-9_\-.]{8,}(["']?)/gi,
      '$1[REDACTED]$2',
    )
    .replace(
      /INTERLOCK_(?:CLAIM_TOKEN|CLAIM_TICKET)=[^\s]+/g,
      'INTERLOCK_TOKEN=[REDACTED]',
    )
    .slice(0, 1000);
}
