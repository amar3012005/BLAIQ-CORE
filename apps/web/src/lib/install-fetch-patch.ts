// Global fetch + EventSource patch for the multi-tenant prod deploy.
//
// Existing code uses relative `/api/...` and `/artifacts/...` URLs and
// the daemon serves them on the same origin in local dev. In hosted
// prod the daemon lives at api.<domain> while the web app lives at
// app.<domain> (Vercel), so we need to (a) rewrite the path to absolute
// and (b) add `credentials: 'include'` so the od_session cookie flows.
//
// A global patch keeps the change to a single import in the AuthProvider
// instead of mechanically rewriting hundreds of fetch callsites.
//
// Safe properties:
//   - Idempotent (`installed` guard).
//   - No-op when NEXT_PUBLIC_API_URL is empty (single-origin dev).
//   - Only rewrites known internal prefixes; external fetches untouched.

let installed = false;

const API_PREFIXES = ['/api/', '/artifacts/', '/frames/'];

export function installFetchPatch(): void {
  if (installed) return;
  if (typeof window === 'undefined') return;
  installed = true;
  const base = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/+$/, '');
  if (!base) return;

  const origFetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let url: string;
    if (typeof input === 'string') url = input;
    else if (input instanceof URL) url = input.toString();
    else url = input.url;
    if (API_PREFIXES.some((p) => url.startsWith(p))) {
      const absolute = base + url;
      const merged: RequestInit = {
        credentials: 'include',
        ...(init ?? {}),
      };
      if (typeof input === 'string' || input instanceof URL) {
        return origFetch(absolute, merged);
      }
      // Request object: clone to new URL.
      return origFetch(new Request(absolute, input), merged);
    }
    return origFetch(input, init);
  }) as typeof window.fetch;

  const OrigES = window.EventSource;
  if (typeof OrigES === 'function') {
    function PatchedES(this: EventSource, url: string | URL, init?: EventSourceInit) {
      let u = typeof url === 'string' ? url : url.toString();
      if (API_PREFIXES.some((p) => u.startsWith(p))) u = base + u;
      const merged: EventSourceInit = { withCredentials: true, ...(init ?? {}) };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return new (OrigES as any)(u, merged);
    }
    PatchedES.prototype = OrigES.prototype;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).EventSource = PatchedES;
  }
}
