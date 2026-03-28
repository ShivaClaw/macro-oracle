export class RetryableError extends Error {
  readonly code: string
  constructor(message: string, code = 'RETRYABLE') {
    super(message)
    this.name = 'RetryableError'
    this.code = code
  }
}

export class NonRetryableError extends Error {
  readonly code: string
  constructor(message: string, code = 'NON_RETRYABLE') {
    super(message)
    this.name = 'NonRetryableError'
    this.code = code
  }
}

export function isRetryable(err: unknown): boolean {
  if (err instanceof RetryableError) return true
  if (err instanceof NonRetryableError) return false

  // Generic heuristic: treat network-ish errors as retryable.
  if (err instanceof Error) {
    const msg = err.message.toLowerCase()
    if (msg.includes('timeout')) return true
    if (msg.includes('econnreset')) return true
    if (msg.includes('enotfound')) return true
    if (msg.includes('fetch failed')) return true
  }
  return false
}
