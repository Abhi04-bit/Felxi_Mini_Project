import type { AlertToastItem } from '../lib/alertTransitions.js'

type Props = {
  notifications: AlertToastItem[]
  onDismiss: (id: string) => void
  getRecommendation: (name: string, severity: string) => string
}

function severityTone(severity: string) {
  const normalized = severity.toLowerCase()
  return normalized === 'critical' ? 'critical' : normalized === 'warning' ? 'warning' : 'informational'
}

function alertDescription(summary?: string, description?: string) {
  return summary || description || 'Prometheus reports this alert as firing. No summary annotation was provided.'
}

function activeTimestamp(activeAt?: string) {
  if (!activeAt) return null
  const timestamp = new Date(activeAt)
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toLocaleString()
}

export default function AlertToastRegion({ notifications, onDismiss, getRecommendation }: Props) {
  if (!notifications.length) return null

  return (
    <section className="toast-region" aria-label="New Prometheus alert notifications">
      {notifications.map(({ id, alert }) => {
        const tone = severityTone(alert.severity)
        const timestamp = activeTimestamp(alert.activeAt)
        return (
          <article className={`alert-toast ${tone}`} key={id} role={tone === 'critical' ? 'alert' : 'status'} aria-live={tone === 'critical' ? 'assertive' : 'polite'}>
            <div className="toast-heading">
              <span className="toast-severity">{alert.severity} alert</span>
              <button type="button" className="toast-dismiss" onClick={() => onDismiss(id)} aria-label={`Dismiss ${alert.name} notification`} title="Dismiss notification">×</button>
            </div>
            <h2>{alert.name}</h2>
            <p className="toast-description">{alertDescription(alert.summary, alert.description)}</p>
            {timestamp && <p className="toast-timestamp"><span>Active since</span> <time dateTime={alert.activeAt}>{timestamp}</time></p>}
            <p className="toast-action"><strong>Recommended next action</strong>{getRecommendation(alert.name, alert.severity)}</p>
          </article>
        )
      })}
    </section>
  )
}
