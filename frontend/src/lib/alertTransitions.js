/** @typedef {{ name: string, severity: string, state: string, labels: Record<string, string> }} AlertLike */

export function alertIdentity(alert) {
  const labels = Object.entries(alert.labels || {}).sort(([left], [right]) => left.localeCompare(right))
  return JSON.stringify([alert.name, labels])
}

/** Tracks snapshots returned by Prometheus and only emits observed transitions. */
export class AlertTransitionTracker {
  previous = null
  recovering = false

  observe(status, alerts = []) {
    if (status === 'loading') return []
    if (status !== 'ready') {
      this.recovering = true
      return []
    }

    const current = new Map(alerts.map((alert) => [alertIdentity(alert), alert]))
    const newlyFiring = []
    if (this.previous !== null && !this.recovering) {
      for (const [identity, alert] of current) {
        if (alert.state.toLowerCase() === 'firing' && this.previous.get(identity)?.state.toLowerCase() !== 'firing') {
          newlyFiring.push(alert)
        }
      }
    }

    this.previous = current
    this.recovering = false
    return newlyFiring
  }
}

export function notificationReducer(state, action) {
  if (action.type === 'add') return [...state, ...action.notifications]
  if (action.type === 'dismiss') return state.filter((notification) => notification.id !== action.id)
  return state
}
