#!/usr/bin/env python3
"""Capture bounded serial logs; optionally reset the connected ESP32 first."""

import argparse
import time
import serial

p = argparse.ArgumentParser(description=__doc__)
p.add_argument("--port", default="/dev/cu.usbmodem1101")
p.add_argument("--seconds", type=int, default=30)
p.add_argument("--reset", action="store_true")
a = p.parse_args()
with serial.Serial(a.port, 115200, timeout=0.25) as port:
    if a.reset:
        port.dtr = False
        port.rts = True
        time.sleep(0.15)
        port.rts = False
    end = time.monotonic() + a.seconds
    while time.monotonic() < end:
        data = port.readline()
        if data:
            print(data.decode(errors="replace").rstrip(), flush=True)
