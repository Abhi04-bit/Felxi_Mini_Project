# SentinelPulse demonstration checklist

Use a local development machine with Docker Compose, Python, Node.js/npm, and the project dependencies available. The walkthrough produces only synthetic events explicitly labelled `controlled_test`; it does not attempt logins. The default Blackbox target probes `https://example.com` once per minute; replace it with an endpoint you are authorized to monitor if appropriate.

## Live walkthrough

1. **Prepare configuration.** From the project root, create `.env` from `.env.example`, set a private `GRAFANA_ADMIN_PASSWORD`, and leave `ALERTMANAGER_WEBHOOK_URL` blank unless you have an authorized receiver. The default burst alert is 5 events in 5 minutes.

   ```powershell
   Copy-Item .env.example .env
   notepad .env
   ```

2. **Start and check services.**

   ```powershell
   docker compose up --build -d
   docker compose ps
   ```

   Allow at least two 15-second scrape intervals and one 1-minute HTTPS probe interval. Prometheus targets should show the exporter and monitoring services up; `blackbox-https` may take up to one minute to return its first result.

3. **Start the React interface** in another terminal.

   ```powershell
   Push-Location frontend
   npm install
   npm run dev
   ```

   Open `http://127.0.0.1:5173`. Grafana is at `http://127.0.0.1:3000`, Prometheus at `http://127.0.0.1:9090`, and Alertmanager at `http://127.0.0.1:9093`.

4. **View baseline metrics.** Open `http://127.0.0.1:9108/metrics` or query Prometheus:

   ```powershell
   curl.exe "http://127.0.0.1:9090/api/v1/query?query=failed_ssh_logins_total"
   curl.exe "http://127.0.0.1:9090/api/v1/query?query=probe_success%7Bjob%3D%22blackbox-https%22%7D"
   curl.exe "http://127.0.0.1:9090/api/v1/query?query=probe_ssl_earliest_cert_expiry%7Bjob%3D%22blackbox-https%22%7D"
   curl.exe "http://127.0.0.1:9090/api/v1/query?query=probe_duration_seconds%7Bjob%3D%22blackbox-https%22%7D"
   ```

5. **Submit five controlled events.** In PowerShell, assign the Python source to a variable, then pass that variable to Docker. This form avoids the nested-quote issue that can occur when Python source is written inline in a native Windows command.

   ```powershell
   $py = 'import json,urllib.request; data=json.dumps({"event":"failed_ssh_login","source":"controlled_test"}).encode(); req=urllib.request.Request("http://127.0.0.1:9108/test-event", data=data, headers={"Content-Type":"application/json"}, method="POST"); print([urllib.request.urlopen(req, timeout=3).status for _ in range(5)])'
   docker compose exec -T exporter python -c $py
   ```

   The requests originate inside the exporter container because `/test-event` intentionally accepts localhost callers only. Each successful request should return HTTP 202.

6. **Confirm the metric.** Wait for the next scrape, then query the labeled series:

   ```powershell
   curl.exe "http://127.0.0.1:9090/api/v1/query?query=failed_ssh_logins_total%7Bsource%3D%22controlled_test%22%7D"
   ```

   The counter should have increased by five for this run. Counters reset when the exporter process restarts; Prometheus range queries show increases over a time window, not individual event timestamps.

7. **Confirm the alert state and delivery boundary.** Allow a scrape and rule evaluation, then open `http://127.0.0.1:9090/api/v1/alerts` and `http://127.0.0.1:9093/api/v2/alerts`. With default settings and a clear 5-minute window, `FailedSSHLoginBurst` should enter `firing` in Prometheus and be visible to Alertmanager. This confirms alert evaluation and receipt, not notification delivery. No notification is sent by the default receiver.

8. **Show visualizations and response guidance.** Open the provisioned **SentinelPulse Security Overview** dashboard in Grafana. In React, show the Overview, Security Metrics, and Alert Center. The alert center displays the triggering condition and recommended response. Overview and Security Metrics show the HTTPS result, certificate date, and days remaining when those metrics are returned. A missing or failed probe is explicitly unavailable and is not shown as a healthy certificate.

9. **Finish cleanly.** Stop the Vite server with Ctrl+C, then stop the containers if the demonstration is over:

   ```powershell
   docker compose down
   ```

## Optional outage recovery demonstration

This temporarily interrupts metric collection. The rule has a one-minute pending period before `ExporterUnavailable` fires.

```powershell
docker compose stop exporter
Start-Sleep -Seconds 75
curl.exe "http://127.0.0.1:9090/api/v1/alerts"
curl.exe "http://127.0.0.1:9093/api/v2/alerts"
docker compose start exporter
Start-Sleep -Seconds 20
curl.exe "http://127.0.0.1:9090/api/v1/query?query=up%7Bjob%3D%22sentinelpulse-exporter%22%7D"
```

The expected recovery signal is `up=1` after the exporter returns and the `ExporterUnavailable` rule becomes inactive. Actual state depends on scrape/evaluation timing.

## Configuration validation

Run from the project root while the stack is up:

```powershell
docker compose config --quiet
docker compose exec -T prometheus promtool check config /etc/prometheus/prometheus.yml
docker compose exec -T prometheus promtool check rules /tmp/alerts.yml
docker compose exec -T prometheus promtool test rules /etc/prometheus/tls-alerts.test.yml
docker compose exec -T alertmanager amtool check-config /tmp/alertmanager.yml
Push-Location frontend
npm run build
Pop-Location
```

The TLS rule test uses synthetic time-series samples to exercise the 7-day critical, 14-day warning, failed-probe gating, failed scrape, and no-target conditions. It validates rule logic only; it is not evidence that the live demonstration certificate is near expiry or that a certificate-expiry alert fired.

## Safe failed-probe demonstration

To demonstrate failure handling, make a backup of `blackbox/targets.yml` and temporarily change its URL to `https://sentinelpulse-demo.invalid` (the reserved `.invalid` domain), with a label such as `target_name: controlled-failure`. Prometheus refreshes file discovery every 30 seconds; after the probe and configured `HTTPS_PROBE_FAILURE_FOR` duration, query `probe_success{job="blackbox-https"}` and `/api/v1/alerts`. Restore the original target file afterward. This tests failure reporting, not expiry; it makes no login attempt and does not weaken TLS verification.

For a malformed-input check, this returns HTTP 400 and asserts that the test route did not accept the body:

```powershell
$py = 'import http.client; c=http.client.HTTPConnection("127.0.0.1",9108,timeout=3); c.request("POST","/test-event",body=b"invalid",headers={"Content-Type":"application/json"}); r=c.getresponse(); print("invalid_status="+str(r.status)); assert r.status==400'
docker compose exec -T exporter python -c $py
```

## Evidence and honesty checklist

- Capture screenshots directly from the running application; do not create mock screenshots or replace empty panels with sample values.
- Record whether a screenshot shows Prometheus `firing`, Alertmanager receipt, or an actual receiver delivery. These are different states.
- If the alert is already firing, its state may not visibly transition when another event is sent. Wait for the configured range to clear or explain that the image shows an already-active alert.
- Do not report HTTPS/TLS verification unless Blackbox Exporter is configured and its probe metrics are present.
- Local checks demonstrate integration behavior in this environment only, not detection effectiveness, production readiness, or performance under load.
