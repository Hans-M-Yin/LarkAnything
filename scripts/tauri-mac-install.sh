#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
command -v cargo >/dev/null || { echo '请先安装 Rust：https://rustup.rs'; exit 1; }
xcrun --find clang >/dev/null
npm ci
npm run desktop:package:mac -- --target aarch64-apple-darwin
echo 'DMG 已生成于 src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/'
echo '打开 DMG 并将 LarkAnything 拖入 Applications。飞书 CLI 单独保留。'
open src-tauri/target/aarch64-apple-darwin/release/bundle/dmg
