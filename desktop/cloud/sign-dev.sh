#!/bin/sh
# Signs a packed „The Office Cloud.app“ for this Mac (no notarising): everything inside with the app's
# rights, then the Finder's drive with its own (sandbox, network), then the app's shell again
# over them. For a release electron-builder signs; that it leaves the drive's rights is untried.
#
#   DRIVE_IDENTITY  the signing identity, by hash; `-` signs without one (ad hoc)
#   $1              the app (default dist/cloud/mac-arm64/The Office Cloud.app)
set -eu
here=$(cd "$(dirname "$0")" && pwd)
app=${1:-"$here/../dist/cloud/mac-arm64/The Office Cloud.app"}
identity=${DRIVE_IDENTITY:?the signing identity, by hash}
sign() { codesign --force --options runtime --timestamp=none --sign "$identity" "$@" 2>&1 | grep -v "replacing existing signature" || true; }
sign --deep --entitlements "$here/../entitlements.mac.plist" "$app"
appex="$app/Contents/PlugIns/CloudDrive.appex"
if [ -d "$appex" ]; then
  sign --entitlements "$here/../drive/Extension.entitlements" "$appex"
  sign "$app/Contents/MacOS/cloud-drive"
  sign --entitlements "$here/../entitlements.mac.plist" "$app"
fi
codesign --verify --deep --strict "$app"
echo "$app"
