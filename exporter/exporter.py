"""SentinelPulse security metrics exporter."""

from __future__ import annotations

import argparse
import json
import os
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from prometheus_client import CollectorRegistry, Counter, Gauge, generate_latest
from prometheus_client.exposition import CONTENT_TYPE_LATEST

FAILED_SSH_PATTERN = re.compile(
    r"Failed password for (?:invalid user )?\S+ from \S+ port \d+ ssh2"
)
REGISTRY = CollectorRegistry()
FAILED_SSH_LOGINS = Counter(
    "failed_ssh_logins_total",
    "Failed SSH login events observed by SentinelPulse.",
    ["source"],
    registry=REGISTRY,
)
# Keep both documented series visible at zero before their first event.
FAILED_SSH_LOGINS.labels(source="controlled_test")
FAILED_SSH_LOGINS.labels(source="auth_log")
EXPORTER_UP = Gauge(
    "sentinelpulse_exporter_up", "Whether the exporter process is running.", registry=REGISTRY
)
AUTH_LOG_READ_OK = Gauge(
    "sentinelpulse_auth_log_read_ok",
    "Whether the configured authentication log was readable on the last poll.",
    registry=REGISTRY,
)


class AuthLogTailer:
    """Count only newly appended SSH failure records; do not replay old records."""

    def __init__(self, path: Path):
        self.path = path
        self.identity: tuple[int, int] | None = None
        self.offset = 0
        self.initialized = False

    def poll(self) -> None:
        try:
            stat = self.path.stat()
            identity = (stat.st_dev, stat.st_ino)
            if not self.initialized or identity != self.identity or stat.st_size < self.offset:
                # Start at EOF when first discovered or rotated/truncated to avoid
                # replaying historical records.
                self.identity, self.offset, self.initialized = identity, stat.st_size, True
                AUTH_LOG_READ_OK.set(1)
                return
            with self.path.open("r", encoding="utf-8", errors="replace") as log_file:
                log_file.seek(self.offset)
                for line in log_file:
                    if FAILED_SSH_PATTERN.search(line):
                        FAILED_SSH_LOGINS.labels(source="auth_log").inc()
                self.offset = log_file.tell()
            AUTH_LOG_READ_OK.set(1)
        except (FileNotFoundError, PermissionError, OSError):
            AUTH_LOG_READ_OK.set(0)


class SentinelPulseServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


class RequestHandler(BaseHTTPRequestHandler):
    server_version = "SentinelPulseExporter/1.0"

    def do_GET(self) -> None:
        if self.path == "/metrics":
            payload = generate_latest(REGISTRY)
            self.send_response(200)
            self.send_header("Content-Type", CONTENT_TYPE_LATEST)
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        elif self.path == "/healthz":
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write(b"ok\n")
        else:
            self.send_error(404, "Not found")

    def do_POST(self) -> None:
        if self.path != "/test-event":
            self.send_error(404, "Not found")
            return
        if self.client_address[0] not in {"127.0.0.1", "::1"}:
            self.send_error(403, "Test events are restricted to localhost")
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 1 <= length <= 1024:
                raise ValueError("request body must be between 1 and 1024 bytes")
            if self.headers.get_content_type() != "application/json":
                raise ValueError("expected application/json")
            payload = json.loads(self.rfile.read(length))
            if payload != {"event": "failed_ssh_login", "source": "controlled_test"}:
                raise ValueError("unsupported test event payload")
        except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            self.send_error(400, f"Invalid test event: {exc}")
            return
        FAILED_SSH_LOGINS.labels(source="controlled_test").inc()
        self.send_response(202)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.end_headers()
        self.wfile.write(b"controlled test event recorded\n")

    def log_message(self, fmt: str, *args: object) -> None:
        print(f"[{self.log_date_time_string()}] {fmt % args}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="SentinelPulse security metrics exporter")
    parser.add_argument("--host", default=os.getenv("SENTINELPULSE_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.getenv("SENTINELPULSE_PORT", "9108")))
    parser.add_argument(
        "--auth-log", type=Path, default=os.getenv("SENTINELPULSE_AUTH_LOG"),
        help="Optional Linux auth log path, such as /var/log/auth.log or /var/log/secure",
    )
    parser.add_argument(
        "--poll-seconds", type=float,
        default=float(os.getenv("SENTINELPULSE_POLL_SECONDS", "2")),
    )
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("--port must be between 1 and 65535")
    if args.poll_seconds <= 0:
        parser.error("--poll-seconds must be greater than zero")
    return args


def main() -> None:
    args = parse_args()
    EXPORTER_UP.set(1)
    AUTH_LOG_READ_OK.set(0 if args.auth_log else 1)
    if args.auth_log:
        tailer = AuthLogTailer(args.auth_log)

        def poll_auth_log() -> None:
            while True:
                tailer.poll()
                time.sleep(args.poll_seconds)

        threading.Thread(target=poll_auth_log, daemon=True, name="auth-log-tailer").start()

    server = SentinelPulseServer((args.host, args.port), RequestHandler)
    print(f"SentinelPulse exporter listening on http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Shutting down SentinelPulse exporter")
    finally:
        EXPORTER_UP.set(0)
        server.server_close()


if __name__ == "__main__":
    main()
