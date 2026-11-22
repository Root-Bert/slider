#!/bin/sh
# Builds Cloud's drive for the Finder: the File Provider extension (`CloudDrive.appex`) and the
# helper the app calls (`cloud-drive`). Command line tools are enough, no Xcode project.
#
#   DRIVE_IDENTITY  the signing identity (name or hash); `-` signs without one (ad hoc)
#   DRIVE_VERSION   the version the extension says it is (default 0.1.0; the app's, for a release)
#   DRIVE_BUNDLE_ID the app's bundle id the extension belongs to (default dev.bertro.slider)
#   $1              where to put them (default desktop/build/drive)
#
# With `--dev-app` a small app of its own is made around both, to try the drive without
# building Slider: `<out>/Cloud Drive Dev.app/Contents/MacOS/cloud-drive set <server>` (token on stdin).
set -eu
here=$(cd "$(dirname "$0")" && pwd)
dev=0
if [ "${1:-}" = "--dev-app" ]; then dev=1; shift; fi
out=${1:-"$here/../build/drive"}
identity=${DRIVE_IDENTITY:?the signing identity, as `security find-identity -v -p codesigning` lists it}
bundle=${DRIVE_BUNDLE_ID:-dev.bertro.slider}
# macOS lists a revoked certificate among the valid ones; what it signs is blocked as malware.
if [ "$identity" != - ] &&
  security find-identity -v -p codesigning | grep -F "$identity" | grep -q REVOKED; then
  echo "That identity's certificate is revoked" >&2
  exit 1
fi
sdk=$(xcrun --show-sdk-path)
flags="-swift-version 5 -O -sdk $sdk -target arm64-apple-macos15.0"

rm -rf "$out"
appex="$out/CloudDrive.appex"
mkdir -p "$appex/Contents/MacOS"
# shellcheck disable=SC2086
swiftc $flags -module-name CloudDrive -parse-as-library -application-extension \
  -Xlinker -e -Xlinker _NSExtensionMain \
  "$here/Shared.swift" "$here/Api.swift" "$here/Store.swift" "$here/Items.swift" \
  "$here/Extension.swift" -o "$appex/Contents/MacOS/CloudDrive"
# shellcheck disable=SC2086
swiftc $flags "$here/Shared.swift" "$here/helper/main.swift" -o "$out/cloud-drive"

sed -e "s/@BUNDLE@/$bundle/g" -e "s/@VERSION@/${DRIVE_VERSION:-0.1.0}/g" \
  "$here/Extension-Info.plist" >"$appex/Contents/Info.plist"
# The Finder's sidebar icon (`CFBundleSymbolName` officecloud): the symbol `cloud.svg`, compiled. Only
# Xcode compiles it, so the result lies here – after a change of the symbol:
#   mkdir -p x.xcassets/officecloud.symbolset && cp cloud.svg x.xcassets/officecloud.symbolset/ && \
#   echo '{"symbols":[{"filename":"cloud.svg","idiom":"universal"}]}' >x.xcassets/officecloud.symbolset/Contents.json && \
#   DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun actool x.xcassets --compile . \
#     --platform macosx --minimum-deployment-target 15.0
mkdir -p "$appex/Contents/Resources"
cp "$here/Assets.car" "$appex/Contents/Resources/Assets.car"

sign() { codesign --force --options runtime --timestamp=none --sign "$identity" "$@"; }

if [ "$dev" = 1 ]; then
  app="$out/Cloud Drive Dev.app"
  mkdir -p "$app/Contents/MacOS" "$app/Contents/PlugIns"
  mv "$out/cloud-drive" "$app/Contents/MacOS/cloud-drive"
  mv "$appex" "$app/Contents/PlugIns/CloudDrive.appex"
  sed -e "s/@BUNDLE@/$bundle/g" "$here/DevApp-Info.plist" >"$app/Contents/Info.plist"
  sign --entitlements "$here/Extension.entitlements" "$app/Contents/PlugIns/CloudDrive.appex"
  sign "$app"
  echo "$app"
else
  sign --entitlements "$here/Extension.entitlements" "$appex"
  sign "$out/cloud-drive"
  echo "$out"
fi
