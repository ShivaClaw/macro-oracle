export function createLimiter(max: number) {
  if (max <= 0 || !Number.isFinite(max)) throw new Error(`Invalid max concurrency: ${max}`)

  let active = 0
  const queue: Array<() => void> = []

  const next = () => {
    if (active >= max) return
    const job = queue.shift()
    if (!job) return
    active++
    job()
  }

  return async function limit<T>(fn: () => Promise<T>): Promise<T> {
    return await new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--
            next()
          })
      })
      next()
    })
  }
}
