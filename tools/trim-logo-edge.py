#!/usr/bin/env python3
"""
修整社团 logo 的最外圈：把贴在圆边外侧的「细小蓝白虚环」去掉，
让外轮廓成为一条干净、平滑、可重复运行的圆边。

背景：前两步（去黑残留 → 压两色）之后，原先外圈抗锯齿像素里的深色部分被删成透明，
剩下的蓝色毛边像素形成了一圈断断续续的细蓝环。本脚本按真实圆边裁掉它。

做法：
  1) 圆心初值取不透明像素重心；
  2) 逐角度（0.2°）沿射线由外向内找「实心外沿」：要求连续 5 个采样点（跨 2px）
     都 alpha>=128 —— 跨像素的连续性要求可排除 1px 宽的虚线毛边；
  3) 对全部外沿点做最小二乘圆拟合，剔除残差 >1.5px 的离群点后重新拟合，
     得到唯一的圆心与半径（logo 本身是正圆，用统一半径比逐角度抖动更干净）；
  4) 按该圆重绘边缘：
       rho > R+0.5   → 透明（虚环、毛边全部清掉）
       R-0.5..R+0.5  → 蓝色 + 覆盖率 alpha（保留一圈干净抗锯齿，不是硬锯齿）
       rho < R-0.5   → alpha=255，且 RGB 吸附到 {蓝, 白} 调色板
     所有像素（含完全透明者）的 RGB 都吸附到调色板，
     避免历史上"透明但残留深色 RGB"的像素被重新点亮后冒出别的颜色。

用法：
    python3 tools/trim-logo-edge.py [输入图] [--out 输出] [--dry-run] [--no-feather] [--report]

依赖：Pillow（纯 Python，无需 numpy）
"""

import argparse
import math
import sys
from collections import Counter
from PIL import Image

SOLID_ALPHA = 255       # "实心本体" = 完全不透明（抗锯齿带用 <255，故不会被下一轮误判为边缘）
SOLID_RUN = 3           # 连续实心采样点数（配合 RUN_STEP 跨 1px，排除 1px 虚线毛边）
RUN_STEP = 0.5          # 粗扫步长（像素）
ANGLE_STEP = 0.2        # 角度采样步长（度）
FIT_OUTLIER = 1.5       # 圆拟合离群点阈值（像素）
BAND = 1.0              # 外缘抗锯齿带宽度（像素）
BAND_MAX_ALPHA = 254    # 抗锯齿带的最大 alpha（<255，保证幂等）
EDGE_BLUE_DEPTH = 3.5   # 圆内这一段宽度内强制为蓝：logo 最外圈本体是蓝色描边，
                        # 若让"压两色"阶段判成白的边缘像素保持白色，就会在边缘出现白线
WHITE = (255, 255, 255)


def detect_palette_blue(px, w, h):
    """检测图中唯一的蓝（明显偏蓝的像素取众数）"""
    counter = Counter()
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            mx, mn = max(r, g, b), min(r, g, b)
            if b >= r and b >= g and (mx - mn) > 60:
                counter[(r, g, b)] += 1
    return counter.most_common(1)[0][0] if counter else (21, 161, 255)


def snap_to_palette(rgb, blue):
    """把任意颜色吸附到 {蓝, 白} 中更接近的一色（按"白→蓝"混合比例判定）"""
    d = [blue[i] - WHITE[i] for i in range(3)]
    denom = sum(c * c for c in d)
    if denom == 0:
        return WHITE
    t = sum((rgb[i] - WHITE[i]) * d[i] for i in range(3)) / denom
    return blue if t >= 0.5 else WHITE


def sample_alpha(px, x, y, w, h):
    xi, yi = int(round(x)), int(round(y))
    if xi < 0 or yi < 0 or xi >= w or yi >= h:
        return -1
    return px[xi, yi][3]


