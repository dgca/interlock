const storageKey = 'interlock-api-token';

/**
 * The engine adds its API token to the page it serves: always while the token
 * is optional, and for the startup link once it is required. Keep it for later
 * page loads at this origin, and drop the link's token from the address bar.
 */
function pageApiToken(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const fromPage = document
    .querySelector<HTMLMetaElement>('meta[name="interlock-api-token"]')
    ?.getAttribute('content');
  const url = new URL(window.location.href);
  if (url.searchParams.has('token')) {
    url.searchParams.delete('token');
    window.history.replaceState(window.history.state, '', url);
  }
  try {
    if (fromPage) localStorage.setItem(storageKey, fromPage);
    return fromPage || localStorage.getItem(storageKey) || undefined;
  } catch {
    // Storage restrictions leave the token for this page load only.
    return fromPage || undefined;
  }
}

export const apiToken = pageApiToken();
