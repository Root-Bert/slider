#!/usr/bin/env bash
# Smoke test of the built container image, run by CI before anything is published
# (.github/workflows/ci.yml) and usable by hand:
#
#   docker build -t slider:local . && scripts/smoke-image.sh slider:local
#
# Starts the image the way docs/self-hosting.md does (production, nothing but SLIDER_URL) and
# checks what only shows up at runtime: the API answers /api/health, the built web app is served,
# the first start prints the setup link, tini is PID 1, @napi-rs/canvas and LibreOffice load, and
# `docker stop` shuts down cleanly (exit code 0).
set -euo pipefail

image=${1:?usage: scripts/smoke-image.sh <image> [host port]}
port=${2:-18787}
name="slider-smoke-$$"
base="http://127.0.0.1:${port}"

fail() {
  echo "smoke test failed: $*" >&2
  docker logs "$name" >&2 || true
  exit 1
}
trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT

docker run -d --name "$name" -p "127.0.0.1:${port}:8787" \
  -e NODE_ENV=production -e SLIDER_URL="http://localhost:${port}" \
  "$image" >/dev/null

echo "Waiting for ${base}/api/health …"
healthy=false
for _ in $(seq 1 90); do
  if [ "$(docker inspect -f '{{.State.Running}}' "$name")" != true ]; then
    fail "the container exited during start"
  fi
  if curl -fsS "${base}/api/health" 2>/dev/null | grep -q '"ok":true'; then
    healthy=true
    break
  fi
  sleep 1
done
[ "$healthy" = true ] || fail "/api/health did not answer {\"ok\":true} within 90 s"
echo "ok   /api/health"

curl -fsS "${base}/" | grep -q '<div id="root">' || fail "/ does not serve the web app's index.html"
curl -fsS "${base}/einrichtung" | grep -q '<div id="root">' || fail "SPA fallback for /einrichtung"
echo "ok   web app (index.html, SPA fallback)"

docker logs "$name" 2>&1 | grep -q '/einrichtung#token=' || fail "no setup link in the log"
echo "ok   setup link in the log"

[ "$(docker exec "$name" cat /proc/1/comm)" = tini ] || fail "PID 1 is not tini"
echo "ok   tini is PID 1"

docker exec -w /app/apps/api "$name" bun -e \
  "import('@napi-rs/canvas').then((c) => { c.createCanvas(1, 1); }, (e) => { console.error(e); process.exit(1); })" ||
  fail "@napi-rs/canvas does not load"
echo "ok   @napi-rs/canvas"

docker exec "$name" soffice --version >/dev/null || fail "LibreOffice (soffice) does not run"
echo "ok   LibreOffice"

docker stop -t 20 "$name" >/dev/null
code=$(docker inspect -f '{{.State.ExitCode}}' "$name")
[ "$code" = 0 ] || fail "docker stop ended with exit code ${code}, not 0"
echo "ok   clean shutdown"

echo "Smoke test of ${image} passed."
