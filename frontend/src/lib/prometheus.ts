export type LoadState<T> =
  | { status: 'loading' }
  | { status: 'ready'; value: T }
  | { status: 'unavailable'; reason: string }
  | { status: 'error'; reason: string }

export type TimePoint = { time: number; value: number }
export type ServiceStatus = { job: string; instance: string; up: boolean | null; lastScrape?: number }
export type Alert = {
  name: string
  severity: string
  state: string
  activeAt?: string
  summary?: string
  description?: string
  condition?: string
  labels: Record<string, string>
}
export type BlackboxProbe = {
  target: string
  targetName?: string
  success?: boolean
  certificateExpiry?: number
}
export type BlackboxStatus = { checks: BlackboxProbe[] }

type PromResponse<T> = { status: 'success' | 'error'; data?: T; error?: string }
type VectorSample = { metric: Record<string, string>; value?: [number, string] }
type MatrixSample = { metric: Record<string, string>; values: [number, string][] }

class MetricUnavailableError extends Error {}

const API = '/api/prometheus/api/v1'
const rangeSettings = {
  '1h': { seconds: 3600, step: 30, window: '1m' },
  '6h': { seconds: 21600, step: 180, window: '5m' },
  '24h': { seconds: 86400, step: 600, window: '10m' },
  '7d': { seconds: 604800, step: 3600, window: '1h' },
} as const
export type RangeKey = keyof typeof rangeSettings

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API}${path}`, { signal, headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`Prometheus returned HTTP ${response.status}`)
  const body = (await response.json()) as PromResponse<T>
  if (body.status !== 'success' || body.data === undefined) {
    throw new Error(body.error || 'Prometheus did not return a successful response')
  }
  return body.data
}

async function query(queryText: string, signal?: AbortSignal): Promise<VectorSample[]> {
  const params = new URLSearchParams({ query: queryText })
  const data = await request<{ resultType: string; result: VectorSample[] }>(`/query?${params}`, signal)
  return data.result || []
}

function asLoadable<T>(promise: Promise<T>): Promise<LoadState<T>> {
  return promise.then(
    (value) => ({ status: 'ready', value }),
    (error: unknown) => error instanceof MetricUnavailableError
      ? { status: 'unavailable', reason: error.message }
      : { status: 'error', reason: error instanceof Error ? error.message : 'Could not reach Prometheus' },
  )
}

function sampleNumber(sample?: VectorSample): number | undefined {
  if (!sample?.value) return undefined
  const value = Number(sample.value[1])
  return Number.isFinite(value) ? value : undefined
}

export async function loadTelemetry(range: RangeKey, signal: AbortSignal) {
  const now = Math.floor(Date.now() / 1000)
  const settings = rangeSettings[range]
  const start = now - settings.seconds
  const rangeParams = new URLSearchParams({
    query: `round(sum(increase(failed_ssh_logins_total[${settings.window}])))`,
    start: String(start),
    end: String(now),
    step: String(settings.step),
  })

  const failedLogins = asLoadable(
    query('round(sum(increase(failed_ssh_logins_total[' + range + '])))', signal).then((samples) => {
      const value = sampleNumber(samples[0])
      if (value === undefined) throw new MetricUnavailableError('No failed-login counter has been scraped yet')
      return value
    }),
  )
  const trend = asLoadable(
    request<{ result: MatrixSample[] }>(`/query_range?${rangeParams}`, signal).then((data) => {
      const points = (data.result || []).flatMap((series) =>
        series.values.map(([time, raw]) => ({ time, value: Number(raw) })).filter((point) => Number.isFinite(point.value)),
      )
      if (!data.result?.length) throw new MetricUnavailableError('No failed-login history is available for this period')
      return points
    }),
  )
  const availability = asLoadable(
    query('up{job=~"sentinelpulse-exporter|prometheus|alertmanager|grafana"}', signal).then((samples) => {
      if (!samples.length) throw new MetricUnavailableError('No monitoring targets have been scraped yet')
      const observed = samples.map((sample) => ({
        job: sample.metric.job || 'unknown',
        instance: sample.metric.instance || 'unknown target',
        up: sampleNumber(sample) === 1,
        lastScrape: sample.value ? Number(sample.value[0]) : undefined,
      }))
      const expectedJobs = ['sentinelpulse-exporter', 'prometheus', 'alertmanager', 'grafana']
      return [...observed, ...expectedJobs.filter((job) => !observed.some((service) => service.job === job)).map((job) => ({
        job,
        instance: 'No scrape data',
        up: null,
      }))]
    }),
  )
  const alerts = asLoadable(
    Promise.all([
      request<{ alerts?: Array<{ labels?: Record<string, string>; annotations?: Record<string, string>; state?: string; activeAt?: string }> }>('/alerts', signal),
      request<{ groups?: Array<{ rules?: Array<{ name?: string; query?: string }> }> }>('/rules?type=alert', signal).catch(() => undefined),
    ]).then(([data, ruleData]) => {
      const conditions = new Map(
        (ruleData?.groups || []).flatMap((group) => (group.rules || []).map((rule) => [rule.name || '', rule.query || ''] as const)),
      )
      return (data.alerts || []).map((alert) => ({
        name: alert.labels?.alertname || 'Unnamed alert',
        severity: alert.labels?.severity || 'unknown',
        state: alert.state || 'unknown',
        activeAt: alert.activeAt,
        summary: alert.annotations?.summary,
        description: alert.annotations?.description,
        condition: conditions.get(alert.labels?.alertname || ''),
        labels: alert.labels || {},
      }))
    }),
  )
  const blackbox = asLoadable(
    Promise.all([
      query('probe_success{job="blackbox-https"}', signal),
      query('probe_ssl_earliest_cert_expiry{job="blackbox-https"}', signal),
    ]).then(
      ([probeSamples, expirySamples]) => {
        if (!probeSamples.length && !expirySamples.length) throw new MetricUnavailableError('No HTTPS probe metrics are available. Check Blackbox Exporter health, Prometheus targets, and blackbox/targets.yml.')
        const checks = new Map<string, BlackboxProbe>()
        const targetKey = (sample: VectorSample) => sample.metric.instance || sample.metric.target || sample.metric.target_name || 'configured HTTPS target'
        for (const sample of probeSamples) {
          const target = targetKey(sample)
          const value = sampleNumber(sample)
          checks.set(target, {
            target,
            targetName: sample.metric.target_name,
            success: value === undefined ? undefined : value === 1,
          })
        }
        for (const sample of expirySamples) {
          const target = targetKey(sample)
          const check = checks.get(target) || { target, targetName: sample.metric.target_name }
          check.certificateExpiry = sampleNumber(sample)
          checks.set(target, check)
        }
        return {
          checks: [...checks.values()],
        }
      },
    ),
  )

  return Promise.all([failedLogins, trend, availability, alerts, blackbox]).then(
    ([failedLoginCount, loginTrend, services, activeAlerts, endpointChecks]) => ({
      failedLoginCount,
      loginTrend,
      services,
      activeAlerts,
      endpointChecks,
      fetchedAt: new Date(),
    }),
  )
}

export function rangeWindow(range: RangeKey) {
  return rangeSettings[range].window
}

export function availabilitySeries(state: LoadState<ServiceStatus[]>) {
  return state.status === 'ready' ? state.value : []
}

