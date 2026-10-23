import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  availabilitySeries,
  loadTelemetry,
  rangeWindow,
  type Alert,
  type BlackboxStatus,
  type LoadState,
  type RangeKey,
  type ServiceStatus,
  type TimePoint,
} from './lib/prometheus'
import { calculateHealthScore } from './lib/score'
import { AlertTransitionTracker, notificationReducer, type AlertToastItem } from './lib/alertTransitions.js'
import {
  createAlertDesktopNotification,
  readNotificationPermission,
  requestNotificationPermission,
  shouldSendDesktopNotification,
  type DesktopNotificationApi,
  type DesktopPermission,
} from './lib/desktopNotifications.js'
import AlertToastRegion from './components/AlertToastRegion'
import DesktopNotificationSettings from './components/DesktopNotificationSettings'

type Page = 'Overview' | 'Alert Center' | 'Security Metrics' | 'System Status'
type Telemetry = {
  failedLoginCount: LoadState<number>
  loginTrend: LoadState<TimePoint[]>
  services: LoadState<ServiceStatus[]>
  activeAlerts: LoadState<Alert[]>
  endpointChecks: LoadState<BlackboxStatus>
  fetchedAt: Date | null
  connectionError?: string | null
}

const pageItems: Array<{ title: Page; icon: string }> = [
  { title: 'Overview', icon: '◫' },
  { title: 'Alert Center', icon: '⌁' },
  { title: 'Security Metrics', icon: '⌗' },
  { title: 'System Status', icon: '▤' },
]
const grafanaUrl = import.meta.env.VITE_GRAFANA_URL || 'http://localhost:3000'
const rangeLabels: Record<RangeKey, string> = { '1h': 'Last hour', '6h': 'Last 6 hours', '24h': 'Last 24 hours', '7d': 'Last 7 days' }
const desktopNotificationPreferenceKey = 'sentinelpulse.desktopNotificationsEnabled'

const loading = <T,>(): LoadState<T> => ({ status: 'loading' })

function browserNotificationApi(): DesktopNotificationApi | undefined {
  if (typeof window === 'undefined' || !window.isSecureContext || !('Notification' in window)) return undefined
  return window.Notification
}

function readDesktopNotificationPreference() {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(desktopNotificationPreferenceKey) === 'true'
  } catch {
    return false
  }
}

function storeDesktopNotificationPreference(enabled: boolean) {
  try {
    window.localStorage.setItem(desktopNotificationPreferenceKey, String(enabled))
  } catch {
    // The current session preference still works if browser storage is unavailable.
  }
}

function useTelemetry(range: RangeKey, reload: number) {
  const [data, setData] = useState<Telemetry>({
    failedLoginCount: loading(),
    loginTrend: loading(),
    services: loading(),
    activeAlerts: loading(),
    endpointChecks: loading(),
    fetchedAt: null,
  })
  const [connectionError, setConnectionError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const fetchData = () => {
      setData((current) => ({
        ...current,
        failedLoginCount: loading(),
        loginTrend: loading(),
        services: loading(),
        activeAlerts: loading(),
        endpointChecks: loading(),
      }))
      loadTelemetry(range, controller.signal)
        .then((result) => {
          if (controller.signal.aborted) return
          const hasLiveQuery = [result.failedLoginCount, result.loginTrend, result.services, result.activeAlerts].some((signal) => signal.status === 'ready')
          setData((current) => ({ ...result, fetchedAt: hasLiveQuery ? new Date() : current.fetchedAt }))
          setConnectionError(result.services.status === 'error' ? result.services.reason : null)
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          setConnectionError(error instanceof Error ? error.message : 'Prometheus is unavailable')
        })
    }
    fetchData()
    const interval = window.setInterval(fetchData, 30_000)
    return () => {
      controller.abort()
      window.clearInterval(interval)
    }
  }, [range, reload])

  return { ...data, connectionError }
}

