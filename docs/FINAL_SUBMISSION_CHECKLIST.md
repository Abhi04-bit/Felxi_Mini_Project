# Final submission checklist

Use this list to assemble a truthful submission from the current project. Items marked “capture/create” are not included artifacts unless you add them yourself from your actual run.

## Project files to include

- [x] `README.md` with objective, architecture, setup, testing, troubleshooting, and limitations.
- [x] `docker-compose.yml` and `.env.example` (provide the template, never a populated `.env`).
- [x] Python exporter: `exporter/exporter.py`, `exporter/requirements.txt`, and `exporter/Dockerfile`.
- [x] Prometheus scrape configuration and alert rules: `prometheus/prometheus.yml` and `prometheus/alerts.yml.template`.
- [x] Alertmanager routing configuration and webhook template: `alertmanager/alertmanager.yml` and `alertmanager/webhook-template.yml`.
- [x] Blackbox probe module and file-discovered HTTPS targets: `blackbox/blackbox.yml` and `blackbox/targets.yml`.
- [x] TLS expiry/probe alert rules and synthetic promtool rule cases: `prometheus/alerts.yml.template` and `prometheus/tls-alerts.test.yml`.
- [x] Grafana provisioning and dashboard JSON under `grafana/provisioning/` and `grafana/dashboards/`.
- [x] React/Vite/TypeScript/Tailwind source and package manifests under `frontend/`.
- [x] Architecture diagram source: `docs/architecture.md` (Mermaid).
- [x] Demonstration checklist and viva preparation under `docs/`.
- [ ] Confirm the final archive/source control selection excludes `.env`, credentials, runtime data, `node_modules`, and build output.

## Demonstration evidence to capture

- [ ] Capture a genuine screenshot of the React Overview with live telemetry and visible signal coverage.
- [ ] Capture the Grafana provisioned dashboard with actual Prometheus-backed values.
- [ ] Capture the Prometheus `FailedSSHLoginBurst` firing state after controlled events.
- [ ] Capture Alertmanager showing the received alert. Label it as receipt, not delivery.
- [ ] If and only if a notification receiver is configured, capture evidence from that receiver that proves delivery.
- [ ] Optionally capture the exporter outage/recovery state and `up` returning to 1.
- [ ] Do not include a TLS success screenshot unless Blackbox probes are actually configured and returning data.
- [ ] Capture the TLS panels only when the configured HTTPS probe returns real metrics; record the target used.

## Report materials to prepare

- [ ] Create the required report using the institution’s format: abstract/objective, problem statement, architecture, implementation, validation method and observed results, limitations, and conclusion.
- [ ] Add the architecture diagram and the real screenshots listed above.
- [ ] State the test environment and configuration used (including threshold/window) so results can be reproduced.
- [ ] Distinguish Prometheus firing, Alertmanager receipt, and notification delivery in the results section.
- [ ] Describe the Security Health Score as a project heuristic, not a validated or industry-standard rating.
- [ ] Include only measured observations; do not invent performance results or security-effectiveness claims.

## Final safety and reproducibility checks

- [ ] Start from the documented setup on the submission machine and verify `docker compose ps`.
- [ ] Run the validators and frontend build from `docs/DEMONSTRATION.md`.
- [ ] Reproduce the controlled test event and confirm its labeled counter in Prometheus.
- [ ] Check the dashboard time range and alert state before taking screenshots.
- [ ] Confirm local secrets are supplied separately and are not present in screenshots, archives, or source control.
