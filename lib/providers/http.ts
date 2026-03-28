import { nowIso } from '@/lib/utils/time'

export async function fetchJsonWithTimeout<T>(
  url: string,
  opts: { timeoutMs: number; headers?: Record<string, string> }
): Promise<{ ok: true; data: T; fetchedAt: string } | { ok: false; error: { code: 'TIMEOUT' | 'HTTP_ERROR' | 'PARSE_ERROR'; message: string; httpStatus?: number } }>
{
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), opts.timeoutMs)

  try {
    const res = await fetch(url, {
      headers: opts.headers,
      signal: controller.signal,
      cache: 'no-store'
    })

    if (!res.ok) {
      return {
        ok: false,
        error: { code: 'HTTP_ERROR', message: `HTTP ${res.status}`, httpStatus: res.status }
      }
    }

    try {
      const data = (await res.json()) as T
      return { ok: true, data, fetchedAt: nowIso() }
    } catch (e: any) {
      return {
        ok: false,
        error: { code: 'PARSE_ERROR', message: e?.message ?? 'Failed to parse JSON' }
      }
    }
  } catch (e: any) {
    const msg = e?.name === 'AbortError' ? 'Timeout' : e?.message ?? 'Fetch failed'
    return { ok: false, error: { code: e?.name === 'AbortError' ? 'TIMEOUT' : 'HTTP_ERROR', message: msg } }
  } finally {
    clearTimeout(t)
  }
}

export function redactUrlSecrets(url: string): string {
  // best-effort: remove apikey/api_key query params from logs/response
  try {
    const u = new URL(url)
    for (const k of ['apikey', 'api_key', 'token', 'key']) {
      if (u.searchParams.has(k)) u.searchParams.set(k, 'REDACTED')
    }
    return u.toString()
  } catch {
    return url
  }
}
