#!/usr/bin/env python3
"""Hostwatch agent: collects Linux host metrics from /proc and sends them to the
Hostwatch server. Standard library only, so it runs on any Python 3.9+ host.

Real mode reads:
  /proc/stat       CPU usage (delta between two reads)
  /proc/meminfo    memory and swap
  /proc/loadavg    load averages
  /proc/uptime     uptime
  /proc/net/dev    network throughput (delta)
  statvfs()        disk usage per mount point
  systemctl        state of the services you list (optional)
  Docker API       container state over a unix socket (optional, read-only)

Simulated mode (--simulate) produces plausible numbers for demos and tests and
marks every sample with "simulated": true so the dashboard labels it.
"""
from __future__ import annotations

import argparse
import http.client
import json
import logging
import math
import os
import random
import socket
import subprocess
import sys
import time
import urllib.parse
from collections import deque
from datetime import datetime, timezone

LOG = logging.getLogger("hostwatch.agent")
SKIP_FS = {"proc", "sysfs", "devtmpfs", "devpts", "tmpfs", "cgroup", "cgroup2", "overlay", "squashfs",
           "securityfs", "pstore", "bpf", "tracefs", "debugfs", "mqueue", "hugetlbfs", "fusectl", "configfs",
           "nsfs", "autofs", "binfmt_misc", "rpc_pipefs", "efivarfs", "ramfs"}


# ---------------------------------------------------------------- parsing ---
def parse_cpu_times(stat_text: str) -> tuple[int, int]:
    """Return (busy, total) jiffies from the aggregate 'cpu' line of /proc/stat."""
    for line in stat_text.splitlines():
        if line.startswith("cpu "):
            vals = [int(x) for x in line.split()[1:]]
            # user nice system idle iowait irq softirq steal guest guest_nice
            idle = vals[3] + (vals[4] if len(vals) > 4 else 0)
            # guest time is already included in user/nice, so don't count it twice
            total = sum(vals[:8])
            return total - idle, total
    raise ValueError("no aggregate cpu line in /proc/stat")


def count_cpus(stat_text: str) -> int:
    return sum(1 for line in stat_text.splitlines() if line.startswith("cpu") and line[3:4].isdigit())


def cpu_percent(prev: tuple[int, int], cur: tuple[int, int]) -> float:
    busy = cur[0] - prev[0]
    total = cur[1] - prev[1]
    if total <= 0:
        return 0.0
    return round(max(0.0, min(100.0, 100.0 * busy / total)), 1)


def parse_meminfo(text: str) -> dict:
    kb = {}
    for line in text.splitlines():
        key, _, rest = line.partition(":")
        parts = rest.split()
        if parts:
            kb[key] = int(parts[0]) * 1024
    total = kb.get("MemTotal", 0)
    avail = kb.get("MemAvailable", kb.get("MemFree", 0))
    swap_total = kb.get("SwapTotal", 0)
    swap_free = kb.get("SwapFree", 0)
    return {
        "totalBytes": total,
        "availableBytes": avail,
        "usedPct": round(100.0 * (total - avail) / total, 1) if total else 0.0,
        "swapUsedPct": round(100.0 * (swap_total - swap_free) / swap_total, 1) if swap_total else 0.0,
    }


def parse_loadavg(text: str) -> list[float]:
    return [float(x) for x in text.split()[:3]]


def parse_net_dev(text: str) -> tuple[int, int]:
    """Total (rx, tx) bytes over all interfaces except loopback."""
    rx = tx = 0
    for line in text.splitlines()[2:]:
        name, _, data = line.partition(":")
        if name.strip() == "lo" or not data:
            continue
        f = data.split()
        rx += int(f[0])
        tx += int(f[8])
    return rx, tx


def parse_mounts(text: str, include_readonly: bool = False) -> list[str]:
    """Real block-device mounts. Read-only mounts are skipped by default: they
    can't fill up, so a 'disk full' alert on them is noise."""
    seen, out = set(), []
    for line in text.splitlines():
        f = line.split()
        if len(f) < 4 or f[2] in SKIP_FS or not f[0].startswith(("/", "UUID", "LABEL")):
            continue
        if not include_readonly and "ro" in f[3].split(","):
            continue
        mount = f[1].replace("\\040", " ")
        if f[0] in seen:
            continue
        seen.add(f[0])
        out.append(mount)
    return out


def disk_usage(mount: str) -> dict | None:
    try:
        st = os.statvfs(mount)
    except OSError:
        return None
    total = st.f_blocks * st.f_frsize
    if total == 0:
        return None
    free_for_users = st.f_bavail * st.f_frsize
    used = total - st.f_bfree * st.f_frsize
    # Percent as `df` shows it: used / (used + available to unprivileged users)
    denom = used + free_for_users
    return {"mount": mount, "totalBytes": total, "usedBytes": used, "usedPct": round(100.0 * used / denom, 1) if denom else 0.0}


