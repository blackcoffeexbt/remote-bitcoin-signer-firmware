#!/bin/sh
# Initial provisioning only. Regular updates use `pio run -t upload`.
set -eu
cd "$(dirname "$0")/.."
port="${1:-/dev/cu.usbmodem1101}"
pio_home="${PLATFORMIO_CORE_DIR:-$HOME/.platformio}"
python="$pio_home/penv/bin/python"
esptool="$pio_home/packages/tool-esptoolpy/esptool.py"
framework="$pio_home/packages/framework-arduinoespressif32"
build=".pio/build/esp32-s3-n16r8v"
"$pio_home/penv/bin/pio" run -e esp32-s3-n16r8v
table=$(mktemp)
trap 'rm -f "$table"' EXIT HUP INT TERM
"$python" "$esptool" --chip esp32s3 --port "$port" read_flash 0x8000 0x1000 "$table"
"$python" - "$table" <<'PY'
from pathlib import Path
import sys
data = Path(sys.argv[1]).read_bytes()
if len(data) != 4096 or data != b'\xff' * 4096:
    raise SystemExit('Partition table is not erased. Use the regular app-only upload command.')
PY
"$python" "$esptool" --chip esp32s3 --port "$port" --baud 921600 write_flash \
    --flash_mode dio --flash_freq 80m --flash_size 16MB \
    0x0000 "$build/bootloader.bin" \
    0x8000 "$build/partitions.bin" \
    0xe000 "$framework/tools/partitions/boot_app0.bin" \
    0x10000 "$build/firmware.bin"
