#!/usr/bin/env bash
#
# Cross-compile glorytun for Android arm64-v8a using the NDK, and place it where
# Android will extract it as an executable (jniLibs/<abi>/libglorytun.so).
#
# Runs in CI (see .github/workflows/build-apk.yml) AFTER `cap add android`.
# Requires: $ANDROID_NDK_HOME (setup-android provides it), git, meson, ninja.
#
# ============================================================================
# HONEST STATUS (see native/HANDOFF.md):
# This script compiles UPSTREAM glorytun, which opens its own tun device and will
# NOT work unrooted on Android as-is. The next environment must apply the "external
# fd" patch (native/patches/glorytun-android-fd.patch - TO BE WRITTEN) before this
# binary is functional. The compile itself is correct; the source needs the patch.
# ============================================================================
set -euo pipefail

ABI="arm64-v8a"
API=24
NDK="${ANDROID_NDK_HOME:?ANDROID_NDK_HOME not set}"
TOOLCHAIN="$NDK/toolchains/llvm/prebuilt/linux-x86_64"
TARGET="aarch64-linux-android"

export AR="$TOOLCHAIN/bin/llvm-ar"
export CC="$TOOLCHAIN/bin/${TARGET}${API}-clang"
export CXX="$TOOLCHAIN/bin/${TARGET}${API}-clang++"
export STRIP="$TOOLCHAIN/bin/llvm-strip"

WORK="$(mktemp -d)"
echo "Working in $WORK"
cd "$WORK"

git clone --recursive https://github.com/angt/glorytun.git
cd glorytun

# --- PATCH HOOK -------------------------------------------------------------
# If the external-fd patch exists in the repo, apply it here.
PATCH="$GITHUB_WORKSPACE/native/patches/glorytun-android-fd.patch"
if [ -f "$PATCH" ]; then
  echo "Applying Android fd patch..."
  git apply "$PATCH"
else
  echo "WARNING: no Android fd patch found - binary will compile but not function unrooted."
fi
# ---------------------------------------------------------------------------

cat > android-cross.txt <<EOF
[binaries]
c = '$CC'
ar = '$AR'
strip = '$STRIP'

[host_machine]
system = 'android'
cpu_family = 'aarch64'
cpu = 'aarch64'
endian = 'little'
EOF

meson setup build --cross-file android-cross.txt --buildtype release
ninja -C build

OUT="$GITHUB_WORKSPACE/android/app/src/main/jniLibs/$ABI"
mkdir -p "$OUT"
cp build/glorytun "$OUT/libglorytun.so"
"$STRIP" "$OUT/libglorytun.so" || true
echo "glorytun -> $OUT/libglorytun.so"
ls -la "$OUT"