# --------------------------------------------------------------- probes -----
def service_states(units: list[str]) -> list[dict]:
    out = []
    for unit in units:
        try:
            r = subprocess.run(["systemctl", "is-active", unit], capture_output=True, text=True, timeout=3, check=False)
            state = r.stdout.strip() or "unknown"
        except (OSError, subprocess.TimeoutExpired):
            state = "unknown"
        out.append({"name": unit, "state": state if state in {"active", "inactive", "failed", "activating", "deactivating"} else "unknown"})
    return out


class UnixHTTPConnection(http.client.HTTPConnection):
    def __init__(self, path: str, timeout: float = 3.0):
        super().__init__("localhost", timeout=timeout)
        self.socket_path = path

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(self.socket_path)


def container_states(docker_socket: str) -> list[dict]:
    """Read-only GET /containers/json. Prefer a socket proxy that only allows this endpoint."""
    try:
        conn = UnixHTTPConnection(docker_socket)
        conn.request("GET", "/containers/json?all=1")
        resp = conn.getresponse()
        if resp.status != 200:
            return []
        items = json.loads(resp.read())
    except (OSError, ValueError):
        return []
    out = []
    for c in items[:100]:
        status = c.get("Status", "")
        health = "healthy" if "(healthy)" in status else "unhealthy" if "(unhealthy)" in status else "none"
        out.append({"name": (c.get("Names") or ["?"])[0].lstrip("/")[:100], "image": str(c.get("Image", ""))[:200],
                    "state": c.get("State", "unknown"), "health": health})
    return out


# ------------------------------------------------------------- collectors ---
class ProcCollector:
    def __init__(self, root: str = "/proc", mounts: list[str] | None = None, services: list[str] | None = None,
                 docker_socket: str | None = None):
        self.root = root
        self.mounts = mounts
        self.services = services or []
        self.docker_socket = docker_socket
        self.prev_cpu = None
        self.prev_net = None
        self.prev_t = None

    def _read(self, name: str) -> str:
        with open(os.path.join(self.root, name), encoding="utf-8") as fh:
            return fh.read()

    def collect(self) -> dict:
        now = time.monotonic()
        stat = self._read("stat")
        cpu_now = parse_cpu_times(stat)
        net_now = parse_net_dev(self._read("net/dev"))
        cpu = cpu_percent(self.prev_cpu, cpu_now) if self.prev_cpu else None
        rx = tx = None
        if self.prev_net and self.prev_t and now > self.prev_t:
            dt = now - self.prev_t
            rx = max(0, round((net_now[0] - self.prev_net[0]) / dt))
            tx = max(0, round((net_now[1] - self.prev_net[1]) / dt))
        self.prev_cpu, self.prev_net, self.prev_t = cpu_now, net_now, now

        mounts = self.mounts or parse_mounts(self._read("mounts"))
        sample = {
            "simulated": False,
            "uptimeSec": int(float(self._read("uptime").split()[0])),
            "load": parse_loadavg(self._read("loadavg")),
            "cpu": {"usagePct": cpu, "cores": count_cpus(stat)},
            "mem": parse_meminfo(self._read("meminfo")),
            "disks": [d for d in (disk_usage(m) for m in mounts[:20]) if d],
            "net": {"rxBytesPerSec": rx, "txBytesPerSec": tx},
            "services": service_states(self.services),
            "containers": container_states(self.docker_socket) if self.docker_socket else [],
        }
        return sample


class SimulatedCollector:
    """Deterministic-ish synthetic host: a daily wave, noise, occasional spikes."""

    def __init__(self, seed: int = 1, profile: str = "web"):
        self.rng = random.Random(seed)
        self.profile = profile
        self.t0 = time.time()
        self.disk = 40.0 + self.rng.random() * 30
        self.spike_until = 0.0

    def collect(self) -> dict:
        t = time.time()
        wave = (math.sin((t - self.t0) / 600.0) + 1) / 2  # 0..1 over ~1 hour
        if self.rng.random() < 0.01:
            self.spike_until = t + 360  # long enough to trip a 5-minute rule
        spike = 45.0 if t < self.spike_until else 0.0
        base = 20.0 if self.profile == "web" else 35.0
        cpu = min(100.0, max(0.0, base + 30 * wave + self.rng.gauss(0, 4) + spike))
        mem = min(99.0, max(5.0, 45 + 20 * wave + self.rng.gauss(0, 2)))
        self.disk = min(97.0, self.disk + self.rng.random() * 0.01)
        services = [{"name": "nginx.service", "state": "active"}, {"name": "postgresql.service", "state": "active"}]
        if self.rng.random() < 0.003:
            services[0]["state"] = "failed"
        return {
            "simulated": True,
            "uptimeSec": int(t - self.t0) + 86_400,
            "load": [round(cpu / 25, 2), round(cpu / 30, 2), round(cpu / 35, 2)],
            "cpu": {"usagePct": round(cpu, 1), "cores": 4},
            "mem": {"totalBytes": 8 * 2**30, "availableBytes": int(8 * 2**30 * (1 - mem / 100)), "usedPct": round(mem, 1),
                    "swapUsedPct": 0.0},
            "disks": [{"mount": "/", "totalBytes": 80 * 2**30, "usedBytes": int(80 * 2**30 * self.disk / 100),
                       "usedPct": round(self.disk, 1)}],
            "net": {"rxBytesPerSec": int(50_000 + 400_000 * wave), "txBytesPerSec": int(120_000 + 900_000 * wave)},
            "services": services,
            "containers": [{"name": "app", "image": "example/app:1.4.2", "state": "running", "health": "healthy"}],
        }


