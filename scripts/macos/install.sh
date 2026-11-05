#!/bin/bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/common.sh"

launch=1
for argument in "$@"; do
  case "$argument" in
    --no-open) launch=0 ;;
    --help|-h) printf '用法：bash scripts/macos/install.sh [--no-open]\n安装依赖、运行测试、构建并安装到 ~/Applications/LarkAnything Native Test.app。\n'; exit 0 ;;
    *) native_die "未知参数：$argument" ;;
  esac
done
native_require_mac
native_paths
native_require_closed
native_check_owned_target
command -v node >/dev/null 2>&1 || native_die '请先安装 nodejs.org 的 macOS ARM64 Node.js 22+。'
command -v npm >/dev/null 2>&1 || native_die '找不到 npm，请检查 Node.js 安装。'
node -e 'if (process.arch !== "arm64" || Number(process.versions.node.split(".")[0]) < 22) process.exit(1)' || native_die '需要 ARM64 Node.js 22 或更新版本。'
/usr/bin/xcrun --find swift >/dev/null 2>&1 || native_die '请安装 Xcode 并完成首次启动，再选择其开发者工具。'

cd "$NATIVE_PROJECT"
printf '\n[1/4] 安装锁定的生产依赖\n'
npm ci --omit=dev --ignore-scripts
printf '\n[2/4] 运行测试\n'
npm test
printf '\n[3/4] 构建原生 App\n'
mkdir -p .larkanything/releases
log="$(mktemp "$NATIVE_PROJECT/.larkanything/releases/install-log.XXXXXX")"
npm run native:build 2>&1 | tee "$log"
bundle="$(sed -n 's/^App: //p' "$log" | tail -n 1)"
case "$bundle" in
  "$NATIVE_PROJECT"/.larkanything/releases/native-*/LarkAnything.app) ;;
  *) native_die "构建没有返回预期的 App 路径。日志：$log" ;;
esac
[ -d "$bundle" ] && [ ! -L "$bundle" ] || native_die '构建产物不存在或是符号链接。'
/usr/bin/codesign --verify --deep --strict "$bundle"

printf '\n[4/4] 安装到用户 Applications\n'
# Build completes before replacing the old installation. Roll back on move failure.
native_require_closed
native_check_owned_target
stage="$(mktemp -d "$NATIVE_APPLICATIONS/.larkanything-native.XXXXXX")"
cleanup() {
  if [ -d "$stage/previous.app" ] && [ ! -e "$NATIVE_TARGET" ]; then
    mv "$stage/previous.app" "$NATIVE_TARGET" || return
  fi
  case "$stage" in "$NATIVE_APPLICATIONS"/.larkanything-native.*) rm -rf -- "$stage" ;; esac
}
trap cleanup EXIT
/usr/bin/ditto "$bundle" "$stage/new.app"
/usr/bin/codesign --verify --deep --strict "$stage/new.app"
printf 'larkanything-native-test-v1\n' > "$stage/receipt"
if [ -d "$NATIVE_TARGET" ]; then mv "$NATIVE_TARGET" "$stage/previous.app"; fi
mv "$stage/new.app" "$NATIVE_TARGET"
mv "$stage/receipt" "$NATIVE_RECEIPT"
printf '\n安装完成：%s\n配置、授权与发布回执继续复用。\n构建日志：%s\n' "$NATIVE_TARGET" "$log"
if [ "$launch" = 1 ]; then /usr/bin/open "$NATIVE_TARGET"; fi
