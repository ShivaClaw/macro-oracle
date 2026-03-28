import { sha256Hex } from './hash'

export function mulberry32(seed: number): () => number {
  return function () {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function seedFromString(s: string): number {
  // Take first 8 hex chars as uint32 seed
  const hex = sha256Hex(s).slice(0, 8)
  return Number.parseInt(hex, 16) >>> 0
}
