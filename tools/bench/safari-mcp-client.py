"""Minimal stdio client for Apple's Safari MCP server (safaridriver --mcp).

Usage:
  python3 tools/bench/safari-mcp-client.py bridge <url> <out.json>
  python3 tools/bench/safari-mcp-client.py eval <url> "<js function body>"
"""
import json
import subprocess
import sys
import threading
import time
import urllib.request

SD = "/Applications/Safari Technology Preview.app/Contents/MacOS/safaridriver"


class Client:
    def __init__(self):
        self.p = subprocess.Popen(
            [SD, "--mcp"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        self.pending = {}
        self.lock = threading.Lock()
        self.next_id = 1
        threading.Thread(target=self._reader, daemon=True).start()
        self.request("initialize", {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {"name": "headless-paint-bench", "version": "0"},
        })
        self.notify("notifications/initialized")

    def _reader(self):
        for line in self.p.stdout:
            try:
                m = json.loads(line)
            except Exception:
                continue
            if "id" in m and m["id"] in self.pending:
                self.pending[m["id"]]["result"] = m
                self.pending[m["id"]]["event"].set()

    def notify(self, method, params=None):
        msg = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            msg["params"] = params
        self.p.stdin.write(json.dumps(msg) + "\n")
        self.p.stdin.flush()

    def request(self, method, params=None, timeout=120):
        with self.lock:
            rid = self.next_id
            self.next_id += 1
        ev = threading.Event()
        self.pending[rid] = {"event": ev, "result": None}
        msg = {"jsonrpc": "2.0", "id": rid, "method": method}
        if params is not None:
            msg["params"] = params
        self.p.stdin.write(json.dumps(msg) + "\n")
        self.p.stdin.flush()
        if not ev.wait(timeout):
            raise TimeoutError(f"{method} timed out")
        res = self.pending.pop(rid)["result"]
        if "error" in res:
            raise RuntimeError(json.dumps(res["error"]))
        return res["result"]

    def tool(self, name, args, timeout=120):
        res = self.request("tools/call", {"name": name, "arguments": args}, timeout)
        texts = [c.get("text", "") for c in res.get("content", []) if c.get("type") == "text"]
        return "\n".join(texts), res

    def evaluate(self, script, timeout=120):
        text, res = self.tool("evaluate_javascript", {"expression": script}, timeout)
        return text

    def close(self):
        try:
            self.p.kill()
        except Exception:
            pass


def wait_http(url, seconds=60):
    deadline = time.time() + seconds
    while time.time() < deadline:
        try:
            urllib.request.urlopen(url, timeout=3).read(64)
            return True
        except Exception:
            time.sleep(1)
    return False


def main():
    mode = sys.argv[1]
    url = sys.argv[2]
    if not wait_http(url, 60):
        print("server not reachable:", url)
        sys.exit(1)
    c = Client()
    try:
        text, _ = c.tool("navigate_to_url", {"url": url}, 120)
        print("navigated:", text[:200].replace("\n", " "))
        # The automation window starts hidden; bring STP to front so rAF/timers run unthrottled.
        subprocess.run(["osascript", "-e", 'tell application "Safari Technology Preview" to activate'], timeout=15, capture_output=True)
        time.sleep(1.5)
        if mode == "eval":
            print(c.evaluate(sys.argv[3]))
            return
        if mode == "hold":
            seconds = int(sys.argv[3])
            tabs_text = c.tool("list_tabs", {})[0]
            print("tabs:", tabs_text[:300])
            try:
                handle = json.loads(tabs_text)[0]["handle"]
                print("switch:", c.tool("switch_tab", {"handle": handle})[0][:200])
            except Exception as e:
                print("switch error:", e)
            print("rAF probe:", c.evaluate("return new Promise((resolve) => { let raf = 0; const t0 = performance.now(); function tick(){ raf++; if (performance.now() - t0 < 1500) requestAnimationFrame(tick); } requestAnimationFrame(tick); setTimeout(() => resolve(JSON.stringify({visibility: document.visibilityState, rafIn1500ms: raf})), 2000); });"))
            print("page:", c.tool("page_info", {})[0][:300])
            try:
                print("shot:", c.tool("screenshot", {})[0][:300])
            except Exception as e:
                print("shot error:", e)
            print("visibility:", c.evaluate("return document.visibilityState;"))
            time.sleep(seconds)
            print("visibility after hold:", c.evaluate("return document.visibilityState;"))
            return
        out_path = sys.argv[3]
        started = time.time()
        while time.time() - started < 900:
            text = c.evaluate("return JSON.stringify(window.__bridgeResult ?? null);")
            if text and text.strip() not in ("null", '"null"', ""):
                payload = text.strip()
                # tool may wrap the string in quotes / escape it
                try:
                    data = json.loads(payload)
                    if isinstance(data, str):
                        data = json.loads(data)
                except Exception:
                    print("unparsed result:", payload[:300])
                    break
                with open(out_path, "w") as f:
                    json.dump(data, f, indent=2)
                print("saved", out_path, "elapsed", round(time.time() - started), "s")
                break
            time.sleep(5)
        else:
            print("timed out waiting for __bridgeResult")
    finally:
        c.close()


if __name__ == "__main__":
    main()
