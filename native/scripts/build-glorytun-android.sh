#!/usr/bin/env bash
set -euo pipefail

# Builds a static-PIE arm64 glorytun with MeshLink's Android shims and installs
# it to jniLibs (the only dir Android grants exec permission on targetSdk >= 29).
#
# v0.3.4 links -lsodium and pulls sources from argz/ + mud/ + mud/aegis256/ + src/.
# Its Makefile's cross mechanism targets musl-cross toolchains, not the NDK, so we
# bypass it and drive NDK clang directly. Requires: ANDROID_NDK_HOME, git, curl, make.
# Run from the repo root AFTER `npx cap add android`.

GLORYTUN_REPO="https://github.com/angt/glorytun.git"
GLORYTUN_TAG="v0.3.4"                 # PINNED — the patcher targets this tree
LIBSODIUM_TARBALL="https://download.libsodium.org/libsodium/releases/libsodium-1.0.20-stable.tar.gz"
API=29
OUT_DIR="android/app/src/main/jniLibs/arm64-v8a"
WORK="$(mktemp -d)"
ROOT="$(pwd)"

trap 'rm -rf "$WORK"' EXIT

[ -n "${ANDROID_NDK_HOME:-}" ] || { echo "!! ANDROID_NDK_HOME not set"; exit 1; }

TOOLCHAIN="$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64"
CC="$TOOLCHAIN/bin/aarch64-linux-android${API}-clang"
[ -x "$CC" ] || { echo "!! NDK clang not found at $CC"; exit 1; }

# ---------------------------------------------------------------- libsodium
echo "==> Building libsodium (arm64, static) via official NDK script"
cd "$WORK"
curl -fsSL "$LIBSODIUM_TARBALL" -o libsodium.tar.gz
tar xzf libsodium.tar.gz
cd libsodium-stable
# android-armv8-a.sh reads ANDROID_NDK_HOME and emits a static libsodium.a
# into ./libsodium-android-armv8-a+crypto/{lib,include}.
ANDROID_NDK_HOME="$ANDROID_NDK_HOME" ./dist-build/android-armv8-a.sh

SODIUM_A="$(find "$WORK/libsodium-stable" -name libsodium.a | head -1)"
[ -n "$SODIUM_A" ] || { echo "!! libsodium.a not produced"; exit 1; }
SODIUM_INC="$(dirname "$(dirname "$SODIUM_A")")/include"
echo "   libsodium.a -> $SODIUM_A"
echo "   headers     -> $SODIUM_INC"

# ---------------------------------------------------------------- glorytun
echo "==> Cloning glorytun $GLORYTUN_TAG (+ submodules)"
cd "$WORK"
git clone --depth 1 --branch "$GLORYTUN_TAG" --recurse-submodules \
    "$GLORYTUN_REPO" glorytun
cd glorytun

echo "==> Applying MeshLink Android shims"
python3 "$ROOT/native/scripts/patch-glorytun.py"

echo "==> Compiling glorytun with NDK clang (static-PIE, armv8-a+crypto)"
# aegis256 uses ARM crypto extensions; the S26 Ultra has them. static-PIE is
# required because Android's linker rejects non-PIE main executables on API 29+.
"$CC" \
    -std=c11 -O2 -fPIC -fPIE -static-pie \
    -march=armv8-a+crypto \
    -fstack-protector-strong \
    -DPACKAGE_NAME='"glorytun"' \
    -DPACKAGE_VERSION='"v0.3.4-meshlink"' \
    -I. -Iargz -Imud -Imud/aegis256 -Isrc -I"$SODIUM_INC" \
    argz/argz.c mud/mud.c mud/aegis256/aegis256.c src/*.c \
    "$SODIUM_A" \
    -o glorytun

echo "==> Verifying binary"
file glorytun | grep -q "aarch64" || { echo "!! not aarch64"; exit 1; }

echo "==> Installing to $OUT_DIR/libglorytun.so"
mkdir -p "$ROOT/$OUT_DIR"
cp glorytun "$ROOT/$OUT_DIR/libglorytun.so"
chmod 755 "$ROOT/$OUT_DIR/libglorytun.so"

echo "==> Done."
