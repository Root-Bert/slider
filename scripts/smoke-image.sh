#!/usr/bin/env bash
# Smoke test of the built container image, run by CI before anything is published
# (.github/workflows/ci.yml) and usable by hand:
#
#   docker build -t slider:local . && scripts/smoke-image.sh slider:local
#
# Starts the image the way docs/self-hosting.md does (production, nothing but SLIDER_URL) and
# checks what only shows up at runtime: the API answers /api/health, the built web app is served,
# the first start prints the setup link, tini is PID 1, @napi-rs/canvas and LibreOffice load, the
# sample deck goes through the default slide renderer (LibreOffice → PDF → WebP, on Bun, as user
# `bun`; scripts/smoke-convert.ts), saving the setup page restarts the server in the container
# (exit 75 → supervisor) with the saved login, and `docker stop` shuts down cleanly (exit code 0).
#
# SMOKE_PLATFORM=linux/arm64 runs an image of another platform (CI: under QEMU); SMOKE_WAIT
# raises the 90 s start budget for that.
set -euo pipefail

image=${1:?usage: scripts/smoke-image.sh <image> [host port]}
port=${2:-18787}
wait_seconds=${SMOKE_WAIT:-90}
platform=${SMOKE_PLATFORM:+--platform=${SMOKE_PLATFORM}}
root=$(cd "$(dirname "$0")/.." && pwd)
name="slider-smoke-$$"
base="http://127.0.0.1:${port}"

fail() {
  echo "smoke test failed: $*" >&2
  docker logs "$name" >&2 || true
  exit 1
}
trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT

# Whether the container log has a line matching $1. grep reads the whole log (no -q): with
# pipefail, an early exit would fail the pipeline once `docker logs` gets SIGPIPE.
log_has() {
  docker logs "$name" 2>&1 | grep -- "$1" >/dev/null
}

# shellcheck disable=SC2086 # empty without SMOKE_PLATFORM
docker run -d $platform --name "$name" -p "127.0.0.1:${port}:8787" \
  -e NODE_ENV=production -e SLIDER_URL="http://localhost:${port}" \
  "$image" >/dev/null

echo "Waiting for ${base}/api/health …"
healthy=false
for _ in $(seq 1 "$wait_seconds"); do
  if [ "$(docker inspect -f '{{.State.Running}}' "$name")" != true ]; then
    fail "the container exited during start"
  fi
  if curl -fsS "${base}/api/health" 2>/dev/null | grep -q '"ok":true'; then
    healthy=true
    break
  fi
  sleep 1
done
[ "$healthy" = true ] || fail "/api/health did not answer {\"ok\":true} within ${wait_seconds} s"
echo "ok   /api/health"

curl -fsS "${base}/" | grep -q '<div id="root">' || fail "/ does not serve the web app's index.html"
curl -fsS "${base}/einrichtung" | grep -q '<div id="root">' || fail "SPA fallback for /einrichtung"
echo "ok   web app (index.html, SPA fallback)"

log_has '/einrichtung$' || fail "no setup page in the log"
log_has 'Setup token: ' || fail "no setup token in the log"
log_has '#token=' && fail "setup token in a URL"
echo "ok   setup page and token in the log (not in a URL)"

[ "$(docker exec "$name" cat /proc/1/comm)" = tini ] || fail "PID 1 is not tini"
echo "ok   tini is PID 1"

docker exec -w /app/apps/api "$name" bun -e \
  "import('@napi-rs/canvas').then((c) => { c.createCanvas(1, 1); }, (e) => { console.error(e); process.exit(1); })" ||
  fail "@napi-rs/canvas does not load"
echo "ok   @napi-rs/canvas"

docker exec "$name" soffice --version >/dev/null || fail "LibreOffice (soffice) does not run"
echo "ok   LibreOffice"

# The sample deck is not part of the image (.dockerignore), so it is copied in with the script.
docker cp "${root}/packages/pptx/samples/slider-demo.pptx" "${name}:/tmp/smoke-deck.pptx"
docker cp "${root}/scripts/smoke-convert.ts" "${name}:/tmp/smoke-convert.ts"
converted=$(docker exec -w /app/apps/api "$name" bun /tmp/smoke-convert.ts /tmp/smoke-deck.pptx) ||
  fail "the sample deck did not convert to slide images (LibreOffice → PDF → WebP)"
echo "ok   slide images: ${converted}"

# Saving the setup page restarts the server to build the login clients: server.ts exits with 75,
# the supervisor (CMD) starts it again – inside the same container, which keeps running.
token=$(docker logs "$name" 2>&1 | sed -n 's/.*Setup token: \([A-Za-z0-9_-]*\).*/\1/p' | sed -n 1p)
[ -n "$token" ] || fail "no setup token in the log"
saved=$(curl -fsS -X PUT "${base}/api/setup" -H "X-Setup-Token: ${token}" \
  -H 'Content-Type: application/json' \
  --data '{"values":{"MS_CLIENT_ID":"00000000-0000-0000-0000-000000000000","MS_CLIENT_SECRET":"smoke-secret"}}') ||
  fail "saving the setup page (PUT /api/setup) failed"
echo "$saved" | grep -q '"restart":"automatic"' ||
  fail "the setup page does not restart automatically in the image: ${saved}"
restarted=false
for _ in $(seq 1 "$wait_seconds"); do
  if [ "$(docker inspect -f '{{.State.Running}}' "$name")" != true ]; then
    fail "the container exited instead of restarting the server"
  fi
  if log_has 'Settings from the setup page: ' &&
    curl -fsS "${base}/api/setup" 2>/dev/null | grep -q '"loginConfigured":true'; then
    restarted=true
    break
  fi
  sleep 1
done
[ "$restarted" = true ] || fail "the server did not come back with the saved login within ${wait_seconds} s"
log_has 'Restarting Slider to apply the new settings' ||
  fail "the supervisor did not restart the server"
[ "$(docker inspect -f '{{.RestartCount}}' "$name")" = 0 ] || fail "the container was restarted"
curl -fsS "${base}/api/health" | grep -q '"ok":true' || fail "/api/health after the restart"
echo "ok   setup saved, server restarted with the new login (supervisor)"

docker stop -t 20 "$name" >/dev/null
code=$(docker inspect -f '{{.State.ExitCode}}' "$name")
[ "$code" = 0 ] || fail "docker stop ended with exit code ${code}, not 0"
echo "ok   clean shutdown"

echo "Smoke test of ${image} passed."
