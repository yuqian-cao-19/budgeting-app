"""Generate the app icons (no dependencies). Run: python3 make_icons.py

A soft-blue piggy bank with a coin dropping in, on the app's deep navy.
Everything sits inside the middle 80% so Android's round "maskable" crop doesn't cut it off.
"""
import math
import struct
import zlib
from pathlib import Path

BG = (13, 20, 36)        # app background (dark navy)
BLUE = (142, 168, 234)   # the app's accent blue
SHADE = (110, 135, 205)  # a darker blue for the coin and ear
SS = 4  # supersampling for smooth edges


def rrect(x, y, x0, y0, x1, y1, r):
    if not (x0 <= x <= x1 and y0 <= y <= y1):
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def ellipse(x, y, cx, cy, rx, ry):
    return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1


def triangle(x, y, a, b, c):
    def side(p, q, r):
        return (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1])
    d1, d2, d3 = side((x, y), a, b), side((x, y), b, c), side((x, y), c, a)
    return not ((d1 < 0 or d2 < 0 or d3 < 0) and (d1 > 0 or d2 > 0 or d3 > 0))


def pixel(x, y):
    """Color at (x, y), both in 0..1 icon coordinates."""
    if math.hypot(x - .47, y - .23) <= .055:
        return SHADE                                   # coin
    if rrect(x, y, .41, .355, .53, .385, .015):
        return BG                                      # coin slot
    if math.hypot(x - .655, y - .47) <= .02:
        return BG                                      # eye
    snout = rrect(x, y, .69, .47, .80, .60, .04)
    if snout and math.hypot(x - .765, y - .535) <= .014:
        return BG                                      # nostril
    body = ellipse(x, y, .47, .54, .27, .19)
    legs = rrect(x, y, .31, .64, .39, .77, .03) or rrect(x, y, .53, .64, .61, .77, .03)
    if body or snout or legs:
        return BLUE
    if triangle(x, y, (.54, .41), (.67, .42), (.63, .30)):  # base tucked into the body so it doesn't float
        return SHADE                                   # ear
    return BG


def render(size):
    rows = []
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            acc = [0, 0, 0]
            for sy in range(SS):
                for sx in range(SS):
                    c = pixel((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size)
                    for i in range(3):
                        acc[i] += c[i]
            row += bytes(round(v / (SS * SS)) for v in acc)
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
