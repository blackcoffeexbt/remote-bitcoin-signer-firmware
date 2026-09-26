#!/usr/bin/env python3
"""Build the production validator/signing code against uBitcoin with sanitizers."""

from pathlib import Path
import subprocess
from concurrent.futures import ThreadPoolExecutor

root = Path(__file__).resolve().parents[1]
lib = root / ".pio/libdeps/esp32-s3-n16r8v/uBitcoin/src"
build = root / "tests/generated/native"
build.mkdir(parents=True, exist_ok=True)
sources = (
    list(lib.glob("*.cpp"))
    + list(lib.rglob("*.c"))
    + [lib.parent / "tests/sysrand.c", root / "tests/validator.cpp"]
)
flags = [
    "-DUSE_STDONLY",
    "-DUBTC_TEST",
    "-I" + str(lib),
    "-g",
    "-fsanitize=address,undefined",
    "-fno-omit-frame-pointer",
]


def compile(source):
    output = build / (str(source.relative_to(root)).replace("/", "_") + ".o")
    cmd = ["clang++" if source.suffix == ".cpp" else "clang"]
    if source.suffix == ".cpp":
        cmd += ["-std=c++17"]
    subprocess.run(
        cmd + flags + ["-c", str(source), "-o", str(output)],
        check=True,
        capture_output=True,
    )
    return str(output)


with ThreadPoolExecutor(max_workers=6) as pool:
    objects = list(pool.map(compile, sources))
subprocess.run(
    [
        "clang++",
        "-fsanitize=address,undefined",
        *objects,
        "-o",
        str(build / "validator"),
    ],
    check=True,
)
print(build / "validator")
