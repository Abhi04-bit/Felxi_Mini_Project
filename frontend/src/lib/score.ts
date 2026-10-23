import type { Alert, LoadState, ServiceStatus } from './prometheus'

export type HealthScore = { score: number | null; coverage: number; observedGroups: number; totalGroups: number }

/**
 * SentinelPulse's local heuristic (not an industry-standard rating):
 * exporter 40%, non-exporter monitoring services 20%, active alerts 25%,
 * and failed-login activity 15%. Each observed group contributes its weighted
 * health. Missing groups are excluded from the denominator and reduce coverage,
 * so they can never silently improve the score.
 */
export function calculateHealthScore(input: {
  services: LoadState<ServiceStatus[]>
  alerts: LoadState<Alert[]>
  failedLogins: LoadState<number>
}): HealthScore {
  const groups: Array<{ weight: number; health: number }> = []
  if (input.services.status === 'ready') {
    const services = input.services.value
    const exporterTargets = services.filter((service) => service.job === 'sentinelpulse-exporter' && service.up !== null)
    const otherTargets = services.filter((service) => service.job !== 'sentinelpulse-exporter' && service.up !== null)
    if (exporterTargets.length) groups.push({ weight: 40, health: exporterTargets.filter((service) => service.up).length / exporterTargets.length })
    const observedOtherJobs = [...new Set(otherTargets.map((service) => service.job))]
    if (observedOtherJobs.length) {
      const serviceHealth = observedOtherJobs.map((job) => {
        const targets = otherTargets.filter((service) => service.job === job)
        return targets.filter((service) => service.up).length / targets.length
      })
      groups.push({ weight: 20 * observedOtherJobs.length / 3, health: serviceHealth.reduce((sum, value) => sum + value, 0) / serviceHealth.length })
    }
  }
  if (input.alerts.status === 'ready') {
    const penalty = input.alerts.value.reduce((total, alert) => {
      const severity = alert.severity.toLowerCase()
      return total + (severity === 'critical' ? 1 : severity === 'warning' ? 0.4 : severity === 'info' ? 0.1 : 0.2)
    }, 0)
    groups.push({ weight: 25, health: Math.max(0, 1 - penalty) })
  }
  if (input.failedLogins.status === 'ready') groups.push({ weight: 15, health: Math.max(0, 1 - Math.max(0, input.failedLogins.value) / 10) })

  const observedWeight = groups.reduce((sum, group) => sum + group.weight, 0)
  const weightedHealth = groups.reduce((sum, group) => sum + group.weight * group.health, 0)
  return {
    score: observedWeight ? Math.round((weightedHealth / observedWeight) * 100) : null,
    coverage: Math.round((observedWeight / 100) * 100),
    observedGroups: groups.length,
    totalGroups: 4,
  }
}
