#!/usr/bin/env python3
"""文章索引生成器：由 articles/*/info.json 生成栏目 index.json 与 important 索引。

用法（仓库根目录）：
    python3 .github/scripts/art-idx.py --write

规则：
- 只处理 articles/<slug>/info.json；slug 须匹配 ^[a-z0-9][a-z0-9-]*$
- 只处理在 articles/art-idx.config 的 columns 中声明的栏目；未声明的栏目跳过并提示
- draft 文章不进入任何索引
- 栏目索引字段：schema / column / generated_at / important_index / articles（仅路径名，date 倒序）
- important 为可选的小写连字符字符串；写入该栏目的 <name>-important.json
- 使用 git ls-files 枚举；无 git 时退回 glob
"""
import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONFIG_PATH = ROOT / "articles" / "art-idx.config"
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")
IMPORTANT_RE = re.compile(r"^[A-Z0-9][A-Z0-9-]*$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def load_config():
    if not CONFIG_PATH.exists():
        raise SystemExit(f"缺少配置：{CONFIG_PATH}")
    try:
        cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"配置不是合法 JSON：{exc}")
    columns = cfg.get("columns")
    if not isinstance(columns, dict) or not columns:
        raise SystemExit("配置缺少 columns 键值对")
    for column, index_path in columns.items():
        if not isinstance(column, str) or not column.strip():
            raise SystemExit("columns 存在空栏目名")
        if not isinstance(index_path, str) or not index_path.startswith("articles/"):
            raise SystemExit(f"栏目 {column} 的索引路径须为 articles/ 下相对路径")
    return cfg


def list_info_files():
    try:
        out = subprocess.run(
            ["git", "ls-files", "articles/*/info.json"],
            cwd=str(ROOT), capture_output=True, text=True, check=True
        ).stdout
        files = [ROOT / line.strip() for line in out.splitlines() if line.strip()]
        if files:
            return files
    except (subprocess.CalledProcessError, FileNotFoundError):
        pass
    return sorted((ROOT / "articles").glob("*/info.json"))


def important_path_for(index_path):
    p = Path(index_path)
    stem = p.stem
    name = (stem[len("index-"):] if stem.startswith("index-") else stem) + "-important.json"
    return str(p.parent / name)


def parse_date(slug, info):
    date = info.get("date")
    if not isinstance(date, str) or not DATE_RE.match(date):
        raise SystemExit(f"{slug}/info.json 的 date 非法：{date!r}")
    return date


def main():
    parser = argparse.ArgumentParser(description="生成文章栏目索引")
    parser.add_argument("--write", action="store_true", help="写入 JSON（默认只预览）")
    args = parser.parse_args()

    config = load_config()
    columns = config["columns"]
    groups = {column: [] for column in columns}
    important_groups = {column: [] for column in columns}
    skipped = []

    for info_path in list_info_files():
        slug = info_path.parent.name
        rel = info_path.relative_to(ROOT).as_posix()
        if not SLUG_RE.match(slug):
            raise SystemExit(f"非法文章目录名：{slug}")
        try:
            info = json.loads(info_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise SystemExit(f"{rel} 不是合法 JSON：{exc}")
        column = info.get("column")
        if column not in columns:
            skipped.append(f"{slug}（栏目 {column!r} 未在 config 声明）")
            continue
        if not (info_path.parent / "article.md").exists():
            raise SystemExit(f"{slug} 缺少 article.md")
        date = parse_date(slug, info)
        if info.get("draft") is True:
            continue
        item = {"slug": slug, "date": date, "title": str(info.get("title") or "")}
        groups[column].append(item)
        important = info.get("important")
        if important is not None:
            if not isinstance(important, str) or not IMPORTANT_RE.match(important):
                raise SystemExit(f"{slug}/info.json 的 important 须为大写连字符字符串（如 CUPT）：{important!r}")
            important_groups[column].append(item)
        cover = info.get("cover")
        if cover and not (info_path.parent / cover).exists():
            print(f"WARN: {slug} 的 cover 不存在：{cover}", file=sys.stderr)

    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    changed = []
    for column, index_path in columns.items():
        items = sorted(groups[column], key=lambda x: (x["date"], x["slug"]), reverse=True)
        imp_items = sorted(important_groups[column], key=lambda x: (x["date"], x["slug"]), reverse=True)
        imp_path = important_path_for(index_path)
        index_obj = {
            "schema": 1,
            "column": column,
            "generated_at": now,
            "important_index": imp_path,
            "articles": [x["slug"] for x in items],
        }
        imp_obj = {
            "schema": 1,
            "column": column,
            "generated_at": now,
            "articles": [x["slug"] for x in imp_items],
        }
        for path, obj in ((index_path, index_obj), (imp_path, imp_obj)):
            target = ROOT / path
            text = json.dumps(obj, ensure_ascii=False, indent=2) + "\n"
            old = target.read_text(encoding="utf-8") if target.exists() else None
            # generated_at 每次都会变；内容对比时忽略时间戳
            def strip_ts(data):
                if data is None:
                    return None
                try:
                    d = json.loads(data)
                except json.JSONDecodeError:
                    return data
                d.pop("generated_at", None)
                return d
            if strip_ts(old) != strip_ts(text):
                changed.append(path)
                if args.write:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_text(text, encoding="utf-8", newline="\n")
                print(("WRITE " if args.write else "PLAN  ") + f"{path}: {len(obj['articles'])} 篇")
            else:
                print(f"OK    {path}: 无变化")

    if skipped:
        print("跳过未声明栏目：" + "；".join(skipped), file=sys.stderr)
    if args.write:
        print(f"更新 {len(set(changed))} 个文件；时间戳 {now}")
    else:
        print(f"预览完成；将有 {len(changed)} 个文件变化（加 --write 写入）")


if __name__ == "__main__":
    main()
