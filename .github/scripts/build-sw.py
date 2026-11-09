#!/usr/bin/env python3
"""用 Closure Compiler（SIMPLE）编译 deps-sw.js。

源文件保持仓库根 deps-sw.js 不动；产物写到目标目录（如 dist/deps-sw.js）。
没有 Closure jar 时退化为复制（并打印警告），便于本地无 jar 时继续验证。

用法：
    python3 .github/scripts/build-sw.py --out dist
    CLOSURE_JAR=/path/closure.jar python3 .github/scripts/build-sw.py --out dist
"""
import argparse
import gzip
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "deps-sw.js"
CLOSURE_JAR = Path(os.environ.get("CLOSURE_JAR", "/tmp/closure-compiler.jar"))


def report(path: Path):
    raw = path.stat().st_size
    gz = len(gzip.compress(path.read_bytes(), 9))
    print("  %s: %d bytes raw / %d bytes gzip" % (path.name, raw, gz))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="dist")
    ap.add_argument("--name", default="deps-sw.min.js")
    args = ap.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    dst = out_dir / args.name

    if not SRC.exists():
        raise SystemExit("找不到源文件 %s" % SRC)

    if CLOSURE_JAR.exists():
        cmd = [
            "java", "-jar", str(CLOSURE_JAR),
            "--js", str(SRC),
            "--compilation_level", "SIMPLE",
            "--language_in", "ECMASCRIPT_2017",
            "--language_out", "ECMASCRIPT_2017",
            "--warning_level", "QUIET",
            "--js_output_file", str(dst),
        ]
        print("+ " + " ".join(cmd))
        subprocess.run(cmd, check=True)
        print("Closure 编译完成：")
    else:
        shutil.copy2(SRC, dst)
        print("警告：未找到 Closure jar（%s），已复制源码作为临时产物。" % CLOSURE_JAR)

    print("源文件：")
    report(SRC)
    print("产物：")
    report(dst)


if __name__ == "__main__":
    main()
