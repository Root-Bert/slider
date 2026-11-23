#!/usr/bin/env bash
# Starts the release that GitHub Actions has just copied to this server, together with deploy/.env
# (.github/workflows/deploy.yml): rebuilds Slider, restarts the Compose stack (deploy/.env decides
# which files, e.g. with the website – which deploys on its own), waits until Slider reports
# healthy and drops old images.
# Migrations run on Slider's start. Installs Docker first on a fresh server.
#
# By hand, as root, with a copy of the repository in /opt/slider and deploy/.env filled in:
#
#   /opt/slider/deploy/deploy.sh
set -euo pipefail

# One deploy at a time on this server, Slider's or the website's (deploy-website.sh: same lock).
exec 9>/var/lock/slider-deploy.lock
flock 9

cd "$(dirname "$0")"
if [[ ! -f .env ]]; then
  echo "deploy/.env is missing (the workflow writes it from the DEPLOY_ENV secret)" >&2
  exit 1
fi

command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh

# Spam filter (COMPOSE_PROFILES with spam): Slider and Rspamd share a controller password made once
# on this server, outside the copied release – nothing to set. A line in deploy/.env wins.
profiles=$(sed -n 's/^COMPOSE_PROFILES=//p' .env | tail -n 1 | tr -d "\"' \t")
if [[ ",$profiles," == *,spam,* ]]; then
  secret=/var/lib/slider/rspamd-password
  if [[ ! -s $secret ]]; then
    install -d -m 700 /var/lib/slider
    (umask 077 && head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n' >"$secret")
  fi
  # An empty line (copied from .env.example) counts as none.
  sed -i -E "/^RSPAMD_(URL|PASSWORD)=[\"']{0,2}\$/d" .env
  grep -q '^RSPAMD_URL=' .env || echo 'RSPAMD_URL=http://rspamd:11333' >>.env
  grep -q '^RSPAMD_PASSWORD=' .env || echo "RSPAMD_PASSWORD=$(cat "$secret")" >>.env
fi

echo "→ building and starting"
docker compose pull --quiet postgres caddy
docker compose build slider
# The product website ships on its own (deploy/deploy-website.sh): a Slider release leaves the
# running site alone and only builds it while there is no image yet.
# Services read first: piping compose into `grep -q` fails at random under pipefail.
services=$(docker compose config --services)
if grep -qx website <<<"$services" &&
  ! docker image inspect slider-website:local >/dev/null 2>&1; then
  docker compose build website
fi
# Speech to text on this server (COMPOSE_PROFILES=stt in deploy/.env): its image holds the model,
# so it is built once and kept – `up --no-build` below would fail without it.
if grep -qx stt <<<"$services" && ! docker image inspect slider-stt:local >/dev/null 2>&1; then
  docker compose build stt
fi
# Spam filter: its resolver's image is small and built each time (cached), as Rspamd needs it.
if grep -qx rspamd-dns <<<"$services"; then
  docker compose build rspamd-dns
fi
docker compose up -d --no-build --remove-orphans

echo "→ waiting for Slider"
id=$(docker compose ps -q slider)
status=
for _ in $(seq 60); do
  status=$(docker inspect -f '{{.State.Health.Status}}' "$id")
  [[ $status == healthy ]] && break
  sleep 5
done
if [[ $status != healthy ]]; then
  # No logs here: they end up in the Actions log, and before the first admin they carry the
  # setup token.
  echo "Slider is not healthy after 5 minutes ($status): see 'docker compose logs slider' on the server" >&2
  exit 1
fi

docker image prune -f >/dev/null
# Each release builds on the server and leaves its layers in the build cache, which nothing else
# drops (46 GB on a 75 GB disk). Cache used in the last day stays, so the next build stays quick.
docker builder prune -f --filter until=24h >/dev/null
echo "✓ live"
