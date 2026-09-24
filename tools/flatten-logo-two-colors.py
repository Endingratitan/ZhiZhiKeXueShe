#!/usr/bin/env python3
"""
把社团 logo 压成「两色」：只有一种蓝 + 纯白，其余一切颜色（深色描边、深蓝、
白色噪点变体等）全部并入这两色；透明背景与边缘透明度保持不变。

用法：
    python3 tools/flatten-logo-two-colors.py [输入图] [--out 输出图]
                                             [--blue RRGGBB] [--dry-run] [--report]

判定方式（比简单阈值更稳）：
    把每个像素视为「白 → 蓝」的线性混合，求混合比例 t：
        P ≈ (1-t)·白 + t·蓝
        t = (P-白)·(蓝-白) / |蓝-白|²      （投影，截断到 0..1）
    t >= 0.5 → 判为蓝，否则判为白。于是
      · 白色区域的 #fffeff / #fcffff 之类噪点 → 纯白；
      · 蓝白交界处的过渡像素 → 按覆盖率归入更接近的一色；
      · 外圈边缘那些「低透明度 + 深蓝」像素 → 依旧是蓝，但颜色变成唯一蓝，
        不再呈现深色描边（透明度保留，边缘依旧平滑）。
    蓝色取值默认自动检测：统计"明显偏蓝"（饱和度>60 且 B 通道最大）的像素，
    取出现次数最多者；也可用 --blue 指定。

依赖：Pillow
"""

import argparse
import sys
from collections import Counter
from PIL import Image

WHITE = (255, 255, 255)


def detect_blue(px, w, h):
    """自动检测主蓝色：统计明显偏蓝的像素，取众数"""
    counter = Counter()
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            mx, mn = max(r, g, b), min(r, g, b)
            if b >= r and b >= g and (mx - mn) > 60:
                counter[(r, g, b)] += 1
    if not counter:
        return (13, 140, 232)
    return counter.most_common(1)[0][0]


def coverage(pixel, blue):
    """求像素中"蓝"的混合比例 t（0=纯白，1=纯蓝）"""
    d = [blue[i] - WHITE[i] for i in range(3)]
    denom = sum(c * c for c in d)
    if denom == 0:
        return 0.0
    num = sum((pixel[i] - WHITE[i]) * d[i] for i in range(3))
    t = num / denom
    return 0.0 if t < 0 else (1.0 if t > 1 else t)


def flatten(src, dst, blue=None, dry_run=False, report=False):
    im = Image.open(src).convert("RGBA")
    w, h = im.size
    px = im.load()

    if blue is None:
        blue = detect_blue(px, w, h)
    print(f"使用蓝色: #{blue[0]:02x}{blue[1]:02x}{blue[2]:02x}  rgb{blue}")

    n_blue = n_white = n_transparent = 0
    before_colors = Counter()
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                n_transparent += 1
                continue
            before_colors[(r, g, b)] += 1
            t = coverage((r, g, b), blue)
            if t >= 0.5:
                px[x, y] = (blue[0], blue[1], blue[2], a)
                n_blue += 1
            else:
                px[x, y] = (WHITE[0], WHITE[1], WHITE[2], a)
                n_white += 1

    after_colors = set()
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a != 0:
                after_colors.add((r, g, b))

    print(f"输入: {src}  ({w}×{h})")
    print(f"  蓝: {n_blue}   白: {n_white}   透明: {n_transparent}")
    print(f"  不透明区颜色数: {len(before_colors)} → {len(after_colors)}  {sorted(after_colors)}")
    if report:
        print("  处理前出现次数最多的 5 种颜色:")
        for c, n in before_colors.most_common(5):
            print(f"    #{c[0]:02x}{c[1]:02x}{c[2]:02x}  {n} 次")

    if dry_run:
        print("dry-run：未写出文件")
        return
    im.save(dst, "PNG", optimize=True)
    print(f"已写出: {dst}")


def main():
    ap = argparse.ArgumentParser(description="把 logo 压成蓝 + 白两色")
    ap.add_argument("src", nargs="?", default="assets/images/zzkxs_icon.png")
    ap.add_argument("--out", default=None, help="输出路径（默认覆盖输入）")
    ap.add_argument("--blue", default=None, help="指定蓝色，如 0d8ce8")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--report", action="store_true", help="打印配色统计")
    args = ap.parse_args()

    blue = None
    if args.blue:
        v = args.blue.lstrip("#")
        blue = (int(v[0:2], 16), int(v[2:4], 16), int(v[4:6], 16))
    flatten(args.src, args.out or args.src, blue=blue, dry_run=args.dry_run, report=args.report)


if __name__ == "__main__":
    sys.exit(main())
