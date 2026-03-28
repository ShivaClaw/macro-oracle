import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getEnv } from './env.js'
import { log, logError } from './logging.js'
import type { QueueTaskPayload } from './types.js'

export type Queue = {
  enqueue(task: QueueTaskPayload): Promise<void>
}

export type TaskDispatcher = (task: QueueTaskPayload) => Promise<void>

function stateRoot() {
  return join(process.cwd(), 'cron', '.state')
}

async function ensureState() {
  await mkdir(stateRoot(), { recursive: true })
}

export class InlineQueue implements Queue {
  constructor(private dispatch: TaskDispatcher) {}
  async enqueue(task: QueueTaskPayload): Promise<void> {
    log('info', 'queue.inline.dispatch', { task: task.task })
    await this.dispatch(task)
  }
}

export class LocalFileQueue implements Queue {
  private path = join(stateRoot(), 'queue.jsonl')

  async enqueue(task: QueueTaskPayload): Promise<void> {
    await ensureState()
    await appendFile(this.path, JSON.stringify(task) + '\n', 'utf8')
    log('info', 'queue.local_file.enqueued', { task: task.task, path: this.path })
  }

  async drain(dispatch: TaskDispatcher): Promise<{ processed: number; errors: number }> {
    await ensureState()

    let buf = ''
    try {
      buf = await readFile(this.path, 'utf8')
    } catch {
      return { processed: 0, errors: 0 }
    }

    const lines = buf.split('\n').filter(Boolean)
    // clear queue first for at-least-once semantics (worker may crash and re-enqueue in real queue)
    await writeFile(this.path, '', 'utf8')

    let processed = 0
    let errors = 0
    for (const line of lines) {
      try {
        const task = JSON.parse(line) as QueueTaskPayload
        await dispatch(task)
        processed += 1
      } catch (err) {
        errors += 1
        logError('queue.local_file.task_failed', err)
      }
    }

    return { processed, errors }
  }
}

export class QStashQueue implements Queue {
  constructor(private opts: { token: string; qstashUrl: string; workerUrl: string }) {}

  async enqueue(task: QueueTaskPayload): Promise<void> {
    const url = `${this.opts.qstashUrl.replace(/\/$/, '')}/v2/publish/${encodeURIComponent(this.opts.workerUrl)}`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.opts.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(task)
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`QStash enqueue failed: ${res.status} ${text}`)
    }

    log('info', 'queue.qstash.enqueued', { task: task.task, workerUrl: this.opts.workerUrl })
  }
}

export function getQueue(dispatch: TaskDispatcher): Queue {
  const env = getEnv()
  if (env.QUEUE_MODE === 'inline') return new InlineQueue(dispatch)
  if (env.QUEUE_MODE === 'qstash') {
    if (!env.QSTASH_TOKEN) {
      log('warn', 'QUEUE_MODE=qstash but QSTASH_TOKEN missing; falling back to local_file')
      return new LocalFileQueue()
    }
    const workerUrl = `${env.WORKER_BASE_URL.replace(/\/$/, '')}${env.WORKER_TASK_PATH}`
    return new QStashQueue({ token: env.QSTASH_TOKEN, qstashUrl: env.QSTASH_URL, workerUrl })
  }
  return new LocalFileQueue()
}