def detect_edges(px, w, h, cx, cy, r_max):
    """逐角度求「实心本体」的外沿半径。

    只认 alpha==255 的像素（并要求向内连续 1px 都是 255），
    这样外侧那圈抗锯齿带（alpha<255）不会被当成边缘 ——
    重绘与检测之间不构成反馈回路，脚本可重复运行而图形不漂移。
    """
    n = int(round(360 / ANGLE_STEP))
    edges = []
    for i in range(n):
        th = math.radians(i * ANGLE_STEP)
        dx, dy = math.cos(th), math.sin(th)

        def alpha_at(rr):
            return sample_alpha(px, cx + dx * rr, cy + dy * rr, w, h)

        found = None
        r = r_max
        while r > 1:
            if alpha_at(r) >= SOLID_ALPHA:
                ok = True
                for k in range(1, SOLID_RUN):
                    if alpha_at(r - k * RUN_STEP) < SOLID_ALPHA:
                        ok = False
                        break
                if ok:
                    found = r
                    break
            r -= RUN_STEP
        edges.append(found)
    return edges


def fit_circle(points):
    """代数最小二乘圆拟合（纯 Python 解 3×3 正规方程），返回 (cx, cy, R)"""
    n = len(points)
    sx = sum(p[0] for p in points); sy = sum(p[1] for p in points)
    sxx = sum(p[0] * p[0] for p in points); syy = sum(p[1] * p[1] for p in points)
    sxy = sum(p[0] * p[1] for p in points)
    sz = sum(p[0] * p[0] + p[1] * p[1] for p in points)
    sxz = sum(p[0] * (p[0] * p[0] + p[1] * p[1]) for p in points)
    syz = sum(p[1] * (p[0] * p[0] + p[1] * p[1]) for p in points)

    # D·sxx + E·sxy + F·sx = -sxz ; D·sxy + E·syy + F·sy = -syz ; D·sx + E·sy + F·n = -sz
    def det3(m):
        return (m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
                - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
                + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]))

    A = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, float(n)]]
    b = [-sxz, -syz, -sz]
    D = det3(A)
    if abs(D) < 1e-9:
        return None
    As = []
    for i in range(3):
        m = [row[:] for row in A]
        for r in range(3):
            m[r][i] = b[r]
        As.append(det3(m))
    Dv, Ev, Fv = As[0] / D, As[1] / D, As[2] / D
    cx, cy = -Dv / 2, -Ev / 2
    R = math.sqrt(max(0.0, cx * cx + cy * cy - Fv))
    return cx, cy, R


def robust_circle(edges, cx, cy):
    """迭代拟合 + 剔除离群点，返回 (cx, cy, R, 点数, 残差最大值)"""
    pts = []
    for i, r in enumerate(edges):
        if r is None:
            continue
        th = math.radians(i * ANGLE_STEP)
        pts.append((cx + math.cos(th) * r, cy + math.sin(th) * r))
    if len(pts) < 12:
        return None
    for _ in range(4):
        fit = fit_circle(pts)
        if not fit:
            return None
        fcx, fcy, fR = fit
        keep = [p for p in pts if abs(math.hypot(p[0] - fcx, p[1] - fcy) - fR) <= FIT_OUTLIER]
        if len(keep) == len(pts) or len(keep) < 12:
            break
        pts = keep
    fit = fit_circle(pts)
    if not fit:
        return None
    fcx, fcy, fR = fit
    resid = max(abs(math.hypot(p[0] - fcx, p[1] - fcy) - fR) for p in pts)
    return fcx, fcy, fR, len(pts), resid


