# SentinelPulse viva preparation

1. **What problem does SentinelPulse address?**  
   It demonstrates collection of security-relevant telemetry, threshold alerting, monitoring visibility, and response guidance using an open-source metrics stack.

2. **What is Prometheus?**  
   Prometheus is a time-series monitoring system that scrapes targets, stores labeled samples, evaluates rules, and exposes a query API.

3. **What does the Python exporter do?**  
   It exposes the `failed_ssh_logins_total` counter and health signals in Prometheus exposition format. It can optionally tail an explicitly configured Linux authentication log.

4. **What is an exporter?**  
   An exporter makes measurements available in a format a monitoring system can collect. This project’s custom Python process is the exporter; it does not initiate login attempts.

5. **Why does Prometheus scrape instead of requiring the exporter to push?**  
   Scraping lets Prometheus control collection intervals, attach target labels, and determine target availability from scrape success.

6. **What is a Prometheus counter?**  
   A counter is a cumulative value that only increases during a process lifetime, except when the process restarts and the counter resets. Use functions such as `increase()` to estimate change over a time range.

7. **What is a metric label?**  
   A label is a key/value dimension on a time series. SentinelPulse uses `source` to distinguish `controlled_test` events from `auth_log` events.

8. **What does PromQL do?**  
   PromQL selects and aggregates time series and calculates values over time. For example, `sum(increase(failed_ssh_logins_total[5m]))` estimates total failed-login counter increases across sources during five minutes.

9. **How is `FailedSSHLoginBurst` triggered?**  
   Prometheus evaluates whether the sum of counter increases reaches the configurable threshold within the configured time window. The default is 5 events in 5 minutes.

10. **What is `ExporterUnavailable` checking?**  
    It checks whether the Prometheus scrape series for the exporter has value 0. It uses a one-minute `for` period to avoid alerting on a single brief scrape failure.

11. **What is Grafana’s role?**  
    Grafana queries Prometheus as a data source and renders the provisioned dashboard. It visualizes metrics; it does not collect the exporter’s metrics itself.

12. **What is Alertmanager’s role?**  
    It receives Prometheus alerts, groups and routes them, and can deliver notifications through configured receivers. The default SentinelPulse configuration has no notification integration.

13. **Does a firing Prometheus alert mean someone received a notification?**  
    No. Firing means the rule condition matched. Alertmanager receipt and external notification delivery must each be verified separately.

14. **How does TLS certificate monitoring fit into the architecture?**  
    Blackbox Exporter probes HTTPS targets listed in `blackbox/targets.yml` and exposes probe success, duration, and earliest certificate expiry. TLS verification remains enabled. If a probe fails, the interface reports the failure and expiry alerts are gated off.

15. **What can cause false positives?**  
    Legitimate users mistyping passwords, misconfigured automation, noisy logs, or an unsuitable threshold/window can trigger a burst alert. Threshold tuning and authorized context review are needed.

16. **What does the Security Health Score mean?**  
    It is a deterministic SentinelPulse heuristic weighted across exporter availability, other monitoring targets, active alert exposure, and failed-login activity. Missing signal groups lower coverage and are not treated as healthy. It is not an industry-standard security rating.

17. **Why track availability as well as security events?**  
    A missing exporter can create blind spots. Availability metrics help distinguish “no observed events” from “the telemetry source is not being collected.”

18. **Why is the controlled test endpoint restricted to localhost?**  
    It changes a security counter for demonstration purposes. Restricting it to loopback reduces the chance that remote callers can inject synthetic events; it accepts only a fixed, clearly labeled payload.

19. **What are the main limitations?**  
    The stack is local and not production hardened; notification delivery is unconfigured; HTTPS probing depends on outbound network and target availability; the exporter exposes aggregate counts rather than forensic event records; Linux auth-log behavior depends on host paths and permissions.

20. **What would be reasonable future improvements?**  
    Add authenticated, managed notification receivers; add TLS alert tests against a controlled HTTPS certificate; add tests for log rotation and platform-specific parsing; improve event context with privacy controls; and deploy behind TLS, access control, retention, and operational monitoring.
