#!/usr/bin/env bash
set -euo pipefail
mobile="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
sdk="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
[[ -n "$sdk" ]] || { printf '%s\n' "Set ANDROID_SDK_ROOT." >&2; exit 1; }
ndk="${ANDROID_NDK_HOME:-$sdk/ndk/27.3.13750724}"
case "$(uname -s)" in
  Linux) host=linux-x86_64 ;;
  Darwin) host=darwin-x86_64 ;;
  *) printf '%s\n' "Unsupported NDK build host." >&2; exit 1 ;;
esac
tools="$ndk/toolchains/llvm/prebuilt/$host/bin"
[[ -x "$tools/aarch64-linux-android30-clang" ]] || { printf '%s\n' "Install NDK 27.3.13750724 or set ANDROID_NDK_HOME." >&2; exit 1; }
export CARGO_TARGET_DIR="$mobile/build/rust"
export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="$tools/aarch64-linux-android30-clang"
export CARGO_TARGET_X86_64_LINUX_ANDROID_LINKER="$tools/x86_64-linux-android30-clang"
export CC_aarch64_linux_android="$tools/aarch64-linux-android30-clang"
export CC_x86_64_linux_android="$tools/x86_64-linux-android30-clang"
export AR_aarch64_linux_android="$tools/llvm-ar"
export AR_x86_64_linux_android="$tools/llvm-ar"
export CARGO_TARGET_AARCH64_LINUX_ANDROID_RUSTFLAGS="-C link-arg=-Wl,-z,max-page-size=16384"
export CARGO_TARGET_X86_64_LINUX_ANDROID_RUSTFLAGS="-C link-arg=-Wl,-z,max-page-size=16384"
for target in aarch64-linux-android x86_64-linux-android; do
  rustup target list --installed | grep -qx "$target" || {
    printf 'Missing Rust target; run: rustup target add %s\n' "$target" >&2; exit 1;
  }
done
for entry in "aarch64-linux-android:arm64-v8a" "x86_64-linux-android:x86_64"; do
  target="${entry%%:*}"
  abi="${entry#*:}"
  cargo build --locked --release --manifest-path "$mobile/rust-bridge/Cargo.toml" --target "$target"
  library="$CARGO_TARGET_DIR/$target/release/libslop_mobile_bridge.so"
  "$tools/llvm-nm" --dynamic --defined-only "$library" |
    grep -q ' Java_com_threadkeeper_slopgrenade_core_NativeCore_request$' || {
      printf '%s\n' "Native bridge is not bindable: required JNI request export is missing." >&2
      exit 1
    }
  mkdir -p "$mobile/app/src/main/jniLibs/$abi"
  cp -- "$library" "$mobile/app/src/main/jniLibs/$abi/"
done
