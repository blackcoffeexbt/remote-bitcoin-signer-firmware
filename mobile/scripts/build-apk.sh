#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
if [ ! -f android/gradlew ]; then
  npx expo prebuild --platform android --no-install
fi
(
  cd android
  ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a --no-daemon --max-workers=2
)
mkdir -p artifacts
cp android/app/build/outputs/apk/release/app-release.apk artifacts/remote-signer-client-arm64.apk
shasum -a 256 artifacts/remote-signer-client-arm64.apk > artifacts/remote-signer-client-arm64.apk.sha256
echo "APK: $(pwd)/artifacts/remote-signer-client-arm64.apk"
