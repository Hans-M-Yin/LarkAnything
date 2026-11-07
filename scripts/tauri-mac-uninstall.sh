#!/usr/bin/env bash
set -euo pipefail
app='/Applications/LarkAnything.app'
if [[ -L "$app" ]]; then echo '拒绝删除符号链接，请手动检查。'; exit 1; fi
if [[ -d "$app" ]]; then
  id=$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$app/Contents/Info.plist")
  [[ "$id" == 'com.larkanything.desktop' ]] || { echo '此路径不是 Tauri 版 LarkAnything，请手动确认。'; exit 1; }
  if pgrep -f "$app/Contents/MacOS/" >/dev/null; then echo '请先退出 LarkAnything。'; exit 1; fi
  rm -rf -- "$app"
fi
echo 'App 及其内置 CLI 已卸载。用户配置、导出回执和独立安装的 CLI 均保留。'
