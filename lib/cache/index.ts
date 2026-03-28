import fs from 'node:fs/promises'
import path from 'node:path'
import { sha256Hex } from '@/lib/utils/hash'

export type CacheEntry<T> = {
  value: T
  storedAtMs: number
  expiresAtMs: number
}

export type CacheGetResult<T> = {
  hit: boolean
  stale: boolean
  entry: CacheEntry<T> | null
}

type MemoryCache = Map<string, CacheEntry<unknown>>

function getMemoryCache(): MemoryCache {
  const g = globalThis as any
  if (!g.__macroOracleMemoryCache) g.__macroOracleMemoryCache = new Map()
  return g.__macroOracleMemoryCache as MemoryCache
}

const CACHE_DIR = path.join(process.cwd(), '.cache', 'oracle')

async function ensureDir(): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true })
}

function filePathForKey(key: string): string {
  const safe = sha256Hex(key)
  return path.join(CACHE_DIR, `${safe}.json`)
}

export function cacheStats() {
  const mem = getMemoryCache()
  return {
    memoryKeys: mem.size,
    cacheDir: CACHE_DIR
  }
}

export async function cacheGet<T>(
  key: string,
  opts: { allowStale: boolean }
): Promise<CacheGetResult<T>> {
  const now = Date.now()
  const mem = getMemoryCache()

  const memEntry = mem.get(key) as CacheEntry<T> | undefined
  if (memEntry) {
    const fresh = now <= memEntry.expiresAtMs
    if (fresh) return { hit: true, stale: false, entry: memEntry }
    if (opts.allowStale) return { hit: true, stale: true, entry: memEntry }
  }

  // filesystem fallback
  try {
    const fp = filePathForKey(key)
    const raw = await fs.readFile(fp, 'utf8')
    const parsed = JSON.parse(raw) as CacheEntry<T>
    if (!parsed || typeof parsed !== 'object') throw new Error('bad cache entry')

    const fresh = now <= parsed.expiresAtMs
    if (fresh || opts.allowStale) {
      mem.set(key, parsed as CacheEntry<unknown>)
      return { hit: true, stale: !fresh, entry: parsed }
    }
  } catch {
    // ignore
  }

  return { hit: false, stale: false, entry: null }
}

export async function cacheSet<T>(key: string, value: T, ttlSeconds: number): Promise<CacheEntry<T>> {
  const now = Date.now()
  const entry: CacheEntry<T> = {
    value,
    storedAtMs: now,
    expiresAtMs: now + Math.max(1, ttlSeconds) * 1000
  }

  const mem = getMemoryCache()
  mem.set(key, entry as CacheEntry<unknown>)

  try {
    await ensureDir()
    const fp = filePathForKey(key)
    await fs.writeFile(fp, JSON.stringify(entry), 'utf8')
  } catch {
    // best-effort only (serverless FS may be read-only)
  }

  return entry
}

export async function cacheDelete(key: string): Promise<void> {
  const mem = getMemoryCache()
  mem.delete(key)
  try {
    const fp = filePathForKey(key)
    await fs.unlink(fp)
  } catch {
    // ignore
  }
}

export function cacheKey(parts: Record<string, unknown>): string {
  // stable-ish key builder
  const base = JSON.stringify(parts)
  return `oracle:${sha256Hex(base)}`
}
