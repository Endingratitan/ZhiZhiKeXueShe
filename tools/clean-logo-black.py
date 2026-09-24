#!/usr/bin/env python3
"""
去除社团 logo 中残存的黑色像素，只保留蓝色与中间白色像素。

用法：
    python3 tools/clean-logo-black.py [输入图] [--out 输出图] [--dry-run] [--mask 调试图]

默认就地把 assets/images/zzkxs_icon.png 处理干净（原文件在 git 中，可随时回退）：
    git checkout -- assets/images/zzkxs_icon.png

判定与处理规则（核心思路：先判定"黑色残留"，再按上下文决定"删掉"还是"就地补色"）：

1) 认定「黑色残留」：完全不透明的深色且几乎无色相 ——
   max(R,G,B) <= MAX_CHANNEL 且 (max-min) <= MAX_SAT。
   这样不会误伤深蓝笔画（如 #1a4a8a 饱和度 ≈112）与蓝色/白色的中间过渡色。

2) 怎么处理：
   - 若该像素 5×5 邻域里透明像素占比 >= EDGE_TRANSPARENT_RATIO
     → 它属于图形与透明背景交界的毛边，直接置为透明（去掉黑边）；
   - 否则 → 它落在图形内部（白色圆盘或蓝色笔画里），
     用邻域内"非残留、非透明"像素的中位色就地补色，
     避免在白色圆盘上留下透明小洞，也避免笔画出现黑点。

3) 其余像素（蓝色、白色及其正常的抗锯齿过渡）一律保持原样。

依赖：Pillow（pip install Pillow）
"""

import argparse
import statistics
import sys
from PIL import Image

# ---- 可调参数 ----
MAX_CHANNEL = 110          # 认定为深色：通道最大值不超过该值
MAX_SAT = 45               # 且几乎无彩色（max-min 不超过该值）
EDGE_TRANSPARENT_RATIO = 0.4   # 邻域透明占比达到该值即视为"边缘毛边"
NEIGHBORHOOD = 2           # 邻域半径（2 → 5×5）


def is_black_residue(r, g, b, a, max_channel=MAX_CHANNEL, max_sat=MAX_SAT):
    """深色 + 近乎无彩色 → 黑色残留（深蓝笔画因饱和度高出局）"""
    if a == 0:
        return False
    mx, mn = max(r, g, b), min(r, g, b)
    return mx <= max_channel and (mx - mn) <= max_sat


def local_context(px, x, y, w, h, radius=NEIGHBORHOOD):
    """返回 (透明像素数, 有效邻域像素列表[(r,g,b,a)])"""
    transparent = 0
    usable = []
    for ny in range(max(0, y - radius), min(h, y + radius + 1)):
        for nx in range(max(0, x - radius), min(w, x + radius + 1)):
            if nx == x and ny == y:
                continue
            r, g, b, a = px[nx, ny]
            if a == 0:
                transparent += 1
            elif not is_black_residue(r, g, b, a):
                usable.append((r, g, b, a))
    return transparent, usable


def clean(src, dst, dry_run=False, mask_path=None):
    im = Image.open(src).convert("RGBA")
    w, h = im.size
    px = im.load()

    # 先扫描出所有黑色残留像素（避免边处理边判定导致结果依赖顺序）
    flagged = []
    for y in range(h):
        for x in range(w):
            if is_black_residue(*px[x, y]):
                flagged.append((x, y))

    removed_edge = 0      # 置为透明
    repainted = 0         # 就地补色
    unchanged = 0

    for (x, y) in flagged:
        r, g, b, a = px[x, y]
        transparent, usable = local_context(px, x, y, w, h)
        total_neighbors = (NEIGHBORHOOD * 2 + 1) ** 2 - 1

        if not usable or transparent / total_neighbors >= EDGE_TRANSPARENT_RATIO:
            px[x, y] = (r, g, b, 0)       # 边缘毛边 → 透明
            removed_edge += 1
        else:
            # 图形内部 → 用邻域中位色补上，保持白色圆盘/蓝色笔画连续
            nr = int(statistics.median([c[0] for c in usable]))
            ng = int(statistics.median([c[1] for c in usable]))
            nb = int(statistics.median([c[2] for c in usable]))
            na = int(statistics.median([c[3] for c in usable]))
            px[x, y] = (nr, ng, nb, na)
            repainted += 1

    # 可选：输出调试图，标出被处理的像素位置
    if mask_path:
        dbg = Image.new("RGBA", (w, h), (255, 255, 255, 255))
        dp = dbg.load()
        flagged_set = set(flagged)
        for y in range(h):
            for x in range(w):
                if (x, y) in flagged_set:
                    dp[x, y] = (255, 0, 0, 255)
                else:
                    dp[x, y] = (235, 235, 235, 255)
        dbg.save(mask_path)

    print(f"输入: {src}  ({w}×{h})")
    print(f"检出黑色残留像素: {len(flagged)}")
    print(f"  ├ 边缘毛边 → 透明: {removed_edge}")
    print(f"  └ 图形内部 → 补色: {repainted}")
    print(f"未处理（蓝色/白色/正常过渡）: {w * h - len(flagged)}")

    if dry_run:
        print("dry-run：未写出文件")
        return

    im.save(dst, "PNG", optimize=True)
    print(f"已写出: {dst}")


def main():
    ap = argparse.ArgumentParser(description="去除 logo 中残存的黑色像素")
    ap.add_argument("src", nargs="?", default="assets/images/zzkxs_icon.png")
    ap.add_argument("--out", default=None, help="输出路径（默认覆盖输入）")
    ap.add_argument("--dry-run", action="store_true", help="只统计不写文件")
    ap.add_argument("--mask", default=None, help="额外输出调试图（红=被处理像素）")
    args = ap.parse_args()
    clean(args.src, args.out or args.src, dry_run=args.dry_run, mask_path=args.mask)


if __name__ == "__main__":
    sys.exit(main())