function App() {
  const [page, setPage] = useState<Page>('Overview')
  const [range, setRange] = useState<RangeKey>('6h')
  const [reload, setReload] = useState(0)
  const [notifications, dispatchNotifications] = useReducer(notificationReducer, [])
  const [desktopPermission, setDesktopPermission] = useState<DesktopPermission>(() => readNotificationPermission(browserNotificationApi()))
  const [desktopNotificationsEnabled, setDesktopNotificationsEnabled] = useState(readDesktopNotificationPreference)
  const [desktopNotificationError, setDesktopNotificationError] = useState<string | null>(null)
  const transitionTracker = useRef<AlertTransitionTracker | null>(null)
  const notificationSequence = useRef(0)
  const permissionRequestedThisSession = useRef(false)
  if (!transitionTracker.current) transitionTracker.current = new AlertTransitionTracker()
  const telemetry = useTelemetry(range, reload)
  const score = useMemo(
    () => calculateHealthScore({ services: telemetry.services, alerts: telemetry.activeAlerts, failedLogins: telemetry.failedLoginCount }),
    [telemetry.services, telemetry.activeAlerts, telemetry.failedLoginCount],
  )
  const activeAlerts = telemetry.activeAlerts.status === 'ready'
    ? telemetry.activeAlerts.value.filter((alert) => ['firing', 'pending'].includes(alert.state.toLowerCase()))
    : []

  useEffect(() => {
    const syncPermission = () => {
      const permission = readNotificationPermission(browserNotificationApi())
      setDesktopPermission(permission)
      if (permission !== 'granted') {
        setDesktopNotificationsEnabled(false)
        storeDesktopNotificationPreference(false)
      }
    }
    syncPermission()
    window.addEventListener('focus', syncPermission)
    return () => window.removeEventListener('focus', syncPermission)
  }, [])

  const enableDesktopNotifications = async () => {
    const api = browserNotificationApi()
    let permission = readNotificationPermission(api)
    if (permission === 'default') {
      if (permissionRequestedThisSession.current) {
        setDesktopPermission('prompt-dismissed')
        return
      }
      permissionRequestedThisSession.current = true
      setDesktopPermission('requesting')
      permission = await requestNotificationPermission(api)
      if (permission === 'default') permission = 'prompt-dismissed'
    }
    setDesktopPermission(permission)
    if (permission === 'granted') {
      setDesktopNotificationsEnabled(true)
      storeDesktopNotificationPreference(true)
      setDesktopNotificationError(null)
    } else {
      setDesktopNotificationsEnabled(false)
      storeDesktopNotificationPreference(false)
    }
  }

  const disableDesktopNotifications = () => {
    setDesktopNotificationsEnabled(false)
    storeDesktopNotificationPreference(false)
    setDesktopNotificationError(null)
  }

  useEffect(() => {
    const newlyFiring = transitionTracker.current?.observe(
      telemetry.activeAlerts.status,
      telemetry.activeAlerts.status === 'ready' ? telemetry.activeAlerts.value : [],
    ) || []
    if (newlyFiring.length) {
      dispatchNotifications({
        type: 'add',
        notifications: newlyFiring.map((alert): AlertToastItem => ({
          id: `${notificationSequence.current++}:${alert.name}`,
          alert,
        })),
      })
      if (shouldSendDesktopNotification(desktopNotificationsEnabled, desktopPermission)) {
        const api = browserNotificationApi()
        for (const alert of newlyFiring) {
          const result = createAlertDesktopNotification(api, alert)
          if (result === 'error') setDesktopNotificationError('The browser could not create a desktop notification. Check this site’s notification and operating-system settings.')
          if (result === 'not-permitted') {
            const permission = readNotificationPermission(api)
            setDesktopPermission(permission)
            setDesktopNotificationsEnabled(false)
            storeDesktopNotificationPreference(false)
          }
        }
      }
    }
  }, [telemetry.activeAlerts, desktopNotificationsEnabled, desktopPermission])

  return (
    <div className="app-shell">
      <AlertToastRegion notifications={notifications} onDismiss={(id) => dispatchNotifications({ type: 'dismiss', id })} getRecommendation={recommendation} />
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><span /><span /><span /></div>
          <div><div className="brand-name">Sentinel<span>Pulse</span></div><div className="brand-kicker">SECURITY OPERATIONS</div></div>
        </div>
        <div className="sidebar-label">WORKSPACE</div>
        <nav aria-label="Main navigation" className="nav-list">
          {pageItems.map((item) => (
            <button key={item.title} type="button" onClick={() => setPage(item.title)} className={`nav-item ${page === item.title ? 'active' : ''}`} aria-current={page === item.title ? 'page' : undefined}>
              <span className="nav-icon" aria-hidden="true">{item.icon}</span><span>{item.title}</span>
              {item.title === 'Alert Center' && activeAlerts.length > 0 && <span className="nav-count">{activeAlerts.length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-label">MONITORING</div>
          <div className="stack-indicator"><span className={`pulse-dot ${telemetry.connectionError ? 'down' : ''}`} />
            <div><div className="stack-title">Prometheus API</div><div className="stack-caption">{telemetry.connectionError ? 'Connection issue' : 'Local connection'}</div></div>
          </div>
          <div className="sidebar-foot">SentinelPulse · Phase 5<br />Telemetry refreshes every 30 seconds</div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="mobile-brand"><div className="brand-mark small" aria-hidden="true"><span /><span /><span /></div><strong>Sentinel<span>Pulse</span></strong></div>
          <div className="breadcrumb"><span>Workspace</span><span className="slash">/</span><strong>{page}</strong></div>
          <div className="topbar-actions">
            <label htmlFor="time-range" className="range-label">TIME RANGE</label>
            <select id="time-range" value={range} onChange={(event) => setRange(event.target.value as RangeKey)} className="range-select" aria-label="Select dashboard time range">
              {Object.entries(rangeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <button type="button" className="icon-button refresh-button" onClick={() => setReload((value) => value + 1)} aria-label="Refresh telemetry" title="Refresh telemetry">↻</button>
            <DesktopNotificationSettings permission={desktopPermission} enabled={desktopNotificationsEnabled} notificationError={desktopNotificationError} onEnable={enableDesktopNotifications} onDisable={disableDesktopNotifications} />
            <a href={grafanaUrl} target="_blank" rel="noreferrer" className="grafana-link">Grafana <span aria-hidden="true">↗</span></a>
          </div>
        </header>

        <div className="content-wrap">
          {telemetry.connectionError && <div role="alert" className="connection-banner"><span className="warning-icon">!</span><div><strong>Prometheus is not responding.</strong> Start the monitoring stack and confirm it is reachable through the local proxy. {telemetry.connectionError}</div></div>}
          {page === 'Overview' && <Overview data={telemetry} score={score} activeAlerts={activeAlerts} range={range} onNavigate={setPage} />}
          {page === 'Alert Center' && <AlertCenter state={telemetry.activeAlerts} />}
          {page === 'Security Metrics' && <SecurityMetrics data={telemetry} range={range} />}
          {page === 'System Status' && <SystemStatus data={telemetry} />}
          <footer className="content-footer"><span>Telemetry source: Prometheus HTTP API</span><span>Last successful update: {telemetry.fetchedAt?.toLocaleTimeString() || 'None yet'}</span><span>Monitoring is local to this environment</span></footer>
        </div>
      </main>
    </div>
  )
}

function PageHeading({ eyebrow, title, description, aside }: { eyebrow: string; title: string; description: string; aside?: React.ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{aside}</div>
}

function Overview({ data, score, activeAlerts, range, onNavigate }: { data: Telemetry; score: ReturnType<typeof calculateHealthScore>; activeAlerts: Alert[]; range: RangeKey; onNavigate: (page: Page) => void }) {
  const serviceData = availabilitySeries(data.services)
  const exporter = serviceData.find((service) => service.job === 'sentinelpulse-exporter')
  return <>
          <PageHeading eyebrow="SECURITY OVERVIEW" title="Good afternoon, operator" description="A live view of security signals and monitoring health across your environment." aside={<span className={`live-chip ${data.connectionError ? 'offline-chip' : ''}`}><span className={`pulse-dot ${data.connectionError ? 'down' : ''}`} />{data.connectionError ? 'PROMETHEUS OFFLINE' : 'PROMETHEUS CONNECTED'}</span>} />
    <section className="overview-lead-grid">
      <Panel className="health-panel">
        <div className="panel-top"><div><div className="panel-eyebrow">SECURITY HEALTH</div><h2>Environment score</h2></div><span className="help-mark" title="A deterministic SentinelPulse heuristic based only on available signals; not an industry-standard rating." aria-label="Score formula details">i</span></div>
        <div className="score-row"><ScoreGauge score={score.score} /><div className="score-details"><div className="score-caption">{score.score === null ? 'Not enough telemetry' : score.coverage < 100 ? 'Provisional score' : score.score >= 85 ? 'Signals look stable' : score.score >= 60 ? 'Attention recommended' : 'Elevated risk signals'}</div><div className="coverage-track"><span style={{ width: `${score.coverage}%` }} /></div><div className="coverage-caption">Signal coverage <strong>{score.coverage}%</strong> · {score.observedGroups}/{score.totalGroups} groups</div><button className="text-link" type="button" onClick={() => onNavigate('System Status')}>Review score inputs <span>→</span></button></div></div>
        <div className="score-footnote">Local heuristic; available signals only. Missing groups reduce coverage and are excluded from the score.</div>
      </Panel>
      <Panel className="alert-summary-panel">
        <div className="panel-top"><div><div className="panel-eyebrow">THREAT ACTIVITY</div><h2>Active alerts</h2></div><span className={`alert-count-bubble ${activeAlerts.length ? 'has-alerts' : ''}`}>{data.activeAlerts.status === 'ready' ? activeAlerts.length : '—'}</span></div>
        <StateValue state={data.activeAlerts} unavailable="Alert API unavailable" />
        <div className="alert-summary-bottom"><div className="alert-severity-line"><span className="severity-dot critical" />Critical <strong>{activeAlerts.filter((alert) => alert.severity === 'critical').length}</strong></div><div className="alert-severity-line"><span className="severity-dot warning" />Warning <strong>{activeAlerts.filter((alert) => alert.severity === 'warning').length}</strong></div></div>
        <button className="text-link" type="button" onClick={() => onNavigate('Alert Center')}>Open alert center <span>→</span></button>
      </Panel>
    </section>

    <section className="stats-grid">
      <MetricCard label="FAILED SSH LOGINS" value={data.failedLoginCount.status === 'ready' ? formatNumber(data.failedLoginCount.value) : '—'} detail={data.failedLoginCount.status === 'ready' ? rangeLabels[range] : stateSummary(data.failedLoginCount)} icon="↗" tone="coral" />
      <MetricCard label="EXPORTER STATUS" value={exporter ? (exporter.up === null ? 'No data' : exporter.up ? 'Online' : 'Offline') : '—'} detail={exporter ? exporter.instance : stateSummary(data.services)} icon="◉" tone={exporter?.up === null ? 'neutral' : exporter?.up ? 'mint' : 'coral'} />
      <MetricCard label="MONITORING TARGETS" value={data.services.status === 'ready' ? `${serviceData.filter((service) => service.up === true).length}/${serviceData.filter((service) => service.up !== null).length}` : '—'} detail={data.services.status === 'ready' ? `${serviceData.filter((service) => service.up === null).length} without scrape data` : stateSummary(data.services)} icon="⌘" tone="blue" />
      <TlsCard state={data.endpointChecks} />
    </section>

    <section className="overview-main-grid">
      <LoginTrend state={data.loginTrend} range={range} compact />
      <Panel className="recent-panel">
        <div className="panel-top"><div><div className="panel-eyebrow">SECURITY ACTIVITY</div><h2>Recent event detail</h2></div><span className="subtle-pill">LIVE</span></div>
        <div className="event-empty"><div className="empty-icon">⌁</div><strong>Event-level feed unavailable</strong><p>The exporter publishes aggregated failed-login counters, not individual event records. Active Prometheus alerts are available in the Alert Center.</p><button className="text-link" type="button" onClick={() => onNavigate('Alert Center')}>View active alerts <span>→</span></button></div>
      </Panel>
    </section>

    <section className="section-heading-row"><div><div className="panel-eyebrow">MONITORING FOOTPRINT</div><h2>Service availability</h2></div><button className="text-link" type="button" onClick={() => onNavigate('System Status')}>System status <span>→</span></button></section>
    <AvailabilityList state={data.services} compact />
  </>
}

function AlertCenter({ state }: { state: LoadState<Alert[]> }) {
  const alerts = state.status === 'ready' ? state.value.filter((alert) => ['firing', 'pending'].includes(alert.state.toLowerCase())) : []
  return <>
    <PageHeading eyebrow="RESPONSE & TRIAGE" title="Alert center" description="Current alert conditions reported by Prometheus, with context for the next response step." />
    <div className="alert-summary-strip"><div><span className="panel-eyebrow">ACTIVE CONDITIONS</span><strong>{state.status === 'ready' ? alerts.length : '—'}</strong></div><p>Prometheus alert state is separate from Alertmanager notification delivery. A firing alert does not confirm that a notification was delivered.</p></div>
    {state.status === 'ready' && alerts.length === 0 ? <EmptyState title="No active alerts" body="Prometheus currently reports no pending or firing alert conditions." icon="✓" /> : state.status === 'ready' ? <div className="alert-list">{alerts.map((alert, index) => <AlertCard key={`${alert.name}-${alert.activeAt || index}`} alert={alert} />)}</div> : <LoadStateView state={state} emptyTitle="Alerts unavailable" emptyBody="Could not read the Prometheus alert API." />}
  </>
}

function SecurityMetrics({ data, range }: { data: Telemetry; range: RangeKey }) {
  return <>
    <PageHeading eyebrow="OBSERVABILITY" title="Security metrics" description="Observed failed-login activity and monitoring signals over the selected time range." />
    <div className="metrics-summary-grid">
      <MetricCard label="FAILED LOGINS · SELECTED RANGE" value={data.failedLoginCount.status === 'ready' ? formatNumber(data.failedLoginCount.value) : '—'} detail={rangeLabels[range]} icon="↗" tone="coral" />
      <MetricCard label="MONITORING AVAILABILITY" value={data.services.status === 'ready' ? `${data.services.value.filter((service) => service.up === true).length}/${data.services.value.filter((service) => service.up !== null).length}` : '—'} detail={data.services.status === 'ready' ? `${data.services.value.filter((service) => service.up === null).length} without scrape data` : stateSummary(data.services)} icon="◉" tone="mint" />
      <TlsCard state={data.endpointChecks} />
    </div>
    <LoginTrend state={data.loginTrend} range={range} />
    <div className="system-grid">
      <Panel><div className="panel-top"><div><div className="panel-eyebrow">AVAILABILITY SIGNAL</div><h2>Service uptime state</h2></div><span className="subtle-pill">PROMETHEUS · up</span></div><AvailabilityChart state={data.services} /></Panel>
      <Panel><div className="panel-top"><div><div className="panel-eyebrow">CONFIGURED ENDPOINT CHECKS</div><h2>HTTPS & certificate</h2></div><span className="subtle-pill">BLACKBOX</span></div><TlsDetail state={data.endpointChecks} /></Panel>
    </div>
    <div className="formula-note"><strong>Metric interpretation</strong><span>Failed-login values use Prometheus <code>increase()</code> over the selected range. The history chart uses a window matched to the selected range (1m, 5m, 10m, or 1h); points are not individual event timestamps.</span></div>
  </>
}

function SystemStatus({ data }: { data: Telemetry }) {
  const score = calculateHealthScore({ services: data.services, alerts: data.activeAlerts, failedLogins: data.failedLoginCount })
  return <>
    <PageHeading eyebrow="INFRASTRUCTURE HEALTH" title="System status" description="Monitoring component reachability as seen by Prometheus, plus API connectivity from this dashboard." />
    <div className="system-summary-grid">
      <Panel className="system-health-card"><div className="panel-eyebrow">PROMETHEUS API</div><div className="api-status"><span className={`status-orb ${data.connectionError ? 'offline' : 'online'}`} /><strong>{data.connectionError ? 'Unavailable' : 'Connected'}</strong></div><p>{data.connectionError || 'Dashboard requests are reaching the local Prometheus API.'}</p></Panel>
      <Panel className="system-health-card"><div className="panel-eyebrow">OBSERVED SCORE COVERAGE</div><div className="system-score">{score.score === null ? '—' : score.score}<small>{score.score === null ? '' : '/100'}</small></div><p>{score.coverage}% of weighted signals available · heuristic, not industry-standard</p></Panel>
      <Panel className="system-health-card"><div className="panel-eyebrow">TLS PROBES</div><TlsDetail state={data.endpointChecks} compact /></Panel>
    </div>
    <Panel className="target-panel"><div className="panel-top"><div><div className="panel-eyebrow">PROMETHEUS SCRAPE TARGETS</div><h2>Component availability</h2></div><span className="subtle-pill">AUTO-REFRESH · 30S</span></div><AvailabilityList state={data.services} /></Panel>
    <div className="formula-note"><strong>Score formula</strong><span>Weighted observed health: exporter 40%, other monitoring targets 20%, alert exposure 25%, failed-login activity 15%. The alert group loses 100% per critical alert, 40% per warning, 10% per info alert (capped at 100%); SSH signal loses 10% per failed login in the selected range (capped at 100%). Missing groups are excluded from the denominator and lower coverage; if no groups are available, score is unavailable.</span></div>
  </>
}

function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={`panel ${className}`}>{children}</section>
}

function MetricCard({ label, value, detail, icon, tone }: { label: string; value: string; detail: string; icon: string; tone: string }) {
  return <div className="metric-card"><div className="metric-top"><span>{label}</span><span className={`metric-icon ${tone}`} aria-hidden="true">{icon}</span></div><div className="metric-value">{value}</div><div className="metric-detail">{detail}</div></div>
}

function TlsCard({ state }: { state: LoadState<BlackboxStatus> }) {
  let value = '—'
  let detail = stateSummary(state)
  let tone = 'neutral'
  if (state.status === 'ready') {
    const checks = state.value.checks
    const reachable = checks.filter((check) => check.success === true).length
    const failed = checks.filter((check) => check.success === false).length
    const expiries = checks.filter((check) => check.certificateExpiry !== undefined).sort((a, b) => a.certificateExpiry! - b.certificateExpiry!)
    if (!checks.length) detail = 'No HTTPS target metrics returned'
    else if (failed && !reachable) { value = 'Probe failed'; tone = 'coral' }
    else if (reachable === checks.length) { value = 'HTTPS up'; tone = 'mint' }
    else if (reachable || failed) { value = `${reachable}/${checks.length} up`; tone = failed ? 'coral' : 'neutral' }
    else { value = 'No probe result'; detail = 'Configured target metrics are incomplete' }

    if (expiries.length) {
      const nearest = expiries[0]
      const days = daysUntil(nearest.certificateExpiry!)
      detail = `${nearest.targetName || nearest.target}: ${expiryDescription(nearest.certificateExpiry!)}`
      if (days <= 14) tone = 'coral'
      else if (tone === 'neutral') tone = 'blue'
    } else if (failed) detail = `${failed} HTTPS probe${failed === 1 ? '' : 's'} failed; certificate expiry unavailable`
    else if (checks.length && !expiries.length) detail = 'Certificate expiry metric unavailable'
  }
  return <MetricCard label="HTTPS / TLS STATUS" value={value} detail={detail} icon="◇" tone={tone} />
}

function ScoreGauge({ score }: { score: number | null }) {
  const radius = 48
  const circumference = 2 * Math.PI * radius
  const offset = score === null ? circumference : circumference * (1 - score / 100)
  const color = score === null ? '#d8d0c1' : score >= 85 ? '#367A52' : score >= 60 ? '#D98936' : '#C83D3D'
  return <div className="score-gauge"><svg viewBox="0 0 120 120" role="img" aria-label={score === null ? 'Health score unavailable' : `Health score ${score} out of 100`}><circle className="gauge-track" cx="60" cy="60" r={radius} /><circle cx="60" cy="60" r={radius} stroke={color} strokeDasharray={circumference} strokeDashoffset={offset} className="gauge-value" /><text x="60" y="58" className="gauge-number">{score ?? '—'}</text><text x="60" y="77" className="gauge-unit">OUT OF 100</text></svg></div>
}

function LoginTrend({ state, range, compact = false }: { state: LoadState<TimePoint[]>; range: RangeKey; compact?: boolean }) {
  const points = state.status === 'ready' ? state.value : []
  const window = rangeWindow(range)
  const data = points.map((point) => ({ ...point, label: new Date(point.time * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }))
  return <Panel className={`chart-panel ${compact ? 'compact-chart' : ''}`}>
    <div className="panel-top"><div><div className="panel-eyebrow">FAILED SSH LOGINS</div><h2>Failed-login trend</h2><div className="panel-description">{window} counter increases per sample · {rangeLabels[range]}</div></div><span className="subtle-pill">PROMETHEUS</span></div>
    {state.status === 'ready' && data.length > 0 ? <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data} margin={{ top: 12, right: 8, bottom: 0, left: -14 }}>
      <defs><linearGradient id="loginGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#367A52" stopOpacity={0.2} /><stop offset="100%" stopColor="#367A52" stopOpacity={0.01} /></linearGradient></defs>
      <CartesianGrid stroke="#E8DFCE" strokeDasharray="3 5" vertical={false} />
      <XAxis dataKey="label" tick={{ fill: '#777367', fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={42} />
      <YAxis allowDecimals={false} tick={{ fill: '#777367', fontSize: 10 }} tickLine={false} axisLine={false} width={38} />
      <Tooltip contentStyle={{ background: '#FFFDF7', border: '1px solid #E8DFCE', borderRadius: 10, color: '#292820' }} labelStyle={{ color: '#777367' }} formatter={(value: number) => [formatNumber(value), `Failed logins / ${window}`]} />
      <Area type="monotone" dataKey="value" stroke="#367A52" strokeWidth={2} fill="url(#loginGradient)" activeDot={{ r: 4, fill: '#367A52', stroke: '#FFFDF7', strokeWidth: 2 }} />
    </AreaChart></ResponsiveContainer></div> : <LoadStateView state={state} emptyTitle="No failed-login history" emptyBody="This counter has not produced range data yet. Allow at least two exporter scrapes or submit a controlled test event." />}
  </Panel>
}

function AvailabilityList({ state, compact = false }: { state: LoadState<ServiceStatus[]>; compact?: boolean }) {
  if (state.status !== 'ready') return <LoadStateView state={state} emptyTitle="Availability unavailable" emptyBody="Prometheus has not returned scrape target metrics." />
  if (!state.value.length) return <EmptyState title="No targets found" body="Expected exporter and monitoring scrape jobs have not appeared in Prometheus." />
  return <div className={`availability-table ${compact ? 'compact-table' : ''}`}>
    <div className="availability-header"><span>COMPONENT</span><span>INSTANCE</span><span>LAST SCRAPE</span><span>STATE</span></div>
    {state.value.map((service, index) => <div className="availability-row" key={`${service.job}-${service.instance}-${index}`}><span className="service-name"><span className={`status-orb ${service.up === null ? 'unknown' : service.up ? 'online' : 'offline'}`} />{jobLabel(service.job)}</span><span className="mono-muted">{service.instance}</span><span className="mono-muted">{service.lastScrape ? new Date(service.lastScrape * 1000).toLocaleTimeString() : '—'}</span><StatusBadge up={service.up === null ? undefined : service.up} /></div>)}
  </div>
}

function AvailabilityChart({ state }: { state: LoadState<ServiceStatus[]> }) {
  if (state.status !== 'ready') return <LoadStateView state={state} emptyTitle="Availability unavailable" emptyBody="Service targets have not been scraped yet." />
  const chartData = state.value.filter((service) => service.up !== null).map((service) => ({ name: jobLabel(service.job), availability: service.up ? 100 : 0, status: service.up ? 'Up' : 'Down' }))
  if (!chartData.length) return <EmptyState title="No target metrics" body="Scrape jobs will appear here when Prometheus reports them." />
  return <div className="availability-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData} layout="vertical" margin={{ top: 8, right: 18, bottom: 4, left: 12 }}><CartesianGrid stroke="#E8DFCE" strokeDasharray="3 5" horizontal={false} /><XAxis type="number" domain={[0, 100]} tickFormatter={(value) => `${value}%`} tick={{ fill: '#777367', fontSize: 10 }} tickLine={false} axisLine={false} /><YAxis type="category" dataKey="name" width={118} tick={{ fill: '#625f54', fontSize: 11 }} tickLine={false} axisLine={false} /><Tooltip contentStyle={{ background: '#FFFDF7', border: '1px solid #E8DFCE', borderRadius: 10, color: '#292820' }} formatter={(value: number, _name, item) => [`${value}% · ${item.payload.status}`, 'Availability']} /><Line dataKey="availability" type="linear" stroke="#367A52" strokeWidth={0} dot={(props) => <circle cx={props.cx} cy={props.cy} r={5} fill={props.payload.availability === 100 ? '#367A52' : '#C83D3D'} stroke="#FFFDF7" strokeWidth={3} />} activeDot={false} /></LineChart></ResponsiveContainer></div>
}

function TlsDetail({ state, compact = false }: { state: LoadState<BlackboxStatus>; compact?: boolean }) {
  if (state.status !== 'ready') return <LoadStateView state={state} emptyTitle="HTTPS / TLS metrics unavailable" emptyBody="No configured HTTPS target has returned probe metrics." compact={compact} />
  if (!state.value.checks.length) return <EmptyState title="No HTTPS target metrics" body="Configure a target in blackbox/targets.yml and wait for a Prometheus scrape." compact={compact} />
  return <div className={`tls-detail ${compact ? 'tls-detail-compact' : ''}`}>
    {state.value.checks.map((check) => <article className="tls-target" key={check.target}>
      <div className="tls-target-heading"><strong>{check.targetName || 'HTTPS target'}</strong><span title={check.target}>{check.target}</span></div>
      <div className="tls-detail-row"><span>HTTPS availability</span>{check.success === undefined ? <span className="state-text unknown">No probe result</span> : <StatusBadge up={check.success} />}</div>
      <div className="tls-detail-row"><span>TLS certificate expiry</span>{check.certificateExpiry === undefined ? <span className="state-text unknown">{check.success === false ? 'Unavailable while probe fails' : 'No expiry metric'}</span> : <span className="certificate-date">{new Date(check.certificateExpiry * 1000).toLocaleString()} <small>({expiryDescription(check.certificateExpiry)})</small></span>}</div>
      {check.success === false && <div className="inline-alert">The HTTPS probe failed. Expiry alerts are evaluated only for successful probes; check target availability and probe output.</div>}
    </article>)}
  </div>
}

function AlertCard({ alert }: { alert: Alert }) {
  return <article className="alert-card">
    <div className="alert-card-accent" />
    <div className="alert-card-content">
      <div className="alert-card-top"><div className="alert-title-wrap"><span className={`severity-dot ${severityClass(alert.severity)}`} /><h2>{alert.name}</h2><StatusBadge state={alert.state} /></div><span className={`severity-label ${severityClass(alert.severity)}`}>{alert.severity}</span></div>
      <div className="alert-meta"><span>ACTIVE SINCE</span><strong>{alert.activeAt ? new Date(alert.activeAt).toLocaleString() : 'Timestamp unavailable'}</strong><span>INSTANCE</span><strong>{alert.labels.instance || alert.labels.job || 'Not provided'}</strong></div>
      <div className="alert-context-grid"><div><span className="panel-eyebrow">TRIGGERING CONDITION</span><p>{alert.summary || alert.description || alert.condition || `Prometheus has reported ${alert.name} as ${alert.state}; rule condition metadata is unavailable.`}</p>{alert.condition && <code className="alert-expression">{alert.condition}</code>}</div><div><span className="panel-eyebrow">RECOMMENDED RESPONSE</span><p>{recommendation(alert.name, alert.severity)}</p></div></div>
    </div>
  </article>
}

function LoadStateView<T>({ state, emptyTitle, emptyBody, compact = false }: { state: LoadState<T>; emptyTitle: string; emptyBody: string; compact?: boolean }) {
  if (state.status === 'loading') return <div className={`state-view ${compact ? 'compact-state' : ''}`}><span className="loader" /><span>Loading telemetry…</span></div>
  if (state.status === 'error') return <div className={`state-view error-state ${compact ? 'compact-state' : ''}`}><strong>{emptyTitle}</strong><span>{state.reason || emptyBody}</span><a href={grafanaUrl} target="_blank" rel="noreferrer" className="text-link">Open Grafana <span>↗</span></a></div>
  return <EmptyState title={emptyTitle} body={state.status === 'unavailable' ? state.reason : emptyBody} compact={compact} />
}

function EmptyState({ title, body, icon = '·', compact = false }: { title: string; body: string; icon?: string; compact?: boolean }) {
  return <div className={`empty-state ${compact ? 'compact-state' : ''}`}><span className="empty-state-icon">{icon}</span><strong>{title}</strong><p>{body}</p></div>
}

function StateValue<T>({ state, unavailable }: { state: LoadState<T>; unavailable: string }) {
  if (state.status === 'loading') return <div className="state-value muted">Loading…</div>
  if (state.status === 'error' || state.status === 'unavailable') return <div className="state-value muted">{unavailable}</div>
  return <div className="state-value">Conditions being evaluated continuously</div>
}

function StatusBadge({ up, state }: { up?: boolean; state?: string }) {
  if (state) {
    const active = ['firing', 'pending'].includes(state.toLowerCase())
    return <span className={`status-badge ${active ? 'badge-warn' : 'badge-neutral'}`}><span />{state}</span>
  }
  if (up === undefined) return <span className="status-badge badge-neutral"><span />NO DATA</span>
  return <span className={`status-badge ${up ? 'badge-up' : 'badge-down'}`}><span />{up ? 'UP' : 'DOWN'}</span>
}

function recommendation(name: string, severity: string) {
  if (name === 'FailedSSHLoginBurst') return 'Review authorized authentication logs and correlate the source address and account. Escalate repeated activity using your approved response procedure.'
  if (name === 'ExporterUnavailable') return 'Check the exporter health endpoint, service logs, and recent restarts. Restore metric collection before relying on downstream alert coverage.'
  if (name === 'TLSCertificateExpiryCritical' || name === 'TLSCertificateExpiryWarning') return 'Renew or replace the certificate before its expiry, then verify the served certificate chain and configured HTTPS endpoint.'
  if (name === 'HttpsProbeUnavailable' || name === 'BlackboxProbeTargetsMissing') return 'Check the configured target URL, DNS/network reachability, Blackbox Exporter health, and Prometheus target discovery. Certificate expiry cannot be confirmed while the probe is unavailable.'
  if (severity === 'critical') return 'Triage the affected target and validate the alert against current telemetry before taking an authorized containment action.'
  return 'Review the Prometheus rule annotations and affected target, then follow the relevant operational runbook.'
}

function severityClass(severity: string) {
  return severity.toLowerCase() === 'critical' ? 'critical' : severity.toLowerCase() === 'warning' ? 'warning' : 'informational'
}

function stateSummary<T>(state: LoadState<T>) {
  return state.status === 'loading' ? 'Loading telemetry…' : state.status === 'error' || state.status === 'unavailable' ? state.reason : 'No matching samples'
}

function jobLabel(job: string) {
  const labels: Record<string, string> = { 'sentinelpulse-exporter': 'Security exporter', prometheus: 'Prometheus', alertmanager: 'Alertmanager', grafana: 'Grafana' }
  return labels[job] || job
}

function formatNumber(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: value % 1 ? 1 : 0 }).format(value)
}

function daysUntil(epochSeconds: number) {
  return Math.ceil((epochSeconds * 1000 - Date.now()) / 86_400_000)
}

function expiryDescription(epochSeconds: number) {
  if (epochSeconds * 1000 <= Date.now()) {
    const daysAgo = Math.ceil((Date.now() - epochSeconds * 1000) / 86_400_000)
    return `expired ${daysAgo} day${daysAgo === 1 ? '' : 's'} ago`
  }
  const days = daysUntil(epochSeconds)
  return `expires in ${days} day${days === 1 ? '' : 's'}`
}

export default App
