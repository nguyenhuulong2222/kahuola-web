#!/usr/bin/env python3
"""
extract_kahuola_ai_ready.py
Kahu Ola — AI Context Extractor

Mục đích: Copy các file "xương sống" từ workspace Kahu Ola
vào thư mục KahuOla_AI_Ready để nạp vào Gemma 4 / AnythingLLM.

Tác giả: Long Nguyen · kahuola.org
Phiên bản: V4.8
"""

import os
import shutil
import json
from pathlib import Path
from datetime import datetime

# ─────────────────────────────────────────────────────────────
# CẤU HÌNH — Chỉnh sửa 2 dòng này cho phù hợp với máy bạn
# ─────────────────────────────────────────────────────────────

# Thư mục gốc dự án (điều chỉnh path theo máy của bạn)
SOURCE_DIR = Path.home() / "Documents" / "kahuola-web"

# Thư mục output AI-ready
OUTPUT_DIR = Path.home() / "Desktop" / "KahuOla_AI_Ready"

# ─────────────────────────────────────────────────────────────
# TIÊU CHÍ LỌC FILE
# ─────────────────────────────────────────────────────────────

# Extensions được giữ lại
ALLOWED_EXTENSIONS = {
    ".js",      # Logic map, UI, hazard modules
    ".ts",      # Cloudflare Worker TypeScript
    ".json",    # n8n workflows, config, wrangler
    ".html",    # Pages: index, live-map, storm, maui
    ".css",     # Styles
    ".dart",    # Flutter mobile app
    ".md",      # Doctrine, README, progress docs
    ".yaml",    # wrangler.toml alt, pubspec, GitHub Actions
    ".yml",     # GitHub Actions workflows
    ".toml",    # wrangler.toml (Cloudflare Worker config)
    ".txt",     # Manifest, system invariants
}

# Thư mục bị loại bỏ hoàn toàn (không đi sâu vào)
EXCLUDED_DIRS = {
    "node_modules",
    "build",
    "dist",
    ".git",
    ".dart_tool",
    ".flutter-plugins",
    ".idea",
    "__pycache__",
    ".cache",
    "tmp_compare",      # Temp folder trong kahuola-web
    ".wrangler",        # Wrangler cache
    "coverage",
}

# File bị loại bỏ theo tên chính xác
EXCLUDED_FILES = {
    "package-lock.json",
    "pubspec.lock",
    "yarn.lock",
    ".DS_Store",
    "Thumbs.db",
}

# Extensions bị loại bỏ
EXCLUDED_EXTENSIONS = {
    ".map",         # Source maps — không có giá trị cho AI
    ".lock",        # Lock files
    ".log",         # Logs
    ".png",         # Images — AI text model không cần
    ".jpg",
    ".jpeg",
    ".gif",
    ".svg",         # Icons/images (trừ khi là architecture diagrams)
    ".ico",
    ".zip",
    ".tar",
    ".gz",
    ".woff",
    ".woff2",
    ".ttf",
    ".eot",
}

# ─────────────────────────────────────────────────────────────
# THƯ MỤC ƯU TIÊN — Copy trước, hiển thị ở đầu manifest
# ─────────────────────────────────────────────────────────────

PRIORITY_DIRS = [
    "worker",           # Cloudflare Worker (src/index.ts) — CORE
    "functions",        # Cloudflare Pages Functions
    "src",              # Worker source TypeScript
    "lib",              # Flutter Dart code
    "scripts",          # Daily video pipeline, automation
    "docs",             # Doctrine, architecture docs
]

# ─────────────────────────────────────────────────────────────
# GUARD BẢO MẬT — Các pattern cần cảnh báo trước khi copy
# ─────────────────────────────────────────────────────────────

SENSITIVE_PATTERNS = [
    "API_KEY",
    "SECRET",
    "TOKEN",
    "PASSWORD",
    "PRIVATE",
    "_KEY=",
    "Authorization:",
]


def is_likely_sensitive(file_path: Path) -> bool:
    """Kiểm tra file có thể chứa secrets không."""
    sensitive_names = {
        ".env",
        ".env.local",
        ".env.production",
        "secrets.json",
        "service-account.json",
        "google-services.json",
        "GoogleService-Info.plist",
    }
    return file_path.name in sensitive_names


