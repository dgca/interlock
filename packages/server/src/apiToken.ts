import { timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import type { ConnectionConfig } from './connection.js';

/** Parses INTERLOCK_REQUIRE_TOKEN. Unset or empty keeps the 0.2 default: not required. */
export function parseRequireToken(value = process.env.INTERLOCK_REQUIRE_TOKEN) {
  const normalized = value?.trim().toLowerCase() ?? '';
  if (['', '0', 'false', 'no', 'off'].includes(normalized)) return false;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  throw new Error(
    `INTERLOCK_REQUIRE_TOKEN must be 1 or 0 (true or false); received ${JSON.stringify(value)}.`,
  );
}

const matches = (candidate: string | undefined, token: string) => {
  if (!candidate) return false;
  const a = Buffer.from(candidate),
    b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * Whether a request presents the API token. Clients send `Authorization: Bearer`;
 * the browser event stream and the UI page link may pass `?token=` instead.
 */
function presentsApiToken(
  request: Request,
  token: string,
  { query = false } = {},
) {
  const bearer = /^Bearer\s+(\S+)\s*$/i.exec(
    request.headers.get('authorization') ?? '',
  )?.[1];
  if (matches(bearer, token)) return true;
  return (
    query &&
    matches(new URL(request.url).searchParams.get('token') ?? '', token)
  );
}

/** Rejects requests without the token when the connection requires one. */
export function requireApiToken(
  connection: ConnectionConfig | undefined,
  options: { query?: boolean } = {},
): MiddlewareHandler {
  return async (c, next) => {
    if (
      connection?.requireToken &&
      !(
        connection.token &&
        presentsApiToken(c.req.raw, connection.token, options)
      )
    ) {
      c.header('WWW-Authenticate', 'Bearer realm="interlock"');
      return c.json(
        {
          error:
            'Interlock API token required. Send Authorization: Bearer <token>. The interlock command reads the token automatically; copy HTTP client configuration from Connect with MCP, or open the UI link printed at startup.',
        },
        401,
      );
    }
    await next();
  };
}

/**
 * Adds the token to the UI page. A required token is added only for a page
 * request that already carries it, such as the link printed at startup.
 */
export function pageWithApiToken(
  html: string,
  request: Request,
  connection: ConnectionConfig | undefined,
) {
  const token = connection?.token;
  if (
    !token ||
    (connection.requireToken &&
      !presentsApiToken(request, token, { query: true }))
  )
    return html;
  return html.replace(
    '</head>',
    `<meta name="interlock-api-token" content="${token}" /></head>`,
  );
}
