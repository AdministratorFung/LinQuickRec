#!/usr/bin/env python3
"""Mock perf-collector backend for WebUI testing.

Serves all REST API endpoints that perf-webui expects, with realistic-looking
mock data.  No external dependencies -- Python stdlib only.

Usage:
    python3 mock_server.py [--port 8080]
"""

import json
import random
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

# ============================================================
# Stage definitions (matches perf.js CALL_TREE)
# ============================================================

STAGES = [
    {"service": "proxy", "stage": "proxy_e2e", "count": 1523},
    {"service": "proxy", "stage": "feature_rpc", "count": 1523},
    {"service": "feature", "stage": "feature_total", "count": 1523},
    {"service": "feature", "stage": "generate_user_logs", "count": 1523},
    {"service": "proxy", "stage": "recall_rpc", "count": 1523},
    {"service": "recall", "stage": "recall_total", "count": 1523},
    {"service": "recall", "stage": "vllm_rpc", "count": 1523},
    {"service": "proxy", "stage": "precalc_rpc", "count": 1523},
    {"service": "precalc", "stage": "precalc_total", "count": 1523},
    {"service": "proxy", "stage": "rank_rpc", "count": 1523},
    {"service": "rank_master", "stage": "rank_master_total", "count": 1523},
    {"service": "rank_sub", "stage": "rank_sub_total", "count": 1523},
    {"service": "proxy", "stage": "recall_precalc_parallel_wait", "count": 1523},
]

CALL_TREE = [
    {"service": "proxy", "stage": "proxy_e2e", "children": [
        {"service": "proxy", "stage": "feature_rpc", "children": [
            {"service": "feature", "stage": "feature_total", "children": [
                {"service": "feature", "stage": "generate_user_logs"}
            ]}
        ]},
        {"service": "proxy", "stage": "recall_rpc", "children": [
            {"service": "recall", "stage": "recall_total", "children": [
                {"service": "recall", "stage": "vllm_rpc"}
            ]}
        ]},
        {"service": "proxy", "stage": "precalc_rpc", "children": [
            {"service": "precalc", "stage": "precalc_total"}
        ]},
        {"service": "proxy", "stage": "rank_rpc", "children": [
            {"service": "rank_master", "stage": "rank_master_total", "children": [
                {"service": "rank_sub", "stage": "rank_sub_total"}
            ]}
        ]},
        {"service": "proxy", "stage": "recall_precalc_parallel_wait"}
    ]}
]

BASE_STATS = {
    "proxy|proxy_e2e":                     {"avg": 52.3, "stddev": 18.5, "min": 12.1, "max": 156.7, "count": 1523},
    "proxy|feature_rpc":                    {"avg": 28.5, "stddev":  8.2, "min":  5.0, "max":  65.0, "count": 1523},
    "feature|feature_total":                {"avg": 25.3, "stddev":  7.5, "min":  4.0, "max":  58.0, "count": 1523},
    "feature|generate_user_logs":           {"avg": 12.1, "stddev":  3.8, "min":  2.0, "max":  28.0, "count": 1523},
    "proxy|recall_rpc":                     {"avg": 45.0, "stddev": 15.0, "min":  8.0, "max": 120.0, "count": 1523},
    "recall|recall_total":                   {"avg": 42.0, "stddev": 14.0, "min":  7.0, "max": 110.0, "count": 1523},
    "recall|vllm_rpc":                      {"avg": 35.0, "stddev": 12.0, "min":  5.0, "max":  95.0, "count": 1523},
    "proxy|precalc_rpc":                    {"avg": 30.0, "stddev": 10.0, "min":  6.0, "max":  75.0, "count": 1523},
    "precalc|precalc_total":                {"avg": 28.0, "stddev":  9.5, "min":  5.0, "max":  70.0, "count": 1523},
    "proxy|rank_rpc":                       {"avg": 22.0, "stddev":  6.5, "min":  4.0, "max":  55.0, "count": 1523},
    "rank_master|rank_master_total":        {"avg": 20.0, "stddev":  6.0, "min":  3.0, "max":  50.0, "count": 1523},
    "rank_sub|rank_sub_total":              {"avg": 15.0, "stddev":  4.5, "min":  2.0, "max":  38.0, "count": 1523},
    "proxy|recall_precalc_parallel_wait":   {"avg": 45.0, "stddev": 14.0, "min": 8.0, "max": 110.0, "count": 1523},
}

DEFAULT_STATS = {"avg": 30.0, "stddev": 10.0, "min": 5.0, "max": 80.0, "count": 1000}

# ============================================================
# Sample traces
# ============================================================

_now_us = int(time.time() * 1_000_000)

