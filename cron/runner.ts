/**
 * Macro Oracle cron runner — CLI entry point for all scheduled jobs.
 *
 * Usage (via npm scripts):
 *   npm run cron:run                         → orchestrate_hourly (default)
 *   npm run cron:orchestrate                 → orchestrate_hourly
 *   npm run cron:fetch -- --source fred      → fetch_source for one provider
 *   npm run cron:normalize -- --axis RISK_0  → normalize_axis for one band
 *   npm run cron:health                      → health_check
 *   npm run cron:worker                      → worker:drain (flush local file queue)
 *
 * Direct invocation:
 *   tsx cron/runner.ts [jobName] [...args]
 *
 * Supported jobNames:
 *   orchestrate_hourly | fetch_source | normalize_axis | health_check | worker:drain
 */

import { runJob, dispatchTask } from './jobs.js'
import { getPersistence } from './lib/persistence.js'
import { getQueue } from './lib/queue.js'
import { LocalFileQueue } from './lib/queue.js'
import { log, logError } from './lib/logging.js'
import type { JobName } from './lib/types.js'

function parseArgs(argv: string[]): { jobName: string; flags: Record<string, string> } {
  const args = argv.slice(2) // strip node + script path
  const jobName = args[0] ?? 'orchestrate_hourly'
  const flags: Record<string, string> = {}

  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const val = args[i + 1] && !args[i + 1]!.startsWith('--') ? args[++i]! : 'true'
      flags[key] = val
    }
  }

  return { jobName, flags }
}

async function drainLocalQueue(): Promise<void> {
  const queue = new LocalFileQueue()
  const { processed, errors } = await queue.drain(dispatchTask)
  log('info', 'worker.drain.done', { processed, errors })
  if (errors > 0) process.exit(1)
}

async function main() {
  const { jobName, flags } = parseArgs(process.argv)

  log('info', 'runner.start', { job: jobName, flags })

  try {
    if (jobName === 'worker:drain') {
      await drainLocalQueue()
      return
    }

    const validJobs: JobName[] = [
      'orchestrate_hourly',
      'fetch_source',
      'normalize_axis',
      'health_check'
    ]

    if (!validJobs.includes(jobName as JobName)) {
      console.error(`Unknown job: "${jobName}". Valid jobs: ${validJobs.join(', ')}, worker:drain`)
      process.exit(1)
    }

    let payload: Record<string, unknown> = {}

    switch (jobName as JobName) {
      case 'orchestrate_hourly': {
        payload = {
          scheduledFor: flags.scheduledFor ?? new Date().toISOString()
        }
        break
      }
      case 'fetch_source': {
        if (!flags.source) {
          console.error('fetch_source requires --source <provider>')
          process.exit(1)
        }
        payload = {
          source: flags.source,
          scheduledFor: flags.scheduledFor ?? new Date().toISOString(),
          force: flags.force === 'true'
        }
        break
      }
      case 'normalize_axis': {
        if (!flags.axis) {
          console.error('normalize_axis requires --axis <axisKey>')
          process.exit(1)
        }
        payload = {
          axisKey: flags.axis,
          scheduledFor: flags.scheduledFor ?? new Date().toISOString(),
          method: flags.method,
          lookbackDays: flags.lookbackDays ? Number(flags.lookbackDays) : undefined
        }
        break
      }
      case 'health_check': {
        payload = {
          now: flags.now ?? new Date().toISOString()
        }
        break
      }
    }

    await runJob(jobName as JobName, payload)

    log('info', 'runner.done', { job: jobName })
  } catch (err) {
    logError('runner.fatal', err, { job: jobName })
    process.exit(1)
  }
}

main()
