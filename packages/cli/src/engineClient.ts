import { createClient } from '@interlock/client';
import { readApiToken } from '@interlock/core/apiToken';

/** The CLI reads the API token from disk, like the stdio bridge. */
export const engineClient = () =>
  createClient(process.env.INTERLOCK_URL, { token: readApiToken() });
