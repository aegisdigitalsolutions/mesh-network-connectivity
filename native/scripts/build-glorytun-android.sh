#!/usr/bin/env bash
set -euo pipefail

# Builds static arm64 glorytun with Android patches; installs to jniLibs
# (the only location Android grants exec permission on targetSdk >= 29).
# Requires: ANDROID_NDK_HOME, git, make. Run from repo root after `cap add android`.

GLORYTUN_REPO="https://github.com/angt/glorytun.git"
GLORYTUN_TAG="v0.3.4"                       # PINNED — patches target this tag
API=29
ABI=aarch64-linux-android
OUT_DIR="android/app/src/main/jniLibs/arm64-v8a"
WORK="$(mktemp -d)"
ROOT="$(pwd)"

trap 'rm -rf "$WORK"' EXIT

[ -n "${ANDROID_NDK_HOME:-}" ] || { echo "ANDROID_NDK_HOME not set"; exit 1; }

TOOLCHAIN="$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64"
export CC="$TOOLCHAIN/bin/${ABI}${API}-clang"
export CFLAGS="-Os -fPIE"
export LDFLAGS="-static-pie"

echo "==> Cloning glorytun $GLORYTUN_TAG"
git clone --depth 1 --branch "$GLORYTUN_TAG" --recurse-submodules \
    "$GLORYTUN_REPO" "$WORK/glorytun"
cd "$WORK/glorytun"

echo "==> Applying Android patches"
for p in "$ROOT"/native/patches/glorytun-android-fd.patch \
         "$ROOT"/native/patches/glorytun-mud-fd-helper.patch; do
    if [ -f "$p" ]; then
        echo "    applying $(basename "$p")"
        git apply --3way --whitespace=fix "$p" || {
            echo "!! Patch failed to apply cleanly: $p"
            echo "!! Rebase the hunks against $GLORYTUN_TAG and retry."
            exit 1
        }
    fi
done

echo "==> Building"
make -j"$(nproc)" CC="$CC" CFLAGS="$CFLAGS" LDFLAGS="$LDFLAGS"

echo "==> Verifying static arm64 binary"
file glorytun | grep -q "aarch64" || { echo "!! not aarch64"; exit 1; }

echo "==> Installing to $OUT_DIR/libglorytun.so"
mkdir -p "$ROOT/$OUT_DIR"
cp glorytun "$ROOT/$OUT_DIR/libglorytun.so"
chmod 755 "$ROOT/$OUT_DIR/libglorytun.so"

echo "==> Done."
