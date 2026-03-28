import type { Persistence, JobRun } from './lib/persistence.js'
import { getPersistence } from './lib/persistence.js'
import { getQueue } from './lib/queue.js'
import { isRetryable } from './lib/errors.js'
import { log, logError } from './lib/logging.js'
import type {
  FetchSourcePayload,
  HealthCheckPayload,
  JobName,
  NormalizeAxisPayload,
  OrchestrateHourlyPayload,
  QueueTaskPayload
} from './lib/types.js'

import { orchestrateHourly } from './jobs/orchestrateHourly.js'
import { fetchSource } from './jobs/fetchSource.js'
import { normalizeAxis } from './jobs/normalizeAxis.js'
import { healthCheck } from './jobs/healthCheck.js'

export type JobContext = {
  persistence: Persistence
  jobRun: JobRun
  enqueue: (task: QueueTaskPayload) => Promise<void>
}

export async function runJob(jobName: JobName, payload: any): Promise<void> {
  const persistence = await getPersistence()

  const scheduledFor: string | undefined =
    payload?.scheduledFor ?? payload?.payload?.scheduledFor ?? payload?.now ?? undefined

  const jobRun = await persistence.createJobRun({ jobName, scheduledFor, meta: { payload } })

  const dispatch: (task: QueueTaskPayload) => Promise<void> = async (task) => {
    await dispatchTask(task)
  }

  const queue = getQueue(dispatch)

  const ctx: JobContext = {
    persistence,
    jobRun,
    enqueue: async (task) => queue.enqueue({ ...task, jobRunId: jobRun.id })
  }

  try {
    log('info', 'job.start', { job_name: jobName, job_run_id: jobRun.id, scheduled_for: scheduledFor })

    if (jobName === 'orchestrate_hourly') {
      await orchestrateHourly(ctx, payload as OrchestrateHourlyPayload)
    } else if (jobName === 'fetch_source') {
      await fetchSource(ctx, payload as FetchSourcePayload)
    } else if (jobName === 'normalize_axis') {
      await normalizeAxis(ctx, payload as NormalizeAxisPayload)
    } else if (jobName === 'health_check') {
      await healthCheck(ctx, payload as HealthCheckPayload)
    } else if (jobName === 'worker:drain') {
      // worker drain is handled in runner; not a persistent job.
      throw new Error('worker:drain is not runnable via runJob()')
    } else {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`Unknown job: ${jobName}`)
    }

    await persistence.finishJobRun({ id: jobRun.id, status: 'succeeded' })
    log('info', 'job.succeeded', { job_name: jobName, job_run_id: jobRun.id })
  } catch (err) {
    const retryable = isRetryable(err)
    await persistence.finishJobRun({ id: jobRun.id, status: retryable ? 'retryable_failed' : 'failed', meta: { retryable } })
    logError('job.failed', err, { job_name: jobName, job_run_id: jobRun.id, retryable })
    throw err
  }
}

function taskKey(task: QueueTaskPayload): string {
  if (task.task === 'fetch_source') return `fetch:${task.payload.source}`
  if (task.task === 'normalize_axis') return `normalize:${task.payload.axisKey}`
  if (task.task === 'health_check') return 'health_check'
  return task.task
}

export async function dispatchTask(task: QueueTaskPayload): Promise<void> {
  const persistence = await getPersistence()
  const system = await persistence.getSystemState()

  if (system.paused && task.task !== 'health_check') {
    log('warn', 'system.paused.reject_task', { task: task.task })
    return
  }

  // If parent job run id present, attach as task_run; otherwise create a standalone job_run.
  const parentJobRunId = task.jobRunId
  const standalone = !parentJobRunId
  const jobRun = standalone
    ? await persistence.createJobRun({
        jobName: task.task as JobName,
        scheduledFor: (task.payload as any)?.scheduledFor,
        meta: { queued_task: task }
      })
    : ({ id: parentJobRunId!, jobName: 'orchestrate_hourly' } as any)

  const tr = await persistence.createTaskRun({ jobRunId: jobRun.id, taskKey: taskKey(task), attempt: 1 })

  const ctx: JobContext = {
    persistence,
    jobRun: jobRun as any,
    enqueue: async (t) => {
      const q = getQueue(dispatchTask)
      await q.enqueue(t)
    }
  }

  try {
    if (task.task === 'fetch_source') await fetchSource(ctx, task.payload)
    if (task.task === 'normalize_axis') await normalizeAxis(ctx, task.payload)
    if (task.task === 'health_check') await healthCheck(ctx, task.payload)

    await persistence.finishTaskRun({ id: tr.id, status: 'succeeded' })
    if (standalone) await persistence.finishJobRun({ id: jobRun.id, status: 'succeeded' })
  } catch (err) {
    const retryable = isRetryable(err)
    await persistence.finishTaskRun({
      id: tr.id,
      status: retryable ? 'retryable_failed' : 'failed',
      errorCode: (err as any)?.code,
      errorMessage: (err as any)?.message
    })
    if (standalone) await persistence.finishJobRun({ id: jobRun.id, status: retryable ? 'retryable_failed' : 'failed' })
    throw err
  }
}
