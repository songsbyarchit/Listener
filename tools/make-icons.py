#!/usr/bin/env python3
"""Generate LISTNR's PNG icons with no third-party dependencies.

Usage: python3 -I tools/make-icons.py
"""

from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "icons"
SIZES = (16, 32, 48, 128)
SUPERSAMPLE = 4

EMBER_TOP = (228, 98, 61)
EMBER_BOTTOM = (196, 63, 26)
CREAM = (255, 246, 234)


def rounded_rect_sdf(px: float, py: float, cx: float, cy: float, hw: float, hh: float, radius: float) -> float:
    qx = abs(px - cx) - (hw - radius)
    qy = abs(py - cy) - (hh - radius)
    ax = max(qx, 0.0)
    ay = max(qy, 0.0)
    return math.hypot(ax, ay) + min(max(qx, qy), 0.0) - radius


def mix(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return (
        round(a[0] + (b[0] - a[0]) * t),
        round(a[1] + (b[1] - a[1]) * t),
        round(a[2] + (b[2] - a[2]) * t),
    )


def make_icon(size: int) -> bytes:
    # Three rounded waveform bars, normalized to the icon box.
    bars = (
        (0.315, 0.105, 0.34),
        (0.500, 0.105, 0.66),
        (0.685, 0.105, 0.46),
    )
    pixels: list[bytes] = []
    step = 1.0 / (size * SUPERSAMPLE)

    for y in range(size):
        row = bytearray()
        for x in range(size):
            bg_hits = 0
            fg_hits = 0
            samples = 0
            for sy in range(SUPERSAMPLE):
                for sx in range(SUPERSAMPLE):
                    px = (x + (sx + 0.5) / SUPERSAMPLE) / size
                    py = (y + (sy + 0.5) / SUPERSAMPLE) / size
                    samples += 1
                    if rounded_rect_sdf(px, py, 0.5, 0.5, 0.5, 0.5, 0.225) <= 0:
                        bg_hits += 1
                        for cx, width, height in bars:
                            if rounded_rect_sdf(px, py, cx, 0.5, width / 2, height / 2, width / 2) <= 0:
                                fg_hits += 1
                                break

            alpha = round(255 * bg_hits / samples)
            if alpha == 0:
                row.extend((0, 0, 0, 0))
                continue

            base = mix(EMBER_TOP, EMBER_BOTTOM, y / max(1, size - 1))
            coverage = fg_hits / samples
            color = mix(base, CREAM, min(1.0, coverage / max(bg_hits / samples, 1e-6)))
            row.extend((*color, alpha))
        pixels.append(bytes(row))

    raw = b"".join(b"\x00" + row for row in pixels)
    return raw


def chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def write_png(path: Path, size: int) -> None:
    raw = make_icon(size)
    width = height = size
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    payload = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    path.write_bytes(payload)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        target = OUT_DIR / f"icon{size}.png"
        write_png(target, size)
        print(f"wrote {target.relative_to(ROOT)} ({size}×{size})")


if __name__ == "__main__":
    main()
