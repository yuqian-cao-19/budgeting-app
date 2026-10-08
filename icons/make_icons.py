"""Generate the app icons (no dependencies). Run: python3 make_icons.py"""
import math
import struct
import zlib
from pathlib import Path

GREEN = (22, 163, 74)
WHITE = (255, 255, 255)
SS = 3  # supersampling for smooth edges


def pixel(x, y):
    """Ring-gauge design: white 3/4 arc plus a faint remainder, on green."""
    dx, dy = x - 0.5, y - 0.5
    r = math.hypot(dx, dy)
    if 0.19 <= r <= 0.30:
        angle = (math.degrees(math.atan2(dx, -dy)) + 360) % 360  # 0 = top, clockwise
        return 1.0 if angle <= 270 else 0.35
    return 0.0


def render(size):
    rows = []
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            a = 0.0
            for sy in range(SS):
                for sx in range(SS):
                    a += pixel((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size)
            a /= SS * SS
            row += bytes(round(g + (w - g) * a) for g, w in zip(GREEN, WHITE))
        rows.append(bytes(row))
    raw = zlib.compress(b"".join(rows), 9)

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data))

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", raw) + chunk(b"IEND", b"")


here = Path(__file__).parent
for s in (180, 192, 512):
    (here / f"icon-{s}.png").write_bytes(render(s))
    print(f"icon-{s}.png")
