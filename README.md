# SentinelPulse

**Security Metrics Monitoring and Early Warning System Using Prometheus and Grafana**

SentinelPulse is a cybersecurity monitoring project intended to collect security-relevant metrics, evaluate alert rules, visualize monitoring data, and provide actionable security recommendations.

## Problem statement

Security-relevant events can be difficult to notice when they are spread across logs and service health checks. SentinelPulse demonstrates how a small, local monitoring pipeline can expose selected signals, evaluate a configurable threshold, and present an alert with a response recommendation. It is an educational monitoring project, not a complete intrusion-detection or incident-response platform.

## Features

- Python exporter with a `failed_ssh_logins_total` counter and an explicitly labelled, localhost-only synthetic test endpoint.
- Optional Linux authentication-log tailing with basic rotation/truncation handling and read-health reporting.
- Prometheus scraping and configurable `FailedSSHLoginBurst` and `ExporterUnavailable` rules.
- Alertmanager routing with an optional environment-configured webhook receiver.
- Provisioned Grafana dashboard and a responsive React interface using live Prometheus data.
- Explicit missing-data states and a documented, deterministic project health-score heuristic.
- Docker Compose health checks and persistent Prometheus, Grafana, and Alertmanager data volumes.

## Implementation status

SentinelPulse includes the Python exporter, Docker Compose monitoring stack, Prometheus alert rules, provisioned Grafana dashboard, and React interface backed by Prometheus. The local integration path has been exercised with controlled test events, including the failed-login alert and exporter outage/recovery. See [the demonstration checklist](docs/DEMONSTRATION.md) for a repeatable walkthrough and [known limitations](#known-limitations) before presenting results.

## Architecture

- **Frontend:** React, Vite, TypeScript, Tailwind CSS, and Recharts for a security metrics dashboard.
- **Metrics exporter:** Python with `prometheus_client` to expose security-relevant metrics.
- **Monitoring:** Prometheus scrapes the exporter and evaluates alert rules.
- **Visualization:** Grafana is provisioned with Prometheus as a data source and project dashboards.
- **Notifications:** Alertmanager routes and groups Prometheus alerts.
- **HTTPS/TLS checks:** Blackbox Exporter probes configured HTTPS endpoints, verifies certificates, and exports availability, duration, and certificate-expiry metrics.
- **Local orchestration:** Docker Compose runs the services together.

See [the architecture diagram](docs/architecture.md) for the data flow between these components.

## Project structure

```text
.
├── frontend/                  # React/Vite/TypeScript dashboard
│   ├── src/                   # Overview, alerts, metrics, and system status views
│   ├── vite.config.ts         # Local Prometheus API proxy for development/preview
│   └── .env.example           # Non-secret local integration settings
├── exporter/
│   ├── exporter.py             # Prometheus metrics endpoint and optional Linux auth log tailer
│   ├── requirements.txt        # Exporter dependency
│   └── Dockerfile              # Minimal container image for Compose
├── docker-compose.yml         # Local exporter, Prometheus, Grafana, Alertmanager stack
├── prometheus/
│   ├── prometheus.yml          # Scrape, rules, and Alertmanager wiring
│   └── alerts.yml.template     # Environment-rendered Prometheus rules
├── alertmanager/
│   ├── alertmanager.yml        # Minimal route when no webhook is configured
│   └── webhook-template.yml    # Optional environment-rendered webhook receiver
├── grafana/
│   ├── dashboards/
│   │   └── sentinelpulse-security-overview.json
│   └── provisioning/
│       ├── datasources/       # Prometheus data source provisioning
│       └── dashboards/        # Dashboard provider provisioning
├── blackbox/
│   ├── blackbox.yml            # HTTPS probe module with certificate verification enabled
│   └── targets.yml             # File-discovered authorized HTTPS targets
└── docs/                      # Design and operational documentation
```

## Run the Python exporter

Requires Python 3.10 or newer.

```powershell
cd exporter
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python exporter.py
```

The exporter listens on `127.0.0.1:9108` by default. Configure it with `--host`, `--port`, `--auth-log`, and `--poll-seconds`, or use `SENTINELPULSE_HOST`, `SENTINELPULSE_PORT`, `SENTINELPULSE_AUTH_LOG`, and `SENTINELPULSE_POLL_SECONDS`. Keep the default loopback bind unless remote Prometheus scraping is deliberately configured with appropriate network controls.

Endpoints:

- `GET /metrics` — Prometheus exposition, including `failed_ssh_logins_total{source="controlled_test"}` and `failed_ssh_logins_total{source="auth_log"}` series.
- `GET /healthz` — basic process health check.
- `POST /test-event` — increments the counter for one explicit synthetic event. This endpoint accepts requests only from localhost, regardless of the configured bind address.

To add exactly one controlled test event from another terminal:

```powershell
curl.exe -i -X POST http://127.0.0.1:9108/test-event `
  -H "Content-Type: application/json" `
  --data '{"event":"failed_ssh_login","source":"controlled_test"}'
curl.exe http://127.0.0.1:9108/metrics
```

Requests with an invalid path, content type, body, or payload return an HTTP 4xx response and do not change the counter. The exporter does not inspect credentials or initiate login attempts.

### Optional Linux authentication log input

For authorized local monitoring, pass an existing readable log file, for example `python exporter.py --auth-log /var/log/auth.log` (some distributions use `/var/log/secure`). The tailer recognizes OpenSSH `Failed password for ... from ... port ... ssh2` records, starts at the current end of the file, and tracks the byte offset and file identity to avoid replaying records on ordinary polls. It handles rotation/truncation by resuming at the new file's end. Missing or unreadable files do not stop the HTTP exporter; `sentinelpulse_auth_log_read_ok` is `0` while the configured log cannot be read and `1` when readable. Do not grant broader log access than needed.

## Run the monitoring stack

Requires Docker Engine with the Docker Compose v2 plugin. From the project root, create a local environment file and set a private Grafana password:

```powershell
Copy-Item .env.example .env
notepad .env
docker compose up --build -d
docker compose ps
```

Do not commit `.env`. The checked-in `.env.example` contains a blank Grafana password; Compose will refuse to start Grafana until you set one. Prometheus, Grafana, Alertmanager, and the exporter are bound to loopback on the host:

| Service | Local URL | Notes |
| --- | --- | --- |
| Grafana | [http://localhost:3000](http://localhost:3000) | User/password from `GRAFANA_ADMIN_USER` and `GRAFANA_ADMIN_PASSWORD`; Prometheus data source is provisioned. |
| Prometheus | [http://localhost:9090](http://localhost:9090) | Targets, queries, and active alert state. |
| Alertmanager | [http://localhost:9093](http://localhost:9093) | Alert groups and notification status. |
| Exporter | [http://localhost:9108/metrics](http://localhost:9108/metrics) | Local metrics endpoint and controlled test-event endpoint. |
| Blackbox Exporter | [http://localhost:9115](http://localhost:9115) | Local probe UI and exporter health; Prometheus uses its internal Compose address. |

The named volumes `prometheus_data`, `grafana_data`, and `alertmanager_data` retain their service data across container restarts. `docker compose down` preserves them; `docker compose down -v` deletes them.

### Environment variables

Keep local secrets in the root `.env` file, which is excluded by `.gitignore`. The checked-in `.env.example` is a template. Do not paste secrets into frontend `VITE_*` variables; browser-visible build variables are not secret storage.

| Variable | Purpose |
| --- | --- |
| `GRAFANA_ADMIN_USER` | Grafana local administrator name; defaults to `admin`. |
| `GRAFANA_ADMIN_PASSWORD` | Required local Grafana administrator password; set it in `.env`. |
| `SSH_FAILURE_THRESHOLD` | Positive integer event threshold; defaults to `5`. |
| `SSH_FAILURE_WINDOW` | Prometheus range duration, such as `5m`; defaults to `5m`. |
| `TLS_CERT_WARNING_DAYS` | Days until expiry for warning alert; defaults to `14`. |
| `TLS_CERT_CRITICAL_DAYS` | Days until expiry for critical alert; defaults to `7` and must be less than the warning threshold. |
| `HTTPS_PROBE_FAILURE_FOR` | Duration a target failure must persist; defaults to `2m`. |
| `ALERTMANAGER_WEBHOOK_URL` | Optional authorized webhook endpoint; blank means no notification integration. |
| `SENTINELPULSE_HOST`, `SENTINELPULSE_PORT` | Host and port for running the exporter directly; defaults to `127.0.0.1` and `9108`. |
| `SENTINELPULSE_AUTH_LOG`, `SENTINELPULSE_POLL_SECONDS` | Optional auth-log path and polling interval for direct exporter runs. |
| `VITE_PROMETHEUS_PROXY_TARGET` | Prometheus address used by the Vite development/preview proxy. |
| `VITE_GRAFANA_URL` | Local Grafana link shown in React. |

### Grafana dashboard

Grafana provisions **SentinelPulse Security Overview** in the **SentinelPulse** folder from `grafana/dashboards/sentinelpulse-security-overview.json`. The dashboard uses Prometheus data source UID `prometheus`, refreshes every 30 seconds, and includes Grafana's time-range selector (default: last 6 hours).

| Panel | Prometheus query / verification |
| --- | --- |
| Failed SSH logins · selected range | `sum(increase(failed_ssh_logins_total[$__range]))`; compare with the exporter metric and Prometheus query after a controlled event. |
| Failed-login trend | `sum(increase(failed_ssh_logins_total[$__rate_interval]))`; after a test event, a trend point should appear in the selected time range. |
| Exporter & monitoring availability | `up` for exporter, Prometheus, Alertmanager, and Grafana scrape jobs; `1` is UP, `0` is DOWN. Allow at least one scrape interval after startup. |
| Active alert states | `ALERTS{alertstate=~"pending|firing"}`; remains empty until an alert is pending or firing. |
| HTTPS probe status | `probe_success{job="blackbox-https"}`; `1` means the HTTPS and verified TLS probe succeeded, `0` means it failed. |
| TLS certificate expiry countdown | `(probe_ssl_earliest_cert_expiry{job="blackbox-https"} - time()) / 86400`, matched only with a successful probe. Shows days remaining. |
| TLS certificate expiry date | `probe_ssl_earliest_cert_expiry{job="blackbox-https"} * 1000`, matched only with a successful probe and rendered as an ISO date/time. |

If a series has not been scraped, panels display a no-data value or Grafana's empty/query-error state rather than substituting sample metrics. An empty alert table means no active alert series has been returned; it does not imply notification delivery. TLS panels omit expiry data for failed probes so a missing or invalid HTTPS probe is not presented as a healthy certificate.

### Configure HTTPS targets

`blackbox/targets.yml` is Prometheus file-based service discovery. It includes `https://example.com` as a public demonstration endpoint; replace it with one or more HTTPS endpoints you are authorized to monitor. Each target group can include a `target_name` label for readable legends. Prometheus rereads this file every 30 seconds. The probe uses the `https_cert_expiry` module and keeps TLS certificate verification enabled (`insecure_skip_verify: false`). No credentials are configured or required for the demonstration target.

Prometheus scrapes the Blackbox Exporter itself as `blackbox-exporter`, and probes targets using the standard multi-target pattern at `/probe` under job `blackbox-https`. Each target is checked once per minute by default.

### Alert rules

Prometheus loads rules from `prometheus/alerts.yml.template`. At container startup, Compose validates and substitutes the configured thresholds. `FailedSSHLoginBurst` defaults to 5 events in 5 minutes; `ExporterUnavailable` fires after one minute. TLS rules default to a 14-day warning and 7-day critical threshold. The warning rule excludes certificates already inside the critical window. Both expiry alerts require `probe_success == 1`; failed or missing probes instead trigger `HttpsProbeUnavailable` (after 2 minutes), and an absent target series triggers `BlackboxProbeTargetsMissing`. Probe unavailability is a warning; expiry within 7 days is critical. This prevents a failed handshake from being misrepresented as a certificate-expiry alert.

To safely exercise the burst alert, edit `.env` to `SSH_FAILURE_THRESHOLD=1` and `SSH_FAILURE_WINDOW=5m`, then restart the stack with `docker compose up --build -d`. After the containers are healthy, submit one synthetic test event:

```powershell
$py = 'import json,urllib.request; data=json.dumps({"event":"failed_ssh_login","source":"controlled_test"}).encode(); req=urllib.request.Request("http://127.0.0.1:9108/test-event", data=data, headers={"Content-Type":"application/json"}, method="POST"); print(urllib.request.urlopen(req, timeout=3).status)'
docker compose exec -T exporter python -c $py
curl.exe "http://127.0.0.1:9090/api/v1/query?query=failed_ssh_logins_total"
curl.exe http://127.0.0.1:9090/api/v1/alerts
```

In PowerShell, assign the Python program to `$py` first and pass the variable as shown. This avoids native-command quoting issues. The event is sent from inside the exporter container so the endpoint's localhost-only restriction remains in effect. Allow up to about 30 seconds for a scrape and rule evaluation. In `/api/v1/alerts`, confirm `FailedSSHLoginBurst` has `state` equal to `firing`; the metric appearing in a query confirms scraping. An alert in `firing` means Prometheus evaluated the condition. It does **not** mean Alertmanager delivered a notification.

### Optional notification delivery

By default, Alertmanager has a valid `default` route but no notification integration. If you have an authorized webhook receiver, set `ALERTMANAGER_WEBHOOK_URL` in the untracked `.env` file and recreate the Alertmanager service with `docker compose up -d --force-recreate alertmanager`. The URL is supplied to the container through the environment and rendered into its runtime configuration; do not put it in committed files. Trigger a test alert as above, wait for the configured 10-second group wait, then verify receipt at the webhook and inspect `docker compose logs alertmanager` for delivery errors. Without a configured receiver, alerts are visible in Prometheus and Alertmanager but no notification is sent.

## Stop services

```powershell
docker compose down
```

## React security operations interface

The Phase 5 React interface reads real data from Prometheus through the Vite development/preview server proxy. Start the monitoring stack as described above, then in a second terminal:

```powershell
cd frontend
npm install
Copy-Item .env.example .env.local
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The proxy forwards `/api/prometheus/*` to `VITE_PROMETHEUS_PROXY_TARGET` (default `http://127.0.0.1:9090`) without putting a Prometheus URL or credentials into browser code. If Prometheus runs elsewhere, set that variable in `frontend/.env.local` and restart Vite. `VITE_GRAFANA_URL` controls the Grafana link and defaults to `http://localhost:3000`. These settings are addresses, never secrets. Keep Prometheus bound to localhost for this local-only setup.

The production build is generated with `npm run build`; `npm run preview` serves it locally with the same proxy. A production deployment must place the static app behind a same-origin reverse proxy for `/api/prometheus` to an authorized Prometheus endpoint. Do not expose an unauthenticated Prometheus server to the public internet.

### Frontend telemetry and score behavior

- Overview, Security Metrics, Alert Center, and System Status query actual Prometheus data: the `failed_ssh_logins_total` series, its range increases, `up{job=...}` scrape states, and `/api/v1/alerts`.
- Refresh runs automatically every 30 seconds; the time selector changes the Prometheus query range. Prometheus API failures and missing metric series are shown as unavailable/error states, not as healthy or zero. The exporter provides aggregate counters only, so the event-detail area explicitly explains that individual recent events are not available.
- HTTPS availability and per-target certificate expiry are queried from `blackbox-https`. A failed target shows its probe failure and unavailable expiry; absent probe metrics show a clear unavailable/error state.
- The 0–100 health score is a SentinelPulse heuristic, not an industry-standard rating. Weighted health uses exporter availability (40%), other monitoring targets (20%), active alert exposure (25%), and failed-login activity (15%). Alert penalty is 100% per critical, 40% per warning, 10% per info alert (capped); failed-login activity loses 10% per event over the selected range (capped). It normalizes over observed groups only; missing groups reduce the displayed coverage and are not treated as healthy. If no groups are available, the score is unavailable.
- Grafana opens at the configured local `VITE_GRAFANA_URL`. No credentials or notification secrets are used by the frontend.

### Integration verification

With Docker Compose and Vite running, allow at least two 15-second Prometheus scrape intervals, then open the dashboard. The System Status page should show the exporter and monitoring jobs as targets; Security Metrics should show the counter trend once Prometheus has enough samples. To verify an actual controlled event, use the existing exporter test procedure above and refresh or wait for the next dashboard poll. The selected-range total and trend are derived from Prometheus `increase()` queries. For API troubleshooting, check [Prometheus targets](http://localhost:9090/targets) and the browser Network panel for `/api/prometheus/api/v1/*` responses.

The local pipeline has been verified with Docker Compose, Prometheus, Grafana, Alertmanager, and the Vite development server. In one controlled run, five synthetic events crossed the configured burst threshold, the metric increased, Prometheus entered firing, and Alertmanager showed the alert active. Stopping the exporter caused `ExporterUnavailable` to fire; restarting it restored the scrape and resolved that alert. A production build and the Prometheus/Alertmanager configuration validators also completed successfully. Notification delivery was not tested because no webhook receiver is configured. These checks are local integration results, not a security-effectiveness or performance assessment.

## Troubleshooting

- **Compose reports a service unhealthy:** check `docker compose ps` and `docker compose logs <service>`. Validate the rendered Compose file with `docker compose config --quiet`; Prometheus and Alertmanager validators are listed in [the demonstration checklist](docs/DEMONSTRATION.md).
- **Prometheus has no exporter series:** wait two scrape intervals (30 seconds by default), check [Prometheus targets](http://localhost:9090/targets), and verify [the exporter metrics endpoint](http://localhost:9108/metrics).
- **The test endpoint returns HTTP 403:** send the request from inside the exporter container as documented above. The endpoint intentionally accepts only loopback callers.
- **The burst alert does not fire:** check the loaded rule at `http://localhost:9090/api/v1/rules?type=alert`, confirm `SSH_FAILURE_THRESHOLD` and `SSH_FAILURE_WINDOW` in `.env`, recreate Prometheus after changing them, and allow a scrape plus an evaluation interval.
- **Grafana panels are empty:** check the provisioned Prometheus data source health and allow a scrape. Empty or unavailable telemetry should not be interpreted as a healthy signal.
- **React cannot reach Prometheus:** keep Prometheus running and check the Vite proxy target in `frontend/.env.local`; restart Vite after changing it. The browser should request `/api/prometheus/api/v1/...` from the local Vite server.
- **Alert is firing but no notification arrives:** the default Alertmanager receiver has no delivery integration. Configure an authorized webhook using the local `.env` variable and separately verify receipt at that endpoint.

## Testing

Follow the [demonstration and validation checklist](docs/DEMONSTRATION.md) for commands to start the stack, run Prometheus and Alertmanager validators, build the frontend, submit controlled test events, verify alert state and recovery, and reject malformed input. Run only the synthetic test endpoint for the demo; it does not generate authentication attempts. The local integration observations described above are not performance measurements or proof of security effectiveness.

## Known limitations

- This is a local demonstration stack; host ports bind to loopback and no production deployment or hardening is provided.
- The default Alertmanager route has no notification channel. A firing alert alone does not establish notification delivery.
- The configured HTTPS demonstration target requires outbound network and DNS access from the Blackbox Exporter container. Replace it with an authorized target appropriate to the environment. If probes fail or no targets are discovered, certificate expiry is unavailable rather than treated as healthy.
- Linux authentication-log collection is optional and depends on an explicitly supplied readable log path. Its parsing behavior has not been validated across Linux distributions in this environment.
- The exporter provides aggregated counters, not individual event records, source attribution beyond the metric label, or forensic history.
- The React health score is a documented project heuristic, not an industry-standard rating or a measure of overall security effectiveness.
- Local integration checks do not establish production reliability, detection quality, or performance under load.

## Project documentation

- [Architecture diagram](docs/architecture.md)
- [Demonstration and validation checklist](docs/DEMONSTRATION.md)
- [Viva questions and answers](docs/VIVA_PREPARATION.md)
- [Final submission checklist](docs/FINAL_SUBMISSION_CHECKLIST.md)
