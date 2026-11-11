#!/usr/bin/env bash
# ALB-OPS-1: role mailboxes on Cloudflare Email Routing (free). security@ and privacy@ forward to the owner.
# support@ (and accounts@, billing@) are routed to the albena-inbound-mail Worker, which opens Obvera tickets; do not change them here.
# Prerequisite: the destination address must be verified once (Cloudflare emails a link to it):
#   cf email-routing addresses create -z albena.ai --email "$DEST"
# Idempotent: skips rules that already exist. Usage: scripts/setup-role-mailboxes.sh [dest]
set -euo pipefail
DEST="${1:-omar@dbaomarhuertasllc.com}"
ZONE=albena.ai
rules="$(cf email-routing rules list-account -z "$ZONE" 2>/dev/null || true)"
for box in security privacy; do
  if grep -q "\"$box@albena.ai\"" <<<"$rules"; then echo "exists: $box@albena.ai"; continue; fi
  cf email-routing rules create -z "$ZONE" --name "$box forward" \
    --matchers "[{\"type\":\"literal\",\"field\":\"to\",\"value\":\"$box@albena.ai\"}]" \
    --actions "[{\"type\":\"forward\",\"value\":[\"$DEST\"]}]"
  echo "created: $box@albena.ai -> $DEST"
done
