#!/bin/bash
# Shared helpers for local, per-user native test installations. Bash 3.2 compatible.
set -euo pipefail

native_die() { printf '错误：%s\n' "$*" >&2; exit 1; }

native_require_mac() {
  [ "$(uname -s)" = Darwin ] || native_die '此脚本只能在 macOS 上执行。'
  [ "$(uname -m)" = arm64 ] || native_die '请在 Apple Silicon Mac 的原生 ARM64 终端执行，不要使用 Rosetta。'
  [ "$(id -u)" != 0 ] || native_die '请以普通用户运行，不要使用 sudo。'
}

native_paths() {
  NATIVE_PROJECT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
  [ -f "$NATIVE_PROJECT/native/macos/Package.swift" ] || native_die '请在完整的 LarkAnything 仓库中运行脚本。'
  [ -n "${HOME:-}" ] && [ "$HOME" != / ] || native_die '用户目录无效。'
  mkdir -p "$HOME/Applications"
  NATIVE_APPLICATIONS="$(cd "$HOME/Applications" && pwd -P)"
  NATIVE_TARGET="$NATIVE_APPLICATIONS/LarkAnything Native Test.app"
  NATIVE_RECEIPT="$NATIVE_APPLICATIONS/.larkanything-native-test.receipt"
}

native_require_closed() {
  if /usr/bin/pgrep -x LarkAnything >/dev/null 2>&1; then
    native_die '请先从 LarkAnything 菜单栏选择“退出”，再重新执行。脚本不会强制中断上传。'
  fi
}

native_check_owned_target() {
  [ ! -L "$NATIVE_TARGET" ] || native_die '安装位置是符号链接，停止操作。'
  [ ! -L "$NATIVE_RECEIPT" ] || native_die '安装记录是符号链接，停止操作。'
  if [ -e "$NATIVE_TARGET" ]; then
    [ -d "$NATIVE_TARGET" ] || native_die '安装位置被其他文件占用。'
    [ -f "$NATIVE_RECEIPT" ] || native_die '同名 App 不是由本脚本安装，请先手动确认并移走。'
    [ "$(cat "$NATIVE_RECEIPT")" = 'larkanything-native-test-v1' ] || native_die '安装记录不匹配。'
    [ ! -L "$NATIVE_TARGET/Contents" ] || native_die 'App 结构异常。'
    local identifier
    identifier="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$NATIVE_TARGET/Contents/Info.plist" 2>/dev/null)" || native_die '无法读取 App 身份。'
    [ "$identifier" = 'com.larkanything.native' ] || native_die '同名 App 的身份不匹配。'
  fi
}
