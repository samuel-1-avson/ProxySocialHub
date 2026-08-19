import { getApiBase } from './config';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiRequest<T>(
  method: string,
  path: string,
  body?: unknown,
  options?: { token?: string | null; anonymous?: boolean },
): Promise<T> {
  const base = await getApiBase();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (!options?.anonymous) {
    const token =
      options?.token ??
      ((await chrome.storage.session.get('accessToken')).accessToken as string | undefined);
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = {};
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { error: text };
    }
  }
  if (!res.ok) {
    const msg =
      typeof parsed === 'object' && parsed && 'error' in parsed
        ? String((parsed as { error: unknown }).error)
        : `HTTP ${res.status}`;
    throw new ApiError(res.status, msg);
  }
  return parsed as T;
}
