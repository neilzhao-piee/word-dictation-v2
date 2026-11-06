#!/usr/bin/env python3
"""wd-ocr -- self-hosted OCR relay to Azure AI Vision Read (ADR-0010).

The Azure key lives here only (EnvironmentFile=/etc/wd-ocr.env, root 0600).
Photo bytes stay in memory: forwarded to Azure, never written to disk, never
logged -- the app keeps photos transient (ADR-0001) and so does this relay.

Endpoints:
  GET  /health   {"ok": true, "configured": <bool>}
  POST /ocr      {"image": "data:image/jpeg;base64,..."} -> Azure analyzeResult JSON verbatim
  OPTIONS *      CORS preflight (the Capacitor WebView calls this cross-origin)

Env: WD_OCR_KEY, WD_OCR_ENDPOINT (https://<region>.api.cognitive.microsoft.com),
     WD_OCR_PORT (default 8093), optional WD_OCR_LANGUAGE (e.g. "en"; omit to let
     Azure auto-detect, which is the default for the Read API), optional
     WD_OCR_TOKEN (shared secret; when set, POST /ocr must carry it in
     X-WD-Token -- relays are usually exposed through a reverse tunnel
     (ADR-0011), so the token keeps strangers off the Azure quota).

See docs/OCR-RELAY.md for deployment; scripts/wd-ocr.env.example lists the
environment contract. This file contains no address, key or token.
"""
import base64
import hmac
import json
import os
import re
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

AZURE_PATH = "/vision/v3.2/read/analyze"
MAX_BODY = 20 * 1024 * 1024
UPSTREAM_TIMEOUT = 30
POLL_DEADLINE = 80   # wait budget per Read op; Cloudflare edge cuts at 100 s
POLL_FIRST_WAIT = 5  # let the operation run before the first GET
POLL_SLEEP = 3       # stay well under the F0 result-poll limit (1 call/s)
POLL_429_WAIT = 25   # F0 answers 429 with "please retry after 25 seconds"
DATA_URL_RE = re.compile(r"^data:(image/[a-z+.-]+);base64,([A-Za-z0-9+/=\s]+)$", re.I)


def azure_config():
    key = (os.environ.get("WD_OCR_KEY") or "").strip()
    endpoint = (os.environ.get("WD_OCR_ENDPOINT") or "").strip().rstrip("/")
    return key, endpoint


def relay_token():
    """Shared access token (ADR-0011). Empty means 'LAN-only deployment' -- keep
    the historical open behaviour so existing LAN setups do not break."""
    return (os.environ.get("WD_OCR_TOKEN") or "").strip()


def token_ok(headers):
    expected = relay_token()
    if not expected:
        return True
    got = (headers.get("X-WD-Token") or "").strip()
    return hmac.compare_digest(got, expected)


def azure_read(key, endpoint, image_bytes, content_type):
    lang = (os.environ.get("WD_OCR_LANGUAGE") or "").strip()
    url = endpoint + AZURE_PATH + (("?language=" + lang) if lang else "")
    req = urllib.request.Request(url, data=image_bytes, method="POST", headers={
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": content_type or "application/octet-stream",
    })
    with urllib.request.urlopen(req, timeout=UPSTREAM_TIMEOUT) as resp:
        status = resp.status
        body = resp.read()
        location = resp.headers.get("Operation-Location") or ""
    if status == 200:
        # Low-priority v3.2 answers synchronously.
        return json.loads(body.decode("utf-8"))
    if status == 202:
        return azure_poll(key, location)
    raise RuntimeError("azure-unexpected-status-%d" % status)


def azure_poll(key, location):
    """Poll the Operation-Location until Succeeded, honoring the F0 rate limit:
    a 429 on a poll is back-pressure, not failure -- back off and keep polling
    inside POLL_DEADLINE. Only an exhausted budget or a final 429 surfaces."""
    if not location:
        raise RuntimeError("azure-no-operation-location")
    deadline = time.monotonic() + POLL_DEADLINE
    wait = POLL_FIRST_WAIT
    while True:
        time.sleep(wait)
        req = urllib.request.Request(location, method="GET", headers={
            "Ocp-Apim-Subscription-Key": key,
        })
        try:
            with urllib.request.urlopen(req, timeout=UPSTREAM_TIMEOUT) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 429 and time.monotonic() + POLL_429_WAIT < deadline:
                wait = POLL_429_WAIT
                continue
            raise
        # F0 answered the poll with lowercase "succeeded" (docs show "Succeeded")
        # -- compare case-insensitively or a finished job is polled to timeout.
        status = str(payload.get("status") or "").lower()
        if status == "succeeded":
            return payload
        if status in ("failed", "cancelled", "canceled"):
            raise RuntimeError("azure-read-" + status)
        if time.monotonic() + POLL_SLEEP >= deadline:
            raise RuntimeError("azure-read-timeout")
        wait = POLL_SLEEP


class Handler(BaseHTTPRequestHandler):
    server_version = "wd-ocr/1.1"

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-WD-Token")

    def _json(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        # Method / path / status line only -- request bodies (photos) are never logged.
        super().log_message("%s %s", self.command, self.path.split("?")[0])

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Access-Control-Max-Age", "86400")
        self.end_headers()

    def do_GET(self):
        if self.path.split("?")[0] == "/health":
            key, endpoint = azure_config()
            self._json(200, {"ok": True, "configured": bool(key and endpoint)})
        else:
            self._json(404, {"error": "not-found"})

    def do_POST(self):
        if self.path.split("?")[0] != "/ocr":
            self._json(404, {"error": "not-found"})
            return
        if not token_ok(self.headers):
            self._json(401, {"error": "relay-unauthorized"})
            return
        key, endpoint = azure_config()
        if not key or not endpoint:
            self._json(503, {"error": "relay-not-configured"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = -1
        if length <= 0 or length > MAX_BODY:
            self._json(413, {"error": "bad-content-length"})
            return
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._json(400, {"error": "bad-json"})
            return
        m = DATA_URL_RE.match(str((payload or {}).get("image") or "").strip())
        if not m:
            self._json(400, {"error": "missing-image-data-url"})
            return
        try:
            image = base64.b64decode(m.group(2))
        except Exception:
            self._json(400, {"error": "bad-base64"})
            return
        try:
            result = azure_read(key, endpoint, image, m.group(1))
        except urllib.error.HTTPError as e:
            detail = ""
            try:
                detail = e.read().decode("utf-8")[:500]
            except Exception:
                pass
            self._json(502, {"error": "azure-http-%d" % e.code, "detail": detail})
            return
        except urllib.error.URLError as e:
            self._json(502, {"error": "azure-unreachable", "detail": str(e.reason)})
            return
        except RuntimeError as e:
            self._json(502, {"error": str(e)})
            return
        except json.JSONDecodeError:
            self._json(502, {"error": "azure-bad-response"})
            return
        self._json(200, result)


def main():
    port = int(os.environ.get("WD_OCR_PORT") or "8093")
    httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    key, endpoint = azure_config()
    print("wd-ocr listening on :%d configured=%s" % (port, bool(key and endpoint)), flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
