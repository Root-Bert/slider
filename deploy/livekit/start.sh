#!/bin/sh
# LiveKit for calls with many people (COMPOSE_PROFILES=call, docker-compose.yml): it forwards the
# calls' sound and pictures. Writes its config and starts it:
#  - its key pair is the one Slider made on its first start (slider-data/livekit/keys.yaml, read
#    only here) – nothing to set by hand; its webhook goes to Slider with that key;
#  - TURN for networks that let nothing else through: UDP 3478 and TLS 5349, the TLS one with the
#    certificate Caddy already gets and renews for CALL_DOMAIN (its site in the Caddyfile) – no
#    second ACME client. Until Caddy has it, TURN runs over UDP only; once it appears LiveKit
#    restarts (the container's restart policy) to take it. A renewed one (Caddy renews 30 days
#    before the old one runs out) waits for the night: a restart lets every call in LiveKit end
#    first and takes no new ones meanwhile.
#  - its public address: found by STUN, or LIVEKIT_NODE_IP when that guesses wrong.
set -eu

DOMAIN="${CALL_DOMAIN:-}"
KEYS="${LIVEKIT_KEYS_FILE:-/keys/keys.yaml}"
CERTS="${CADDY_CERTIFICATES:-/caddy/caddy/certificates}"
CONFIG="${LIVEKIT_CONFIG_FILE:-/tmp/livekit.yaml}"
SERVER="${LIVEKIT_SERVER:-/livekit-server}"
WEBHOOK="${LIVEKIT_WEBHOOK:-http://slider:8787/api/calls/livekit}"
CHECK_EVERY="${CERT_CHECK_SECONDS:-600}"
# The hours (UTC, from–to) in which a renewed certificate restarts LiveKit.
QUIET_FROM="${CERT_RESTART_FROM_HOUR:-2}"
QUIET_TO="${CERT_RESTART_TO_HOUR:-4}"

if [ -z "$DOMAIN" ]; then
  echo "CALL_DOMAIN is not set: the call profile needs it in deploy/.env (docs/self-hosting.md)." >&2
  exit 1
fi
while [ ! -s "$KEYS" ]; do
  echo "Waiting for $KEYS – Slider makes it on its first start with CALL_DOMAIN set."
  sleep 5
done
KEY=$(sed -n '1s/:.*//p' "$KEYS")

# Caddy keeps a site's certificate under certificates/<issuer>/<name>/<name>.crt|.key.
cert_dir() {
  for dir in "$CERTS"/*/"$DOMAIN"; do
    if [ -s "$dir/$DOMAIN.crt" ] && [ -s "$dir/$DOMAIN.key" ]; then
      echo "$dir"
      return
    fi
  done
}
cert_sum() {
  dir=$(cert_dir)
  if [ -n "$dir" ]; then cat "$dir/$DOMAIN.crt" | md5sum; else echo none; fi
}

DIR=$(cert_dir)
if [ -n "$DIR" ]; then
  TLS="  tls_port: 5349
  cert_file: $DIR/$DOMAIN.crt
  key_file: $DIR/$DOMAIN.key"
else
  echo "No certificate for $DOMAIN from Caddy yet – TURN over UDP only until it is there."
  TLS="  tls_port: 0"
fi
if [ -n "${NODE_IP:-}" ]; then
  ADDRESS="  node_ip: $NODE_IP"
else
  ADDRESS="  use_external_ip: true"
fi

cat > "$CONFIG" <<YAML
port: 7880
log_level: info
rtc:
  # ICE over UDP through one port (all media), over TCP when UDP is blocked.
  udp_port: 7882
  tcp_port: 7881
$ADDRESS
room:
  # Slider's limit per call (MAX_SFU_CALL_PEERS); Slider closes a call's room when it ends.
  max_participants: 50
  empty_timeout: 60
  departure_timeout: 20
turn:
  enabled: true
  domain: $DOMAIN
  udp_port: 3478
$TLS
webhook:
  api_key: $KEY
  urls:
    - $WEBHOOK
YAML

# A new certificate: LiveKit restarts with it at once (it reads it only at start); a renewed one
# at night – the old one still holds for weeks.
WAS=$(cert_sum)
(
  while sleep "$CHECK_EVERY"; do
    NOW=$(cert_sum)
    [ "$NOW" = "$WAS" ] && continue
    HOUR=$(date -u +%H | sed 's/^0//')
    if [ "$WAS" = none ] || { [ "${HOUR:-0}" -ge "$QUIET_FROM" ] && [ "${HOUR:-0}" -lt "$QUIET_TO" ]; }; then
      echo "Certificate for $DOMAIN changed – restarting LiveKit with it."
      kill -TERM "$$"
      exit 0
    fi
  done
) &

exec "$SERVER" --config "$CONFIG" --key-file "$KEYS"