def should_include_file(file_path: Path) -> tuple[bool, str]:
    """
    Quyết định có copy file này không.
    Returns: (include: bool, reason: str)
    """
    # Kiểm tra tên file bị loại bỏ
    if file_path.name in EXCLUDED_FILES:
        return False, f"excluded filename: {file_path.name}"

    # Kiểm tra extension bị loại bỏ
    if file_path.suffix.lower() in EXCLUDED_EXTENSIONS:
        return False, f"excluded extension: {file_path.suffix}"

    # Kiểm tra file nhạy cảm (secrets)
    if is_likely_sensitive(file_path):
        return False, f"SECURITY: likely contains secrets — {file_path.name}"

    # Kiểm tra extension được phép
    if file_path.suffix.lower() not in ALLOWED_EXTENSIONS:
        return False, f"not in allowed extensions: {file_path.suffix}"

    return True, "ok"


def should_enter_dir(dir_path: Path) -> bool:
    """Có đi vào thư mục này không."""
    return dir_path.name not in EXCLUDED_DIRS


def scan_for_sensitive_content(file_path: Path) -> list[str]:
    """Scan nhanh file text xem có pattern nhạy cảm không."""
    warnings = []
    try:
        content = file_path.read_text(encoding="utf-8", errors="ignore")
        for pattern in SENSITIVE_PATTERNS:
            if pattern in content:
                warnings.append(pattern)
    except Exception:
        pass
    return warnings


def collect_files(source_dir: Path) -> list[dict]:
    """
    Thu thập tất cả files theo thứ tự ưu tiên.
    Returns list of {path, relative, priority}
    """
    collected = []
    seen = set()

    def walk_dir(directory: Path, priority: bool = False):
        try:
            entries = sorted(directory.iterdir(), key=lambda x: (x.is_file(), x.name))
        except PermissionError:
            return

        for entry in entries:
            if entry.is_dir():
                if should_enter_dir(entry):
                    walk_dir(entry, priority)
            elif entry.is_file():
                rel = entry.relative_to(source_dir)
                rel_str = str(rel)

                if rel_str in seen:
                    continue
                seen.add(rel_str)

                include, reason = should_include_file(entry)
                if include:
                    collected.append({
                        "path": entry,
                        "relative": rel,
                        "priority": priority,
                        "size": entry.stat().st_size,
                    })

    # Ưu tiên các thư mục quan trọng trước
    for pdir in PRIORITY_DIRS:
        priority_path = source_dir / pdir
        if priority_path.exists():
            walk_dir(priority_path, priority=True)

    # Sau đó phần còn lại (root level và các thư mục khác)
    walk_dir(source_dir, priority=False)

    # Deduplicate giữ thứ tự
    final = []
    seen_final = set()
    for item in collected:
        key = str(item["relative"])
        if key not in seen_final:
            seen_final.add(key)
            final.append(item)

    return final


def write_manifest(output_dir: Path, files: list[dict], stats: dict):
    """Tạo file manifest JSON để AnythingLLM biết cấu trúc."""
    manifest = {
        "project": "Kahu Ola V4.8",
        "purpose": "AI context extraction for Gemma 4 / AnythingLLM",
        "generated_at": datetime.now().isoformat(),
        "stats": stats,
        "architecture_invariants": [
            "I: Client never calls upstream APIs directly",
            "II: UI renders under all failure conditions",
            "III: Parse fail → DROP data, never infer",
            "IV: Zero PII — user location on device only",
            "V: Estimated perimeter ≠ official",
        ],
        "priority_modules": PRIORITY_DIRS,
        "files": [
            {
                "path": str(f["relative"]),
                "priority": f["priority"],
                "size_bytes": f["size"],
            }
            for f in files
        ],
    }

    manifest_path = output_dir / "_MANIFEST.json"
    manifest_path.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False),
        encoding="utf-8"
    )
    return manifest_path


