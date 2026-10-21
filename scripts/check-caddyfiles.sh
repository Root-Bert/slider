#!/usr/bin/env bash
# Checks that Caddy accepts the shipped Caddyfiles, run by CI (.github/workflows/ci.yml) and
# usable by hand:
#
#   scripts/check-caddyfiles.sh
#
# `caddy adapt --validate` parses each file and provisions its modules (directives, CIDR ranges,
# placeholders), as `docker compose up` would – a mistake would otherwise first show up on the
# owner's server as a Caddy crash loop without HTTPS. Covered:
#   deploy/Caddyfile        with its (empty) sites directory, without and with the product website
#                           (deploy/website/website.caddy, mounted by docker-compose.website.yml)
#   deploy/proxy/Caddyfile  with the templates of deploy/proxy/examples
#   deploy/website/Caddyfile  the static file server inside the website container
# each without Cloudflare (TRUSTED_PROXIES empty, the default) and with the Cloudflare list of
# deploy/.env.example.
#
# Runs the caddy:2 image of deploy/docker-compose.yml; CADDY=/path/to/caddy uses a local binary
# instead (the files are then copied with the import path pointed at the copied sites).
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
image=caddy:2
cloudflare=$(sed -n 's/^# TRUSTED_PROXIES=//p' "${root}/deploy/.env.example")
[ -n "$cloudflare" ] || {
  echo "no Cloudflare TRUSTED_PROXIES line in deploy/.env.example" >&2
  exit 1
}

# adapt <Caddyfile> <sites dir> <TRUSTED_PROXIES> [website dir]
adapt() {
  local config=$1 sites=$2 trusted=$3 website=${4:-}
  local env=(SLIDER_DOMAIN=slider.example.com WEBSITE_DOMAIN=example.com "TRUSTED_PROXIES=${trusted}")
  if [ -n "${CADDY:-}" ]; then
    local tmp
    tmp=$(mktemp -d)
    mkdir "${tmp}/sites" "${tmp}/website"
    find "$sites" -maxdepth 1 -name '*.caddy' -exec cp {} "${tmp}/sites/" \;
    [ -z "$website" ] || find "$website" -maxdepth 1 -name '*.caddy' -exec cp {} "${tmp}/website/" \;
    sed -e "s|/etc/caddy/sites/|${tmp}/sites/|" -e "s|/etc/caddy/website/|${tmp}/website/|" \
      "$config" >"${tmp}/Caddyfile"
    env "${env[@]}" "$CADDY" adapt --validate --adapter caddyfile --config "${tmp}/Caddyfile" >/dev/null
    rm -rf "$tmp"
  else
    local mounts=(-v "${config}:/etc/caddy/Caddyfile:ro" -v "${sites}:/etc/caddy/sites:ro")
    [ -z "$website" ] || mounts+=(-v "${website}:/etc/caddy/website:ro")
    docker run --rm \
      -e "${env[0]}" -e "${env[1]}" -e "${env[2]}" \
      "${mounts[@]}" \
      "$image" caddy adapt --validate --adapter caddyfile --config /etc/caddy/Caddyfile >/dev/null
  fi
}

for trusted in "" "$cloudflare"; do
  label=${trusted:+Cloudflare}
  label=${label:-no proxy trusted}
  adapt "${root}/deploy/Caddyfile" "${root}/deploy/sites" "$trusted"
  echo "ok   deploy/Caddyfile (${label})"
  adapt "${root}/deploy/Caddyfile" "${root}/deploy/sites" "$trusted" "${root}/deploy/website"
  echo "ok   deploy/Caddyfile + website/website.caddy (${label})"
  adapt "${root}/deploy/proxy/Caddyfile" "${root}/deploy/proxy/examples" "$trusted"
  echo "ok   deploy/proxy/Caddyfile + examples/*.caddy (${label})"
done

adapt "${root}/deploy/website/Caddyfile" "${root}/deploy/sites" ""
echo "ok   deploy/website/Caddyfile"
