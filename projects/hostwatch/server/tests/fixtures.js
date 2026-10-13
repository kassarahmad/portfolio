// Shared test data.
export function sample(over = {}) {
  return {
    host: "web-1",
    ts: new Date().toISOString(),
    simulated: false,
    uptimeSec: 100,
    load: [0.1, 0.2, 0.3],
    cpu: { usagePct: 10, cores: 2 },
    mem: { totalBytes: 1e9, availableBytes: 5e8, usedPct: 50, swapUsedPct: 0 },
    disks: [{ mount: "/", totalBytes: 1e10, usedBytes: 5e9, usedPct: 50 }],
    net: { rxBytesPerSec: 10, txBytesPerSec: 20 },
    services: [{ name: "nginx.service", state: "active" }],
    containers: [],
    ...over,
  };
}
