#!/usr/bin/env python3
"""站点回归入口：可选先构建，再调用 check-site.js（本地、离线、<90s）。"""
import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dist', default='dist')
    ap.add_argument('--build', action='store_true', help='先跑 build.py --minify')
    ap.add_argument('--browser', default='')
    args = ap.parse_args()

    if args.build:
        subprocess.run([sys.executable, str(ROOT / '.github/scripts/build.py'), '--out', args.dist, '--minify'], check=True, cwd=ROOT)
        subprocess.run([sys.executable, str(ROOT / 'tools/build-sw.py'), '--out', args.dist], check=True, cwd=ROOT)

    cmd = ['node', str(ROOT / '.github/scripts/check-site.js'), '--dist', str(ROOT / args.dist)]
    if args.browser:
        cmd += ['--browser', args.browser]
    rc = subprocess.run(cmd, cwd=ROOT).returncode
    # 清理可能残留的临时 profile（浏览器进程退出有延迟）
    import glob, shutil, time
    time.sleep(1.5)
    for d in glob.glob(str(ROOT / '.checkprofile-*')):
        shutil.rmtree(d, ignore_errors=True)
    return rc


if __name__ == '__main__':
    sys.exit(main())
