#!/usr/bin/env python3
"""Refresh public relay TLS trust roots using the installed certifi package."""

from pathlib import Path
import hashlib
import shutil
import subprocess
import sys
import tempfile
import certifi

root = Path(__file__).resolve().parents[1]
generator = (
    root
    / "lib/WebSockets/examples/esp32_pio/WebSocketClientSSLBundle/gen_crt_bundle.py"
)
with tempfile.TemporaryDirectory() as temp:
    subprocess.run(
        [sys.executable, str(generator), "--input", certifi.where()],
        cwd=temp,
        check=True,
    )
    shutil.copy2(Path(temp) / "x509_crt_bundle", root / "data/cert/roots.bin")
(root / "data/cert/README.md").write_text(
    "# Public TLS root certificates\n\n"
    f"Generated from certifi {certifi.__version__} using the vendored ESP certificate bundle generator.\n\n"
    f"Source PEM SHA-256: `{hashlib.sha256(Path(certifi.where()).read_bytes()).hexdigest()}`.\n\n"
    "Refresh with `lnbits/.venv/bin/python scripts/update-ca-bundle.py`, then rebuild firmware.\n"
)