# ------------------------------------------------------------------ sender ---
class Sender:
    """POSTs samples; keeps a bounded backlog while the server is unreachable."""

    def __init__(self, url: str, token: str, backlog: int = 360, timeout: float = 5.0):
        parsed = urllib.parse.urlsplit(url)
        if parsed.scheme not in {"https", "http"}:
            raise ValueError("server URL must be http(s)")
        if parsed.scheme == "http" and parsed.hostname not in {"localhost", "127.0.0.1", "server", "hostwatch"}:
            LOG.warning("sending metrics over plain HTTP to %s; use HTTPS outside a private network", parsed.hostname)
        self.parsed = parsed
        self.token = token
        self.queue: deque = deque(maxlen=backlog)
        self.timeout = timeout

    def _post(self, body: bytes) -> int:
        conn_cls = http.client.HTTPSConnection if self.parsed.scheme == "https" else http.client.HTTPConnection
        conn = conn_cls(self.parsed.hostname, self.parsed.port, timeout=self.timeout)  # TLS verification stays on
        try:
            conn.request("POST", (self.parsed.path.rstrip("/") or "") + "/api/v1/ingest", body=body, headers={
                "Content-Type": "application/json", "Authorization": f"Bearer {self.token}", "User-Agent": "hostwatch-agent/1.0"})
            return conn.getresponse().status
        finally:
            conn.close()

    def send(self, sample: dict) -> bool:
        self.queue.append(sample)
        while self.queue:
            body = json.dumps(self.queue[0], separators=(",", ":")).encode()
            try:
                status = self._post(body)
            except OSError as exc:
                LOG.warning("server unreachable (%s); %d sample(s) queued", exc.__class__.__name__, len(self.queue))
                return False
            if status in (200, 202, 204):
                self.queue.popleft()
            elif status in (400, 413, 422):
                LOG.error("server rejected a sample (%s); dropping it", status)
                self.queue.popleft()
            elif status in (401, 403):
                LOG.error("server refused the agent token (%s); check HOSTWATCH_TOKEN", status)
                return False
            else:
                LOG.warning("server answered %s; will retry", status)
                return False
        return True


def build_sample(host: str, data: dict) -> dict:
    return {"host": host, "ts": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"), **data}


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Hostwatch metrics agent")
    p.add_argument("--server", default=os.environ.get("HOSTWATCH_SERVER", "http://localhost:4000"))
    p.add_argument("--host", default=os.environ.get("HOSTWATCH_HOST", socket.gethostname()))
    p.add_argument("--interval", type=float, default=float(os.environ.get("HOSTWATCH_INTERVAL", "10")))
    p.add_argument("--services", default=os.environ.get("HOSTWATCH_SERVICES", ""), help="comma-separated systemd units")
    p.add_argument("--mounts", default=os.environ.get("HOSTWATCH_MOUNTS", ""), help="comma-separated mount points")
    p.add_argument("--docker-socket", default=os.environ.get("HOSTWATCH_DOCKER_SOCKET", ""))
    p.add_argument("--proc", default=os.environ.get("HOSTWATCH_PROC", "/proc"))
    p.add_argument("--simulate", action="store_true", default=os.environ.get("HOSTWATCH_SIMULATE") == "1")
    p.add_argument("--seed", type=int, default=int(os.environ.get("HOSTWATCH_SEED", "1")))
    p.add_argument("--once", action="store_true", help="print one sample as JSON and exit")
    args = p.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    if args.simulate:
        collector = SimulatedCollector(seed=args.seed, profile="db" if "db" in args.host else "web")
    else:
        collector = ProcCollector(root=args.proc,
                                  mounts=[m for m in args.mounts.split(",") if m] or None,
                                  services=[s for s in args.services.split(",") if s],
                                  docker_socket=args.docker_socket or None)
    if args.once:
        if isinstance(collector, ProcCollector):
            collector.collect()
            time.sleep(1)
        print(json.dumps(build_sample(args.host, collector.collect()), indent=2))
        return 0

    token = os.environ.get("HOSTWATCH_TOKEN")
    if not token:
        LOG.error("HOSTWATCH_TOKEN is not set")
        return 78
    sender = Sender(args.server, token)
    LOG.info("sending %s metrics for %s to %s every %ss", "SIMULATED" if args.simulate else "real", args.host,
             sender.parsed.netloc, args.interval)
    next_run = time.monotonic()
    while True:
        try:
            sender.send(build_sample(args.host, collector.collect()))
        except (OSError, ValueError) as exc:  # a broken /proc read must not kill the agent
            LOG.error("collection failed: %s", exc)
        next_run += args.interval
        time.sleep(max(0.0, next_run - time.monotonic()))


if __name__ == "__main__":
    sys.exit(main())
