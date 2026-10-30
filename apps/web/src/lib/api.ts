export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: any) {
    super(message);
  }
}

type Body = Record<string, unknown> | unknown[] | FormData | undefined;

/** Thin fetch wrapper: JSON in/out, CSRF header, typed errors. Never trust this for authorization. */
export async function api<T = any>(method: string, path: string, body?: Body, init: RequestInit = {}): Promise<T> {
  const isForm = body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      credentials: 'same-origin',
      headers: { 'x-requested-with': 'invitely', ...(body !== undefined && !isForm ? { 'content-type': 'application/json' } : {}), ...(init.headers ?? {}) },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      signal: init.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'network_error', 'You appear to be offline. Check your connection and try again.');
  }
  if (res.status === 204) return undefined as T;
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) {
    if (!res.ok) throw new ApiError(res.status, 'http_error', `Request failed (${res.status})`);
    return (await res.blob()) as T;
  }
  const json = await res.json();
  if (!res.ok) {
    const err = json?.error ?? {};
    throw new ApiError(res.status, err.code ?? 'error', err.message ?? 'Request failed', err.details);
  }
  return json as T;
}

export const get = <T = any>(path: string, signal?: AbortSignal) => api<T>('GET', path, undefined, { signal });
export const post = <T = any>(path: string, body: Body = {}) => api<T>('POST', path, body);
export const patch = <T = any>(path: string, body: Body) => api<T>('PATCH', path, body);
export const put = <T = any>(path: string, body: Body) => api<T>('PUT', path, body);
export const del = <T = any>(path: string, body?: Body) => api<T>('DELETE', path, body);

/** Trigger a browser download for an authenticated GET endpoint. */
export async function download(path: string, filename: string) {
  const res = await fetch(`/api/v1${path}`, { credentials: 'same-origin', headers: { 'x-requested-with': 'invitely' } });
  if (!res.ok) {
    const j = await res.json().catch(() => null);
    throw new ApiError(res.status, j?.error?.code ?? 'error', j?.error?.message ?? 'Download failed');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const qs = (params: Record<string, string | number | boolean | undefined | null>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : '';
};
