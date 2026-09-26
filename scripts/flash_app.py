#!/usr/bin/env python3
"""Flash only the currently selected OTA application. Never write data partitions."""

import argparse
import hashlib
from datetime import datetime
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import zlib

p = argparse.ArgumentParser(description=__doc__)
p.add_argument("image", type=Path)
p.add_argument("--port", default="/dev/cu.usbmodem1101")
p.add_argument("--baud", type=int, default=921600)
p.add_argument(
    "--esptool",
    type=Path,
    default=Path.home() / ".platformio/packages/tool-esptoolpy/esptool.py",
)
a = p.parse_args()
if not a.image.is_file():
    raise SystemExit("Firmware image does not exist")
with a.image.open("rb") as firmware:
    if firmware.read(1) != b"\xe9":
        raise SystemExit("Not an ESP application image")
base = [
    sys.executable,
    str(a.esptool),
    "--chip",
    "esp32s3",
    "--port",
    a.port,
    "--baud",
    str(a.baud),
]


def run(*args):
    subprocess.run([*base, *map(str, args)], check=True)


with tempfile.TemporaryDirectory(prefix="crypto-partitions-") as temp:
    table = Path(temp) / "partitions.bin"
    run("--after", "no_reset", "read_flash", "0x8000", "0x1000", table)
    partitions = []
    data = table.read_bytes()
    for off in range(0, len(data), 32):
        if data[off : off + 2] != b"\xaaP":
            break
        magic, typ, sub, start, size, label, flags = struct.unpack_from(
            "<HBBII16sI", data, off
        )
        partitions.append(
            dict(
                type=typ,
                sub=sub,
                start=start,
                size=size,
                label=label.rstrip(b"\0").decode(),
                flags=flags,
            )
        )
    if (
        data[off : off + 16] != b"\xeb\xeb" + b"\xff" * 14
        or data[off + 16 : off + 32] != hashlib.md5(data[:off]).digest()
    ):
        raise SystemExit("Missing/invalid partition-table checksum; no write performed")
    slots = sorted(
        (x for x in partitions if x["type"] == 0 and 0x10 <= x["sub"] < 0x20),
        key=lambda x: x["sub"],
    )
    ota = next((x for x in partitions if x["type"] == 1 and x["sub"] == 0), None)
    if not slots or ota is None or ota["size"] != 8192:
        raise SystemExit("Unsupported partition layout; no write performed")
    if [x["sub"] for x in slots] != list(range(0x10, 0x10 + len(slots))):
        raise SystemExit("Non-contiguous OTA slots; no write performed")
    selected = Path(temp) / "otadata.bin"
    run("--after", "no_reset", "read_flash", hex(ota["start"]), "0x2000", selected)
    b = selected.read_bytes()
    sequences = []
    for off in (0, 4096):
        seq = struct.unpack_from("<I", b, off)[0]
        state, crc = struct.unpack_from("<II", b, off + 24)
        if (
            seq not in (0, 0xFFFFFFFF)
            and state not in (3, 4)
            and zlib.crc32(b[off : off + 4], 0xFFFFFFFF) == crc
        ):
            sequences.append(seq)
    if not sequences:
        raise SystemExit("No valid OTA selection; no write performed")
    slot = slots[(max(sequences) - 1) % len(slots)]
    if slot["start"] < 0x10000 or slot.get("flags", 0) & 1:
        raise SystemExit("Unsupported application offset or encrypted partition")
    # Protect against sector rounding crossing the partition boundary.
    size = (a.image.stat().st_size + 4095) // 4096 * 4096
    if size > slot["size"] or slot["start"] % 4096:
        raise SystemExit("Image does not safely fit selected slot")
    for other in partitions:
        if other is slot:
            continue
        if (
            slot["start"] < other["start"] + other["size"]
            and slot["start"] + size > other["start"]
        ):
            raise SystemExit("Overlapping partition layout; no write performed")
    backup_dir = Path(".pio/backups")
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup = (
        backup_dir
        / f"application-{datetime.now().strftime('%Y%m%d-%H%M%S')}-{slot['start']:x}.bin"
    )
    run(
        "--after",
        "no_reset",
        "read_flash",
        hex(slot["start"]),
        hex(slot["size"]),
        backup,
    )
    print(f"Previous application backed up to {backup}", flush=True)
    print(
        f"Writing application only: {slot['label']} at {slot['start']:#x}; {a.image.stat().st_size} bytes",
        flush=True,
    )
    run("write_flash", hex(slot["start"]), a.image)
