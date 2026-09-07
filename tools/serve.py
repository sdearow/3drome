#!/usr/bin/env python3
"""Serve the application for local use.

    python tools/serve.py            # http://localhost:8000
    python tools/serve.py 8080       # another port

`python -m http.server` works too, but it lets the browser cache aggressively, and
a cached index.html that still points at a since-renamed module fails in a way that
looks like the whole application is broken. This sends no-store on everything, so a
reload always gets what is on disk. That matters most while editing, which is most
of the time.
"""

import socketserver
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "app"


class Handler(SimpleHTTPRequestHandler):
    # Some Windows installations carry a registry mapping that serves .js as
    # text/plain, which browsers refuse to execute as a module. Pin the types that
    # matter rather than trusting the machine's own table.
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".json": "application/json",
        ".css": "text/css",
        ".wasm": "application/wasm",
        ".glb": "model/gltf-binary",
        ".gltf": "model/gltf+json",
        ".ktx2": "image/ktx2",
        ".svg": "image/svg+xml",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def log_message(self, fmt, *args):
        # One line per request is noise; failures are what is worth seeing.
        if not str(args[1] if len(args) > 1 else "").startswith("2"):
            super().log_message(fmt, *args)


def main() -> int:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000

    if not (ROOT / "vendor" / "cesium" / "Cesium.js").exists():
        print("CesiumJS is not vendored yet. Run:  python tools/setup_cesium.py")
        return 1

    socketserver.TCPServer.allow_reuse_address = True
    try:
        with socketserver.TCPServer(("", port), partial(Handler, directory=str(ROOT))) as httpd:
            print(f"Serving {ROOT} at http://localhost:{port}")
            print("Press Ctrl+C to stop.")
            httpd.serve_forever()
    except OSError as error:
        print(f"Could not listen on port {port}: {error}")
        print(f"Something else may be using it. Try:  python tools/serve.py {port + 1}")
        return 1
    except KeyboardInterrupt:
        print("\nStopped.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
