#!/bin/sh
# Packs „The Office Cloud“ for the Mac as a DMG without an Apple developer account: the app and
# the Finder's drive in it are signed by themselves (ad hoc), in the order `sign-dev.sh` keeps –
# never `codesign --deep` alone, which would take the drive's own rights (sandbox) and macOS
# loads no drive without them. Not notarised: macOS asks before the first start
# (Systemeinstellungen › Datenschutz & Sicherheit › „Dennoch öffnen“), and there is no update feed.
#
#   CLOUD_VERSION   the version (default: desktop/package.json's)
#   DRIVE_IDENTITY  a signing identity instead, by hash (default `-`)
#   CLOUD_OUT       where to build (default desktop/dist/cloud; the drive goes to desktop/build/drive)
set -eu
here=$(cd "$(dirname "$0")" && pwd)
cd "$here/.."
identity=${DRIVE_IDENTITY:--}
version=${CLOUD_VERSION:-$(node -p "require('./package.json').version")}
out=${CLOUD_OUT:-"$here/../dist/cloud"}
if [ -n "${CLOUD_OUT:-}" ]; then
  CLOUD_DRIVE_DIR="$out/drive"
  export CLOUD_DRIVE_DIR
fi
drive=${CLOUD_DRIVE_DIR:-"$here/../build/drive"}
app="$out/mac-arm64/The Office Cloud.app"

DRIVE_IDENTITY="$identity" DRIVE_BUNDLE_ID=dev.bertro.cloud DRIVE_VERSION="$version" \
  sh drive/build.sh "$drive"
pack() {
  npx electron-builder --mac "$@" --arm64 --publish never -c cloud/builder.json \
    -c.directories.output="$out" -c.mac.identity=null -c.extraMetadata.version="$version"
}
pack --dir
DRIVE_IDENTITY="$identity" sh cloud/sign-dev.sh "$app"
# The drive kept its own rights? Without the sandbox macOS never loads it.
codesign -d --entitlements - "$app/Contents/PlugIns/CloudDrive.appex" 2>/dev/null |
  grep -q com.apple.security.app-sandbox || {
  echo "The drive lost its entitlements" >&2
  exit 1
}
pack dmg --prepackaged "$app"
rm -f "$out"/latest*.yml "$out"/*.blockmap
ls "$out"/Cloud-*.dmg
