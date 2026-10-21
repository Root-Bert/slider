#!/usr/bin/env bash
# Deploys only the product website (apps/site), apart from Slider's releases: builds
# slider-website:local from this checkout – which GitHub Actions has just copied to WEBSITE_DIR
# (/opt/slider-site, .github/workflows/deploy-website.yml) – swaps the website container of the
# running stack in /opt/slider and reloads Caddy for the site's rules (deploy/website/website.caddy,
# mounted from WEBSITE_DIR). Slider itself keeps running untouched.
#
# By hand, as root:
#
#   /opt/slider-site/deploy/deploy-website.sh
set -euo pipefail

# One deploy at a time on this server, Slider's or the website's (deploy.sh: same lock).
exec 9>/var/lock/slider-deploy.lock
flock 9

site=$(cd "$(dirname "$0")/.." && pwd)
stack=${SLIDER_DIR:-/opt/slider}/deploy

if [[ ! -f $stack/.env ]]; then
  echo "Slider is not deployed yet ($stack/.env is missing): publish a release first" >&2
  exit 1
fi
cd "$stack"
# Read the config first: `docker compose config | grep -q` fails at random under pipefail (grep
# stops at the first match, compose then dies writing into the closed pipe).
services=$(docker compose config --services)
config=$(docker compose config)
if ! grep -qx website <<<"$services"; then
  echo "the website is not enabled in $stack/.env (COMPOSE_FILE with docker-compose.website.yml)" >&2
  exit 1
fi
if ! grep -qF "source: $site/deploy/website" <<<"$config"; then
  echo "Caddy does not read the site's rules from $site: set WEBSITE_DIR=$site in deploy/.env" >&2
  exit 1
fi

echo "→ building the website"
docker build --quiet -f "$site/deploy/website/Dockerfile" -t slider-website:local "$site" >/dev/null

echo "→ swapping it in"
docker compose up -d --no-deps --no-build --force-recreate website
# Caddy may not be up yet right after the first release; then it reads the rules when it starts.
if [[ -n $(docker compose ps -q caddy) ]]; then
  docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile
fi

docker image prune -f >/dev/null
echo "✓ website live"
