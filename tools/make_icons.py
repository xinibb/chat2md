#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""纯 Python 生成扩展图标（无第三方依赖）：蓝色圆角方块 + 白色文档图形"""
import zlib
import struct
import os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src', 'assets')


def make_png(size):
    # 画布：RGBA
    px = [[(0, 0, 0, 0) for _ in range(size)] for _ in range(size)]
    s = size
    # 圆角矩形背景（蓝色渐变简化为中心亮、边缘深）
    radius = int(s * 0.22)
    for y in range(s):
        for x in range(s):
            # 圆角判定
            in_x = radius <= x < s - radius
            in_y = radius <= y < s - radius
            inside = (in_x or in_y) or (
                (x < radius or x >= s - radius) and (y < radius or y >= s - radius) and
                ((x - radius + 0.5) ** 2 + (y - radius + 0.5) ** 2) ** 0.5 < radius or
                ((x - (s - radius) + 0.5) ** 2 + (y - radius + 0.5) ** 2) ** 0.5 < radius or
                ((x - radius + 0.5) ** 2 + (y - (s - radius) + 0.5) ** 2) ** 0.5 < radius or
                ((x - (s - radius) + 0.5) ** 2 + (y - (s - radius) + 0.5) ** 2) ** 0.5 < radius
            )
            # 上面的布尔式不可靠，改用逐角判定
            inside = False
            corners = [(radius, radius), (s - radius, radius), (radius, s - radius), (s - radius, s - radius)]
            if in_x or in_y:
                inside = True
            else:
                for cx, cy in corners:
                    if radius <= x < radius + 1 or True:
                        pass
            # 简化：四角圆形裁切
            dx = max(radius - x, x - (s - radius - 1), 0)
            dy = max(radius - y, y - (s - radius - 1), 0)
            if dx > 0 and dy > 0:
                if dx * dx + dy * dy > radius * radius:
                    inside = False
                else:
                    inside = True
            else:
                inside = True

            if not inside:
                continue
            t = (x + y) / (2.0 * s)
            r = int(37 + (29 - 37) * t)
            g = int(99 + (78 - 99) * t)
            b = int(235 + (216 - 235) * t)
            px[y][x] = (r, g, b, 255)

    # 白色文档：居中，占约 46% 宽
    dw = int(s * 0.44)
    dh = int(s * 0.56)
    x0 = (s - dw) // 2
    y0 = (s - dh) // 2
    fold = int(dw * 0.30)
    for y in range(dh):
        for x in range(dw):
            ax, ay = x0 + x, y0 + y
            # 折角三角形（右上）
            in_fold = (x >= dw - fold) and (y < fold) and ((dw - x) + y <= fold)
            if in_fold:
                continue
            px[ay][ax] = (255, 255, 255, 255)
    # 文档内文字横线（蓝色）
    line_w = int(dw * 0.56)
    lx0 = x0 + int(dw * 0.20)
    lh = max(2, int(s * 0.035))
    gap = max(3, int(s * 0.075))
    for i in range(3):
        ly = y0 + int(dh * 0.30) + i * gap
        for y in range(lh):
            for x in range(line_w):
                ax, ay = lx0 + x, ly + y
                if ay < y0 + dh - int(dh * 0.12):
                    px[ay][ax] = (37, 99, 235, 255)
    # 折角描边（浅蓝）
    for k in range(fold):
        ax, ay = x0 + dw - fold + k, y0 + k
        if 0 <= ax < s and 0 <= ay < s and px[ay][ax][3] == 0:
            px[ay][ax] = (191, 219, 254, 255)

    # 编码 PNG
    raw = b''
    for row in px:
        raw += b'\x00' + b''.join(struct.pack('BBBB', *p) for p in row)

    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)

    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = struct.pack('>IIBBBBB', s, s, 8, 6, 0, 0, 0)
    idat = zlib.compress(raw, 9)
    return sig + chunk(b'IHDR', ihdr) + chunk(b'IDAT', idat) + chunk(b'IEND', b'')


os.makedirs(OUT, exist_ok=True)
for sz in (16, 48, 128):
    p = os.path.join(OUT, 'icon%d.png' % sz)
    with open(p, 'wb') as f:
        f.write(make_png(sz))
    print('生成', p, os.path.getsize(p), 'bytes')
