import { getEnv } from './env.js'
import { Severity } from './types.js'
import { log, logError } from './logging.js'

export type Alert = {
  severity: Severity
  key: string
  message: string
  meta?: Record<string, unknown>
}

export async function sendWebhookAlert(alert: Alert): Promise<void> {
  const env = getEnv()
  if (!env.ALERT_WEBHOOK_URL) {
    log('info', 'alert.webhook.skipped (no ALERT_WEBHOOK_URL)', { key: alert.key, severity: alert.severity })
    return
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), env.ALERT_WEBHOOK_TIMEOUT_MS)

  try {
    // Discord-compatible: {content: string}
    const content = `[${alert.severity.toUpperCase()}] ${alert.message}\nkey=${alert.key}\nmeta=${JSON.stringify(alert.meta ?? {})}`
    const res = await fetch(env.ALERT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content }),
      signal: controller.signal
    })

    if (!res.ok) {
      throw new Error(`Webhook returned ${res.status}`)
    }

    log('info', 'alert.webhook.sent', { key: alert.key, severity: alert.severity })
  } catch (err) {
    logError('alert.webhook.failed', err, { key: alert.key, severity: alert.severity })
  } finally {
    clearTimeout(timeout)
  }
}
