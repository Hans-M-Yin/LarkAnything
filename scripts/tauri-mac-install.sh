#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
command -v cargo >/dev/null || { echo '请先安装 Rust：https://rustup.rs'; exit 1; }
xcrun --find clang >/dev/null
python3 -m venv .larkanything/dmg-venv
source .larkanything/dmg-venv/bin/activate
python3 -m pip install -r scripts/macos-dmg-requirements.txt
npm ci
APPLE_SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:--}" npm run desktop:package:mac -- --target aarch64-apple-darwin
echo 'DMG 已生成于 src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/'
echo '打开 DMG 并将 LarkAnything 拖入 Applications。安装包已包含飞书 CLI。'
open src-tauri/target/aarch64-apple-darwin/release/bundle/dmg
