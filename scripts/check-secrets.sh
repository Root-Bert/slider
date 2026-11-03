#!/bin/sh
# Scan committed files and their history before any push. Never print secret values.
set -eu
cd "$(git rev-parse --show-toplevel)"
scanner=${GITLEAKS_BIN:-gitleaks}
if ! command -v "$scanner" >/dev/null 2>&1; then
  echo 'Secret scan requires gitleaks (macOS: brew install gitleaks). Push blocked.' >&2
  exit 1
fi
exec "$scanner" git --redact --log-opts=--all .
