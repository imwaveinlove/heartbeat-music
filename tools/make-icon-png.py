#!/usr/bin/env python3
"""Export the js/icon.js pixel grid as transparent PNGs.

The grid in js/icon.js is the single source of truth for the mascot; this reads it
straight out of that file so the PNGs can never drift from what the page draws.
Standard library only (zlib + struct write the PNG), so there is nothing to install.

Usage:
  python tools/make-icon-png.py                 # icon-pixel.png at 16x
  python tools/make-icon-png.py --scale 32      # bigger
  python tools/make-icon-png.py --favicons      # square 512/192/180/32/16 too
  python tools/make-icon-png.py --bg "#ffe3f1"  # solid background instead of alpha

Note the artwork is wider than it is tall. Raw exports keep that shape; --favicons
centres it on a square canvas, which is what a favicon or app icon needs.
"""

import argparse
import os
import re
import struct
import sys
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICON_JS = os.path.join(ROOT, 'js', 'icon.js')


def load_grid():
    """Pull GRID and COLORS out of icon.js."""
    src = open(ICON_JS, encoding='utf-8').read()

    m = re.search(r'var GRID = \[([\s\S]*?)\n  \];', src)
    if not m:
        raise SystemExit('could not find GRID in %s' % ICON_JS)
    rows = []
    for line in m.group(1).strip().splitlines():
        parts = re.findall(r"'([^']*)'", line)   # rows are written as 'a' + 'b' + 'c'
        if parts:
            rows.append(''.join(parts))

    widths = set(len(r) for r in rows)
    if len(widths) != 1:
        raise SystemExit('rows are not all the same width: %s' % sorted(widths))

    colors = dict(re.findall(r"(\w):\s*'(#[0-9a-fA-F]{6})'", src))
    palette = {k: hex_rgba(v) for k, v in colors.items()}
    palette['.'] = (0, 0, 0, 0)

    missing = set(''.join(rows)) - set(palette)
    if missing:
        raise SystemExit('grid uses characters with no colour: %s' % sorted(missing))
    return rows, palette


def hex_rgba(h, alpha=255):
    h = h.lstrip('#')
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), alpha)


def png_bytes(width, height, pixel_rows):
    raw = b''.join(b'\x00' + row for row in pixel_rows)   # filter type 0 per row

    def chunk(tag, data):
        body = tag + data
        return (struct.pack('>I', len(data)) + body +
                struct.pack('>I', zlib.crc32(body) & 0xffffffff))

    return (b'\x89PNG\r\n\x1a\n' +
            chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)) +
            chunk(b'IDAT', zlib.compress(raw, 9)) +
            chunk(b'IEND', b''))


def render(rows, palette, scale, bg):
    """Grid -> RGBA rows at `scale` pixels per cell."""
    out = []
    for row in rows:
        line = bytearray()
        for ch in row:
            c = palette[ch]
            if c[3] == 0 and bg:
                c = bg
            line += bytes(c) * scale
        packed = bytes(line)
        for _ in range(scale):
            out.append(packed)
    return out, len(rows[0]) * scale, len(rows) * scale


def render_square(rows, palette, size, bg, samples=4):
    """Centre the artwork on a square canvas, fitted to whatever `size` allows.

    This samples the grid per output pixel rather than scaling whole cells up by an
    integer factor. Integer scaling cannot produce a 16px icon from a 32-cell grid —
    the factor rounds to zero — so small favicons have to be resampled down. Each
    output pixel averages a few sub-samples, with colour weighted by alpha so
    transparent edges do not bleed toward black.
    """
    gw, gh = len(rows[0]), len(rows)
    inner = size * 0.92
    fit = min(inner / gw, inner / gh)
    dw, dh = gw * fit, gh * fit                 # drawn size in pixels
    ox, oy = (size - dw) / 2.0, (size - dh) / 2.0
    fill = bg or (0, 0, 0, 0)

    canvas = []
    for py in range(size):
        line = bytearray()
        for px in range(size):
            ar = ag = ab = aa = 0.0
            for sy in range(samples):
                fy = py + (sy + 0.5) / samples
                gy = int((fy - oy) / fit)
                for sx in range(samples):
                    fx = px + (sx + 0.5) / samples
                    gx = int((fx - ox) / fit)
                    if 0 <= gx < gw and 0 <= gy < gh:
                        c = palette[rows[gy][gx]]
                    else:
                        c = fill
                    a = c[3] / 255.0
                    ar += c[0] * a; ag += c[1] * a; ab += c[2] * a; aa += a
            n = samples * samples
            if aa <= 0:
                line += bytes(fill if fill[3] else (0, 0, 0, 0))
            else:
                line += bytes((int(round(ar / aa)), int(round(ag / aa)),
                               int(round(ab / aa)), int(round(aa / n * 255))))
        canvas.append(bytes(line))
    return canvas, size, size


def write(path, rows_rgba, w, h):
    with open(path, 'wb') as f:
        f.write(png_bytes(w, h, rows_rgba))
    print('  %-22s %4d x %-4d %9s bytes' %
          (os.path.relpath(path, ROOT), w, h, '{:,}'.format(os.path.getsize(path))))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--scale', type=int, default=16, help='pixels per grid cell (default 16)')
    ap.add_argument('--out', default='icon-pixel.png', help='output path, relative to the project root')
    ap.add_argument('--favicons', action='store_true', help='also write square 512/192/180/32/16')
    ap.add_argument('--bg', default=None, help='solid background colour, e.g. "#ffe3f1" (default: transparent)')
    args = ap.parse_args()

    bg = hex_rgba(args.bg) if args.bg else None
    rows, palette = load_grid()
    print('  grid: %d x %d%s' % (len(rows[0]), len(rows), '' if bg else '  (transparent)'))

    art, w, h = render(rows, palette, args.scale, bg)
    write(os.path.join(ROOT, args.out), art, w, h)

    if args.favicons:
        for size in (512, 192, 180, 32, 16):
            sq, sw, sh = render_square(rows, palette, size, bg)
            write(os.path.join(ROOT, 'icon-%d.png' % size), sq, sw, sh)


if __name__ == '__main__':
    main()