TRACES = [
    {"trace_id": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6", "ts_us": _now_us,              "span_count": 13, "total_duration_ms": 80.2},
    {"trace_id": "b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7", "ts_us": _now_us -  5_000_000, "span_count": 13, "total_duration_ms": 75.5},
    {"trace_id": "c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8", "ts_us": _now_us - 10_000_000, "span_count": 13, "total_duration_ms": 92.3},
    {"trace_id": "d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9", "ts_us": _now_us - 15_000_000, "span_count": 13, "total_duration_ms": 68.8},
    {"trace_id": "e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0", "ts_us": _now_us - 20_000_000, "span_count": 13, "total_duration_ms": 105.5},
    {"trace_id": "f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1", "ts_us": _now_us - 25_000_000, "span_count": 13, "total_duration_ms": 55.1},
    {"trace_id": "a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2", "ts_us": _now_us - 30_000_000, "span_count": 13, "total_duration_ms": 61.7},
    {"trace_id": "b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3", "ts_us": _now_us - 35_000_000, "span_count": 13, "total_duration_ms": 98.4},
    {"trace_id": "c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4", "ts_us": _now_us - 40_000_000, "span_count": 13, "total_duration_ms": 42.9},
    {"trace_id": "d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5", "ts_us": _now_us - 45_000_000, "span_count": 13, "total_duration_ms": 73.6},
    {"trace_id": "e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6", "ts_us": _now_us - 50_000_000, "span_count": 13, "total_duration_ms": 88.1},
    {"trace_id": "f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7", "ts_us": _now_us - 55_000_000, "span_count": 13, "total_duration_ms": 51.3},
    {"trace_id": "a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8", "ts_us": _now_us - 60_000_000, "span_count": 13, "total_duration_ms": 69.0},
    {"trace_id": "b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9", "ts_us": _now_us - 65_000_000, "span_count": 13, "total_duration_ms": 112.3},
    {"trace_id": "c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0", "ts_us": _now_us - 70_000_000, "span_count": 13, "total_duration_ms": 46.8},
    {"trace_id": "d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1", "ts_us": _now_us - 75_000_000, "span_count": 13, "total_duration_ms": 57.9},
    {"trace_id": "e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2", "ts_us": _now_us - 80_000_000, "span_count": 13, "total_duration_ms": 84.7},
    {"trace_id": "f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3", "ts_us": _now_us - 85_000_000, "span_count": 13, "total_duration_ms": 39.2},
    {"trace_id": "a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4", "ts_us": _now_us - 90_000_000, "span_count": 13, "total_duration_ms": 95.6},
    {"trace_id": "b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5", "ts_us": _now_us - 95_000_000, "span_count": 13, "total_duration_ms": 63.4},
    {"trace_id": "c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6", "ts_us": _now_us - 100_000_000, "span_count": 13, "total_duration_ms": 77.2},
    {"trace_id": "d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7", "ts_us": _now_us - 105_000_000, "span_count": 13, "total_duration_ms": 81.0},
    {"trace_id": "e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8", "ts_us": _now_us - 110_000_000, "span_count": 13, "total_duration_ms": 48.5},
    {"trace_id": "f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9", "ts_us": _now_us - 115_000_000, "span_count": 13, "total_duration_ms": 59.8},
    {"trace_id": "a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0", "ts_us": _now_us - 120_000_000, "span_count": 13, "total_duration_ms": 102.9},
]

# ============================================================
# Series state (in-memory)
# ============================================================

class SeriesState:
    def __init__(self):
        self.series = []
        self.next_id = 1
        self.active_id = None

    def start(self, name):
        if self.active_id is not None:
            return None
        sid = self.next_id
        self.next_id += 1
        s = {"id": sid, "name": name, "span_count": random.randint(100, 500), "status": "active"}
        self.series.append(s)
        self.active_id = sid
        return s

    def stop(self):
        if self.active_id is None:
            return False
        for s in self.series:
            if s["id"] == self.active_id:
                s["status"] = "stopped"
                break
        self.active_id = None
        return True

    def reactivate(self, sid):
        if self.active_id is not None:
            return None
        for s in self.series:
            if s["id"] == sid:
                s["status"] = "active"
                self.active_id = sid
                return s
        return None

    def list_all(self):
        return list(self.series)

series_state = SeriesState()

# ============================================================
# Helpers
# ============================================================

def get_stats(service, stage):
    key = f"{service}|{stage}"
    base = BASE_STATS.get(key, DEFAULT_STATS)
    noise = random.uniform(-0.05, 0.05)
    avg = base["avg"] * (1 + noise)
    stddev = base["stddev"] * (1 + noise * 0.5)
    count = base["count"] + random.randint(-5, 5)
    max_val = round(base["max"] * (1 + random.uniform(-0.1, 0.1)), 3)
    p99 = round(avg * random.uniform(2.0, 3.5), 3)
    return {
        "avg": round(avg, 3),
        "min": round(base["min"] * (1 + random.uniform(-0.1, 0.1)), 3),
        "max": max_val,
        "p50": round(avg * random.uniform(0.8, 1.0), 3),
        "p99": min(p99, max_val),
        "stddev": round(stddev, 3),
        "count": count,
    }


def build_trace_tree(trace_id):
    """Build a trace tree matching the perf.js CALL_TREE structure.

    Timestamps increase in DFS order so trace.js computes a correct totalRange.
    """
    base_ts = int(time.time() * 1_000_000)

    def node(svc, stage, dur, ts_offset_us, children=None):
        n = {
            "service": svc,
            "stage": stage,
            "has_span": True,
            "trace_id": trace_id,
            "duration_ms": round(dur, 3),
            "ts_us": base_ts + ts_offset_us,
            "status": "ok",
        }
        if children:
            n["children"] = children
        return n

    return node("proxy", "proxy_e2e", 80.0, 0, [
        node("proxy", "feature_rpc", 25.0, 2000, [
            node("feature", "feature_total", 22.0, 3000, [
                node("feature", "generate_user_logs", 10.0, 4000),
            ]),
        ]),
        node("proxy", "recall_rpc", 35.0, 25000, [
            node("recall", "recall_total", 33.0, 26000, [
                node("recall", "vllm_rpc", 28.0, 27000),
            ]),
        ]),
        node("proxy", "precalc_rpc", 22.0, 30000, [
            node("precalc", "precalc_total", 20.0, 31000),
        ]),
        node("proxy", "rank_rpc", 18.0, 55000, [
            node("rank_master", "rank_master_total", 16.0, 56000, [
                node("rank_sub", "rank_sub_total", 12.0, 57000),
            ]),
        ]),
        node("proxy", "recall_precalc_parallel_wait", 40.0, 79000),
    ])


def get_outliers(service, stage):
    st = get_stats(service, stage)
    outliers = []
    for i in range(3):
        dur = st["avg"] + st["stddev"] * random.uniform(3.5, 5.0)
        outliers.append({
            "trace_id": f"outlier_{i:04x}",
            "duration_ms": round(dur, 3),
            "deviation_ratio": round(dur / st["avg"], 2),
        })
    return {
        "stage": stage,
        "avg": st["avg"],
        "stddev": st["stddev"],
        "outliers": outliers,
    }


def generate_sample_spans(limit):
    spans = []
    services = ["proxy", "feature", "recall", "precalc", "rank_master", "rank_sub"]
    stages = ["proxy_e2e", "feature_total", "recall_total", "precalc_total", "rank_master_total", "rank_sub_total"]
    for i in range(limit):
        svc = random.choice(services)
        spans.append({
            "ts_us": _now_us - random.randint(0, 60_000_000),
            "service": svc,
            "stage": random.choice(stages),
            "metric": "processing",
            "trace_id": f"trace_{i:04x}",
            "duration_ms": round(random.uniform(5.0, 150.0), 3),
            "status": "ok" if random.random() > 0.05 else "error",
            "series_id": 0,
        })
    return spans


# ============================================================
# HTTP Handler
# ============================================================

class MockHandler(BaseHTTPRequestHandler):
    # HTTP/1.0 — close connection after each response (simpler, no keep-alive issues)

    def log_message(self, fmt, *args):
        sys.stderr.write(f"[mock] {self.address_string()} {fmt % args}\n")

    def _send_json(self, code, data):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_raw(self, code, content_type, body_bytes, disposition=None):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body_bytes)))
        if disposition:
            self.send_header("Content-Disposition", disposition)
        self.end_headers()
        self.wfile.write(body_bytes)

    # ---- GET ----

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        qs = parse_qs(parsed.query)

        if path == "/api/v1/health":
            self._send_json(200, {"status": "ok"})

        elif path == "/api/v1/stats/current":
            service = qs.get("service", [""])[0]
            stage = qs.get("stage", [""])[0]
            if not service or not stage:
                self._send_json(400, {"error": "missing service or stage param"})
                return
            self._send_json(200, get_stats(service, stage))

        elif path == "/api/v1/stages":
            self._send_json(200, STAGES)

        elif path == "/api/v1/tree":
            self._send_json(200, CALL_TREE)

        elif path == "/api/v1/traces":
            limit = min(max(int(qs.get("limit", ["20"])[0]), 1), 100)
            offset = max(int(qs.get("offset", ["0"])[0]), 0)
            self._send_json(200, TRACES[offset:offset + limit])

        elif path.startswith("/api/v1/trace/"):
            trace_id = path[len("/api/v1/trace/"):]
            self._send_json(200, {"trace_id": trace_id, "tree": build_trace_tree(trace_id)})

        elif path.startswith("/api/v1/series/") and path.endswith("/stats"):
            sid_str = path[len("/api/v1/series/"):-len("/stats")]
            try:
                int(sid_str)
            except ValueError:
                self._send_json(400, {"error": "invalid series id"})
                return
            st = get_stats("proxy", "proxy_e2e")
            st["count"] = random.randint(50, 500)
            st["success"] = random.randint(int(st["count"] * 0.8), st["count"])
            st["fail"] = st["count"] - st["success"]
            self._send_json(200, st)

        elif path == "/api/v1/series":
            self._send_json(200, {"series": series_state.list_all()})

        elif path == "/api/v1/outliers":
            service = qs.get("service", ["proxy"])[0]
            stage = qs.get("stage", ["proxy_e2e"])[0]
            self._send_json(200, get_outliers(service, stage))

        elif path == "/api/v1/download":
            self._handle_download(qs)

        else:
            self._send_json(404, {"error": "not found"})

    # ---- POST ----

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        qs = parse_qs(parsed.query)

        if path == "/api/v1/series/start":
            name = qs.get("name", ["unnamed"])[0]
            s = series_state.start(name)
            if s:
                self._send_json(200, {"id": s["id"], "name": s["name"], "status": "active"})
            else:
                self._send_json(409, {"error": "a series is already active"})

        elif path == "/api/v1/series/stop":
            series_state.stop()
            self._send_json(200, {"status": "stopped"})

        elif path.startswith("/api/v1/series/") and path.endswith("/activate"):
            sid_str = path[len("/api/v1/series/"):-len("/activate")]
            try:
                sid = int(sid_str)
            except ValueError:
                self._send_json(400, {"error": "invalid series id"})
                return
            s = series_state.reactivate(sid)
            if s:
                self._send_json(200, {"id": s["id"], "name": s["name"], "status": "active"})
            else:
                self._send_json(409, {"error": "a series is already active or not found"})

        elif path == "/Proxy/Recommend":
            self._handle_recommend()

        else:
            self._send_json(404, {"error": "not found"})

    # ---- Download ----

    def _handle_download(self, qs):
        fmt = qs.get("format", ["csv"])[0]
        limit = min(max(int(qs.get("limit", ["100"])[0]), 1), 100)
        spans = generate_sample_spans(limit)
        ts_str = str(int(time.time()))

        if fmt == "csv":
            lines = ["ts_us,service,stage,metric,trace_id,duration_ms,status,series_id"]
            for s in spans:
                lines.append(f"{s['ts_us']},{s['service']},{s['stage']},{s['metric']},{s['trace_id']},{s['duration_ms']},{s['status']},{s['series_id']}")
            body = "\n".join(lines) + "\n"
            self._send_raw(200, "text/csv", body.encode(),
                           f'attachment; filename="perf-export-{ts_str}.csv"')

        elif fmt == "jsonl":
            body = "\n".join(json.dumps(s) for s in spans) + "\n"
            self._send_raw(200, "application/x-ndjson", body.encode(),
                           f'attachment; filename="perf-export-{ts_str}.jsonl"')

        elif fmt == "json":
            body = json.dumps(spans, indent=2)
            self._send_raw(200, "application/json", body.encode(),
                           f'attachment; filename="perf-export-{ts_str}.json"')

        else:  # log
            lines = []
            for s in spans:
                lines.append(f"service={s['service']} stage={s['stage']} metric={s['metric']} trace_id={s['trace_id']} duration_ms={s['duration_ms']} status={s['status']}")
            body = "\n".join(lines) + "\n"
            self._send_raw(200, "text/plain", body.encode(),
                           f'attachment; filename="perf-export-{ts_str}.log"')

    # ---- Proxy Recommend ----

    def _handle_recommend(self):
        content_len = int(self.headers.get("Content-Length", 0))
        if content_len:
            self.rfile.read(content_len)
        time.sleep(random.uniform(0.01, 0.05))
        candidates = random.sample(range(1000, 9999), random.randint(5, 20))
        self._send_json(200, {"error_code": 0, "candidates": candidates})


# ============================================================
# Main
# ============================================================

if __name__ == "__main__":
    port = 8080
    if "--port" in sys.argv:
        idx = sys.argv.index("--port")
        if idx + 1 < len(sys.argv):
            port = int(sys.argv[idx + 1])
    server = ThreadingHTTPServer(("0.0.0.0", port), MockHandler)
    print(f"Mock perf-collector on :{port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...", flush=True)
        server.shutdown()