def write_doctrine_header(output_dir: Path):
    """Tạo file CONTEXT.md giúp AI hiểu ngay khi load."""
    content = """# Kahu Ola — AI Context Primer

## Hệ thống là gì?
Kahu Ola ("Guardian of Life") là civic hazard intelligence platform cho Hawaiʻi.
Aggregates dữ liệu công khai từ NASA FIRMS, NWS, NOAA, EPA, USGS, PacIOOS
để cung cấp situational awareness về wildfire, flood, storm, air quality.

## Stack kỹ thuật
- **Backend:** Cloudflare Worker (TypeScript) tại `worker/src/index.ts`
- **Frontend:** GitHub Pages (HTML/JS/CSS) — `index.html`, `live-map.html`
- **Mobile:** Flutter (Dart) tại `mobile/flutter/lib/`
- **Automation:** n8n workflows + OpenClaw (Mac Mini M4)
- **Deploy domain:** kahuola.org

## 5 Invariants KHÔNG được vi phạm
1. Browser KHÔNG BAO GIỜ gọi trực tiếp NASA/NOAA/NWS/EPA/USGS
2. UI render dưới MỌI điều kiện failure — không blank screen
3. Parse fail → DROP data, return [], không infer
4. Zero PII — user location chỉ trên device
5. Perimeter estimated ≠ official — luôn hiển thị disclaimer

## Luồng data
```
NASA FIRMS / NWS / NOAA / EPA
    ↓
Cloudflare Worker (/api/*)
    ↓
Browser (kahuola.org)
```

## Các endpoint chính
- `/api/firms/hotspots` — NASA FIRMS wildfire hotspots
- `/api/hazards/flash-flood` — NWS flash flood alerts
- `/api/hazards/fire-weather` — NWS Red Flag warnings
- `/api/hazards/tsunami` — NWS Tsunami warnings
- `/api/hazards/mrms-qpe` — Rainfall QPE
- `/api/tiles/xyz/airnow/{z}/{x}/{y}` — AirNow tiles

## Canonical Signals
- **FireSignal** — wildfire thermal detections
- **SmokeSignal** — satellite smoke plumes
- **Perimeter** — fire boundaries (official vs estimated)

## File quan trọng nhất
- `worker/src/index.ts` — Toàn bộ business logic backend
- `live-map.html` — Hazard map UI (12 modules)
- `index.html` — Dashboard chính
- `scripts/` — Video pipeline + automation

*Kahu Ola V4.8 — kahuola.org*
"""
    (output_dir / "_CONTEXT.md").write_text(content, encoding="utf-8")


def main():
    print("=" * 60)
    print("  Kahu Ola — AI Context Extractor V4.8")
    print("=" * 60)

    # Kiểm tra source dir tồn tại
    if not SOURCE_DIR.exists():
        print(f"\n❌ Không tìm thấy thư mục nguồn: {SOURCE_DIR}")
        print("   Hãy chỉnh sửa biến SOURCE_DIR trong script.")
        return

    print(f"\n📂 Nguồn:  {SOURCE_DIR}")
    print(f"📦 Output: {OUTPUT_DIR}")

    # Tạo output dir
    if OUTPUT_DIR.exists():
        print(f"\n⚠️  Thư mục output đã tồn tại — sẽ xóa và tạo lại.")
        shutil.rmtree(OUTPUT_DIR)
    OUTPUT_DIR.mkdir(parents=True)

    # Thu thập files
    print("\n🔍 Đang quét file...")
    files = collect_files(SOURCE_DIR)

    # Copy files + security scan
    print(f"📋 Tìm thấy {len(files)} file hợp lệ. Đang copy...\n")

    copied = 0
    skipped_sensitive = []
    total_size = 0

    for item in files:
        src = item["path"]
        rel = item["relative"]
        dest = OUTPUT_DIR / rel

        # Security scan
        warnings = scan_for_sensitive_content(src)
        if warnings:
            print(f"  ⚠️  SECURITY WARNING — {rel}")
            print(f"     Patterns tìm thấy: {', '.join(warnings)}")
            print(f"     File này VẪN được copy nhưng hãy kiểm tra trước khi share.")

        # Tạo thư mục đích
        dest.parent.mkdir(parents=True, exist_ok=True)

        # Copy
        shutil.copy2(src, dest)
        copied += 1
        total_size += item["size"]

        # Progress indicator mỗi 20 files
        if copied % 20 == 0:
            print(f"  ... đã copy {copied}/{len(files)} files")

    # Stats
    stats = {
        "total_files": copied,
        "total_size_bytes": total_size,
        "total_size_kb": round(total_size / 1024, 1),
        "priority_files": sum(1 for f in files if f["priority"]),
        "skipped_sensitive": len(skipped_sensitive),
    }

    # Tạo manifest + context
    write_doctrine_header(OUTPUT_DIR)
    manifest_path = write_manifest(OUTPUT_DIR, files, stats)

    # Summary
    print("\n" + "=" * 60)
    print("  ✅ HOÀN TẤT")
    print("=" * 60)
    print(f"  Files đã copy:   {copied}")
    print(f"  Tổng dung lượng: {stats['total_size_kb']} KB")
    print(f"  Priority files:  {stats['priority_files']}")
    print(f"  Manifest:        {manifest_path}")
    print(f"\n  📁 Output: {OUTPUT_DIR}")
    print("\n  🔒 Nhớ kiểm tra các file có SECURITY WARNING")
    print("     trước khi upload lên AnythingLLM / Gemma 4.")
    print("=" * 60)


if __name__ == "__main__":
    main()