def trim(src, dst, dry_run=False, feather=True, report=False, force=False):
    im = Image.open(src).convert("RGBA")
    w, h = im.size
    px = im.load()

    blue = detect_palette_blue(px, w, h)
    print(f"调色板: 蓝 #{blue[0]:02x}{blue[1]:02x}{blue[2]:02x} + 白 #ffffff")

    sx = sy = n = 0
    r_max = 0.0
    for y in range(h):
        for x in range(w):
            if px[x, y][3] > 0:
                sx += x; sy += y; n += 1
    cx0, cy0 = sx / n, sy / n
    for y in range(h):
        for x in range(w):
            if px[x, y][3] > 0:
                r_max = max(r_max, math.hypot(x - cx0, y - cy0))
    r_max = math.ceil(r_max) + 2

    edges = detect_edges(px, w, h, cx0, cy0, r_max)
    known = [e for e in edges if e is not None]
    print(f"圆心初值 ({cx0:.1f}, {cy0:.1f})；外沿点 {len(known)}/{len(edges)}")
    if known:
        ks = sorted(known)
        print(f"逐角度外沿半径: 最小 {ks[0]:.1f} / 中位 {ks[len(ks) // 2]:.1f} / 最大 {ks[-1]:.1f}")

    circ = robust_circle(edges, cx0, cy0)
    if not circ:
        print("圆拟合失败：图像可能不是圆形轮廓，已中止（未修改文件）")
        return
    cx, cy, R, used, resid = circ
    print(f"稳健圆拟合: 圆心 ({cx:.2f}, {cy:.2f})  半径 {R:.2f}  采用 {used} 点  最大残差 {resid:.2f}px")

    # 已清理守卫：最外可见像素若没超出「圆 + 抗锯齿带」，说明虚环已经清干净，
    # 此时直接退出、不写文件 —— 因此重复运行不会逐次内缩，也不会产生新字节。
    r_vis = 0.0
    for y in range(h):
        for x in range(w):
            if px[x, y][3] > 0:
                r_vis = max(r_vis, math.hypot(x - cx, y - cy))
    if r_vis <= R + BAND + 0.75 and not force:
        print(f"检测到最外可见半径 {r_vis:.2f} 已在「圆 {R:.2f} + 抗锯齿带 {BAND}」之内，"
              f"无需处理（未修改文件；如需强制重绘请加 --force）")
        if dst != src:          # 便于流水线串联：指定了 --out 时按原样写出
            im.save(dst, "PNG", optimize=True)
            print(f"已按原样写出: {dst}")
        return

    removed = repainted = 0
    feathered = 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            rho = math.hypot(x - cx, y - cy)
            d = rho - R

            if d <= 0:
                if d >= -EDGE_BLUE_DEPTH:
                    # 最外一圈是 logo 的蓝色外环本体 → 强制蓝，
                    # 避免边缘出现白色描边（原先由"压两色"判成白的边界像素形成）
                    if (r, g, b) != blue or a != 255:
                        repainted += 1
                    px[x, y] = (blue[0], blue[1], blue[2], 255)
                else:
                    # 圆内深处：吸附调色板并补齐实心
                    nr, ng, nb = (r, g, b) if (r, g, b) in (WHITE, blue) else snap_to_palette((r, g, b), blue)
                    if a != 255 or (r, g, b) != (nr, ng, nb):
                        repainted += 1
                    px[x, y] = (nr, ng, nb, 255)
            elif d <= BAND and feather:
                # 边缘抗锯齿带：alpha 自 254 递减到 0（上限 <255，保证幂等）
                na = max(0, min(BAND_MAX_ALPHA, int(round(255 * (BAND - d)))))
                if a != na or (r, g, b) != blue:
                    feathered += 1
                px[x, y] = (blue[0], blue[1], blue[2], na)
                if na == 0:
                    removed += 1
            else:
                # 圆外：虚环、毛边全部清掉
                if a > 0:
                    removed += 1
                px[x, y] = (blue[0], blue[1], blue[2], 0)

    print(f"圆外清理: {removed}   边缘抗锯齿: {feathered}   圆内实心/吸附: {repainted}")
    if dry_run:
        print("dry-run：未写出文件")
        return
    im.save(dst, "PNG", optimize=True)
    print(f"已写出: {dst}")


def main():
    ap = argparse.ArgumentParser(description="修整 logo 最外圈的细小虚环")
    ap.add_argument("src", nargs="?", default="assets/images/zzkxs_icon.png")
    ap.add_argument("--out", default=None)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--no-feather", action="store_true", help="不要抗锯齿过渡，直接硬边")
    ap.add_argument("--force", action="store_true", help="即使看起来已清理也强制重绘")
    ap.add_argument("--report", action="store_true")
    args = ap.parse_args()
    trim(args.src, args.out or args.src, dry_run=args.dry_run,
         feather=not args.no_feather, report=args.report, force=args.force)


if __name__ == "__main__":
    sys.exit(main())
