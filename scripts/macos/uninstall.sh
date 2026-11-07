#!/bin/bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/common.sh"

clean_build=0
for argument in "$@"; do
  case "$argument" in
    --clean-build) clean_build=1 ;;
    --help|-h) printf '用法：bash scripts/macos/uninstall.sh [--clean-build]\n卸载脚本安装的测试 App。--clean-build 同时清理当前仓库的 Swift .build 缓存。\n保留飞书授权、配置、发布回执与原始会话。\n'; exit 0 ;;
    *) native_die "未知参数：$argument" ;;
  esac
done
native_require_mac
native_paths
native_require_closed
native_check_owned_target

if [ -d "$NATIVE_TARGET" ]; then
  # Exact fixed path beneath the resolved user Applications directory, ownership checked above.
  rm -rf -- "$NATIVE_TARGET"
  rm -f -- "$NATIVE_RECEIPT"
  printf '已卸载：%s\n' "$NATIVE_TARGET"
else
  printf '未发现脚本安装的测试 App，无需卸载。\n'
fi
if [ "$clean_build" = 1 ]; then
  parent="$(cd "$NATIVE_PROJECT/native/macos" && pwd -P)"
  [ "$parent" = "$NATIVE_PROJECT/native/macos" ] || native_die 'Swift 项目路径包含符号链接，停止清理。'
  cache="$parent/.build"
  [ ! -L "$cache" ] || native_die 'Swift 缓存是符号链接，停止清理。'
  if [ -e "$cache" ]; then rm -rf -- "$cache"; fi
  printf '已清理当前仓库的 Swift 构建缓存。\n'
fi
printf '已保留飞书授权、~/.larkanything 配置和回执，以及源会话、笔记。\n再次安装：bash scripts/macos/install.sh\n'
