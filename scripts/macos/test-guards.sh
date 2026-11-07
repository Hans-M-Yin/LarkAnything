#!/bin/bash
# Portable guard tests; no installed apps or real user configuration are touched.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/common.sh"
temp="$(mktemp -d)"
trap 'rm -rf -- "$temp"' EXIT
NATIVE_TARGET="$temp/Test.app"
NATIVE_RECEIPT="$temp/receipt"
native_check_owned_target
mkdir "$NATIVE_TARGET"
if (native_check_owned_target) 2>/dev/null; then native_die '未识别的 App 应被拒绝。'; fi
printf 'unrelated\n' > "$NATIVE_RECEIPT"
if (native_check_owned_target) 2>/dev/null; then native_die '不匹配的安装记录应被拒绝。'; fi
printf 'larkanything-native-test-v1\n' > "$NATIVE_RECEIPT"
mkdir "$NATIVE_TARGET/Contents"
if (native_check_owned_target) 2>/dev/null; then native_die '无有效 Info.plist 的 App 应被拒绝。'; fi
printf 'Guard tests passed: missing target, unowned app, wrong receipt, invalid bundle.\n'
