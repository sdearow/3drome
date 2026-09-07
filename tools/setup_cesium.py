#!/usr/bin/env python3
"""Download CesiumJS and put it where the application expects it.

    python tools/setup_cesium.py

Python-only on purpose: the machines this runs on have Python but not
necessarily Node, and installing Node needs rights they do not have. Nothing
here touches anything outside this folder.

If the download fails — a proxy, an intercepted certificate, antivirus eating
the temporary file — the manual route is three steps and always works:

    1. Download https://github.com/CesiumGS/cesium/releases/download/1.145/Cesium-1.145.zip
    2. Unzip it
    3. Copy the Build/Cesium folder from inside it to app/vendor/cesium
"""

import shutil
import ssl
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

VERSION = "1.145"
URL = f"https://github.com/CesiumGS/cesium/releases/download/{VERSION}/Cesium-{VERSION}.zip"

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / "app" / "vendor" / "cesium"


def report(done: int, total: int) -> None:
    if total <= 0:
        sys.stdout.write(f"\r  {done / 1e6:.1f} MB")
    else:
        pct = done / total * 100
        sys.stdout.write(f"\r  {done / 1e6:.1f} / {total / 1e6:.1f} MB  ({pct:.0f}%)")
    sys.stdout.flush()


def download(url: str, dest: Path) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": "3drome-setup"})
    with urllib.request.urlopen(request) as response, dest.open("wb") as handle:
        total = int(response.headers.get("Content-Length") or 0)
        done = 0
        last = 0
        while chunk := response.read(1 << 16):
            handle.write(chunk)
            done += len(chunk)
            # Repaint about once a megabyte: enough to show life, few enough
            # lines to stay readable if the terminal does not honour \r.
            if done - last >= 1 << 20:
                report(done, total)
                last = done
        report(done, total)
    print()


def main() -> int:
    if TARGET.exists() and (TARGET / "Cesium.js").exists():
        print(f"CesiumJS is already in place at {TARGET}")
        print("Delete that folder and re-run if you want to replace it.")
        return 0

    print(f"Downloading CesiumJS {VERSION}…")
    try:
        with tempfile.TemporaryDirectory() as tmp:
            archive = Path(tmp) / "cesium.zip"
            download(URL, archive)

            print("Extracting…")
            with zipfile.ZipFile(archive) as zf:
                zf.extractall(Path(tmp) / "unpacked")

            # The release zip contains Build/Cesium; older layouts nest it one
            # level deeper, so look for it rather than assuming.
            candidates = list((Path(tmp) / "unpacked").glob("**/Build/Cesium"))
            if not candidates:
                print("Could not find Build/Cesium inside the archive.", file=sys.stderr)
                return 1

            TARGET.parent.mkdir(parents=True, exist_ok=True)
            if TARGET.exists():
                shutil.rmtree(TARGET)
            shutil.copytree(candidates[0], TARGET)

    except ssl.SSLError as error:
        print(f"\nTLS failed: {error}", file=sys.stderr)
        print("This usually means a corporate proxy is intercepting certificates.", file=sys.stderr)
        print("Use the manual route in the header of this file.", file=sys.stderr)
        return 1
    except Exception as error:  # noqa: BLE001 - the fallback is the same whatever broke
        print(f"\nDownload failed: {error}", file=sys.stderr)
        print("Use the manual route in the header of this file.", file=sys.stderr)
        return 1

    print(f"CesiumJS is ready at {TARGET}")
    print("\nNow run:  python -m http.server 8000 -d app")
    print("Then open http://localhost:8000")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
