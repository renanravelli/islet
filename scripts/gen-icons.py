#!/usr/bin/env python3
"""Draws Islet's icons with no dependencies: the app icon source (1024 px, then `tauri icon`
makes every size) and the tray's template images. The mark: a black pill with a green dot.

Usage: python3 scripts/gen-icons.py <app-icon-output.png> <tray-dir>
"""

import struct
import sys
import zlib

SS = 4  # supersampling per axis, for smooth edges


def png(path, width, height, pixel):
    rows = bytearray()
    for y in range(height):
        rows.append(0)
        for x in range(width):
            acc = [0, 0, 0, 0]
            for sy in range(SS):
                for sx in range(SS):
                    r, g, b, a = pixel((x + (sx + 0.5) / SS), (y + (sy + 0.5) / SS))
                    acc[0] += r * a
                    acc[1] += g * a
                    acc[2] += b * a
                    acc[3] += a
            n = SS * SS
            alpha = acc[3] / n
            if alpha > 0:
                rows += bytes(round(c / acc[3]) for c in acc[:3]) + bytes([round(alpha)])
            else:
                rows += b"\0\0\0\0"

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(bytes(rows), 9)) + chunk(b"IEND", b""))


def in_round_rect(x, y, left, top, w, h, r):
    cx = min(max(x, left + r), left + w - r)
    cy = min(max(y, top + r), top + h - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def app_icon(x, y):
    size, inset = 1024, 100
    if not in_round_rect(x, y, inset, inset, size - 2 * inset, size - 2 * inset, 185):
        return (0, 0, 0, 0)
    pill_w, pill_h = 600, 300
    left, top = (size - pill_w) / 2, (size - pill_h) / 2
    dot_x, dot_y, dot_r = left + pill_h / 2, size / 2, 70
    if (x - dot_x) ** 2 + (y - dot_y) ** 2 <= dot_r * dot_r:
        return (0x32, 0xD7, 0x4B, 255)
    if in_round_rect(x, y, left, top, pill_w, pill_h, pill_h / 2):
        return (0, 0, 0, 255)
    return (0xF2, 0xF2, 0xF4, 255)


def tray(scale):
    def pixel(x, y):
        x, y = x / scale, y / scale  # in points, on a 22×22 canvas
        left, top, w, h = 2, 6, 18, 10
        if (x - (left + 5)) ** 2 + (y - 11) ** 2 <= 2.6 ** 2:
            return (0, 0, 0, 0)  # the dot is a hole, so the menu bar shows through
        if in_round_rect(x, y, left, top, w, h, 5):
            return (0, 0, 0, 255)
        return (0, 0, 0, 0)

    return pixel


if __name__ == "__main__":
    app_out, tray_dir = sys.argv[1], sys.argv[2]
    png(app_out, 1024, 1024, app_icon)
    png(f"{tray_dir}/tray.png", 22, 22, tray(1))
    png(f"{tray_dir}/tray@2x.png", 44, 44, tray(2))
