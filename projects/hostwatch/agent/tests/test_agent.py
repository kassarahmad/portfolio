import json
import os
import shutil
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import hostwatch_agent as agent  # noqa: E402

FIX = os.path.join(os.path.dirname(__file__), "fixtures", "proc")


def read(name):
    with open(os.path.join(FIX, name), encoding="utf-8") as fh:
        return fh.read()


class ParserTests(unittest.TestCase):
    def test_cpu_times_and_percent(self):
        busy, total = agent.parse_cpu_times(read("stat"))
        self.assertEqual((busy, total), (1500, 10000))
        self.assertEqual(agent.count_cpus(read("stat")), 2)
        # 300 busy out of 400 jiffies since the last read = 75%
        self.assertEqual(agent.cpu_percent((1500, 10000), (1800, 10400)), 75.0)
        self.assertEqual(agent.cpu_percent((1500, 10000), (1500, 10000)), 0.0, "no time passed")

    def test_meminfo_uses_available_not_free(self):
        m = agent.parse_meminfo(read("meminfo"))
        self.assertEqual(m["totalBytes"], 8000000 * 1024)
        self.assertEqual(m["usedPct"], 75.0)
        self.assertEqual(m["swapUsedPct"], 25.0)

    def test_loadavg_and_net(self):
        self.assertEqual(agent.parse_loadavg(read("loadavg")), [0.52, 0.40, 0.31])
        self.assertEqual(agent.parse_net_dev(read("net/dev")), (1000000, 2000000), "loopback excluded")

    def test_mounts_skip_virtual_duplicate_and_readonly(self):
        self.assertEqual(agent.parse_mounts(read("mounts")), ["/", "/mnt/my data"])
        self.assertIn("/opt/image", agent.parse_mounts(read("mounts"), include_readonly=True))


class CollectorTests(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        shutil.copytree(FIX, self.root, dirs_exist_ok=True)

    def tearDown(self):
        shutil.rmtree(self.root)

    def test_first_sample_has_no_rates_second_has_them(self):
        c = agent.ProcCollector(root=self.root, mounts=["/"])
        first = c.collect()
        self.assertIsNone(first["cpu"]["usagePct"])
        self.assertFalse(first["simulated"])
        with open(os.path.join(self.root, "stat"), "w", encoding="utf-8") as fh:
            fh.write("cpu  1300 0 500 8100 500 0 0 0 0 0\ncpu0 1 0 0 0\n")
        second = c.collect()
        self.assertEqual(second["cpu"]["usagePct"], 75.0)
        self.assertGreaterEqual(second["net"]["rxBytesPerSec"], 0)
        self.assertEqual(second["uptimeSec"], 3600)
        self.assertTrue(second["disks"] and second["disks"][0]["mount"] == "/")

    def test_real_proc_when_available(self):
        if not os.path.exists("/proc/stat"):
            self.skipTest("not on Linux")
        c = agent.ProcCollector()
        c.collect()
        s = c.collect()
        self.assertTrue(0 <= s["cpu"]["usagePct"] <= 100)
        self.assertTrue(0 < s["mem"]["usedPct"] < 100)
        self.assertGreater(s["cpu"]["cores"], 0)


class SimulatorTests(unittest.TestCase):
    def test_values_are_bounded_and_labelled(self):
        sim = agent.SimulatedCollector(seed=7)
        for _ in range(500):
            s = sim.collect()
            self.assertTrue(s["simulated"])
            self.assertTrue(0 <= s["cpu"]["usagePct"] <= 100)
            self.assertTrue(0 <= s["mem"]["usedPct"] <= 100)
            self.assertTrue(0 <= s["disks"][0]["usedPct"] <= 100)


class FakeServer:
    def __init__(self, statuses):
        self.statuses = list(statuses)
        self.received = []
        outer = self

        class H(BaseHTTPRequestHandler):
            def do_POST(self):
                body = self.rfile.read(int(self.headers["Content-Length"]))
                outer.received.append((self.headers["Authorization"], json.loads(body)))
                self.send_response(outer.statuses.pop(0) if outer.statuses else 202)
                self.end_headers()

            def log_message(self, *a):
                pass

        self.httpd = HTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def close(self):
        self.httpd.shutdown()


class SenderTests(unittest.TestCase):
    def test_sends_with_bearer_token(self):
        srv = FakeServer([202])
        try:
            s = agent.Sender(srv.url, "tok")
            self.assertTrue(s.send(agent.build_sample("web-1", {"simulated": True})))
            auth, body = srv.received[0]
            self.assertEqual(auth, "Bearer tok")
            self.assertEqual(body["host"], "web-1")
            self.assertTrue(body["ts"].endswith("Z"))
        finally:
            srv.close()

    def test_keeps_backlog_while_server_errors_then_flushes_in_order(self):
        srv = FakeServer([503, 202, 202])
        try:
            s = agent.Sender(srv.url, "tok")
            self.assertFalse(s.send({"n": 1}))
            self.assertEqual(len(s.queue), 1)
            self.assertTrue(s.send({"n": 2}))
            self.assertEqual([b["n"] for _, b in srv.received], [1, 1, 2])
            self.assertEqual(len(s.queue), 0)
        finally:
            srv.close()

    def test_backlog_is_bounded_when_unreachable(self):
        s = agent.Sender("http://127.0.0.1:9", "tok", backlog=3, timeout=0.2)
        for i in range(10):
            s.send({"n": i})
        self.assertEqual([x["n"] for x in s.queue], [7, 8, 9])

    def test_rejects_non_http_urls(self):
        with self.assertRaises(ValueError):
            agent.Sender("file:///etc/passwd", "tok")


if __name__ == "__main__":
    unittest.main()
