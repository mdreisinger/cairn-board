#!/usr/bin/env python3
"""Generates the PNG icons (a small stack of stones) with the standard library only. Run: python3 tools/make-icons.py"""
import struct
import zlib
import os

def png(w, h, px):
    raw = b"".join(b"\x00" + bytes(c for p in row for c in p) for row in px)
    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")

def draw(n):
    bg = (246, 245, 241)
    stones = [  # (cx, cy, rx, ry, colour) as fractions of n
        (0.50, 0.74, 0.30, 0.11, (92, 99, 108)),
        (0.50, 0.55, 0.23, 0.10, (122, 130, 140)),
        (0.50, 0.38, 0.16, 0.085, (156, 164, 174)),
        (0.50, 0.25, 0.09, 0.065, (190, 196, 204)),
    ]
    rows = []
    for y in range(n):
        row = []
        for x in range(n):
            c = bg
            for cx, cy, rx, ry, col in stones:
                dx = (x / n - cx) / rx
                dy = (y / n - cy) / ry
                if dx * dx + dy * dy <= 1:
                    c = col
            row.append(c)
        rows.append(row)
    return png(n, n, rows)

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "icons")
os.makedirs(out, exist_ok=True)
for name, n in (("icon-192.png", 192), ("icon-512.png", 512), ("apple-touch-icon.png", 180)):
    with open(os.path.join(out, name), "wb") as fh:
        fh.write(draw(n))
print("icons written")
