#!/usr/bin/env bash
# Albena early-access allowlist = ONE Cloudflare Access group ("Albena Early Access").
# chat.albena.ai + console.albena.ai Access policies include the group; the portal (account.albena.ai/albena) reads it.
# Needs CLOUDFLARE_API_TOKEN with Access: Organizations, Identity Providers, and Groups Edit (+ Apps and Policies Edit for `link`).
#   scripts/early-access.sh create                 create the group (seeded with today's chat allow list), print its id
#   scripts/early-access.sh list                   show who is on it
#   scripts/early-access.sh add <email|@domain>    add a person (or a whole email domain)
#   scripts/early-access.sh remove <email|@domain>
#   scripts/early-access.sh link                   point the chat + console "Allowed people" policies at the group (prod change: Omar's yes)
set -euo pipefail
ACCT="${CF_ACCOUNT_ID:-d59bc8ce599de891f475d1cd8af22370}"
GROUP="${EARLY_ACCESS_GROUP_ID:-e34d96cd-6a31-44b0-b09c-2c0c1a79270f}"
NAME="Albena Early Access"
CHAT_APP=52718877-ddb0-4960-bbb1-af8e92b8b0f1; CHAT_POL=d0967a03-0265-4e0d-bf15-026a94e6ebb8
CONSOLE_APP=8b9d10fd-5e23-4475-83bc-aa378caeb898; CONSOLE_POL=5cfa6274-ad10-4ad6-919c-a7d1a388f487
API="https://api.cloudflare.com/client/v4/accounts/$ACCT/access"
: "${CLOUDFLARE_API_TOKEN:?set CLOUDFLARE_API_TOKEN (read -s CLOUDFLARE_API_TOKEN; export CLOUDFLARE_API_TOKEN)}"
cf() { curl -fsS -X "$1" "$API$2" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" ${3:+--data "$3"}; }
need_group() { [[ -n "$GROUP" ]] || GROUP=$(cf GET /groups | python3 -c 'import json,sys;print(next((g["id"] for g in json.load(sys.stdin)["result"] if g["name"]=="'"$NAME"'"),""))'); [[ -n "$GROUP" ]] || { echo "no group: run create" >&2; exit 1; }; }
rule() { [[ "$1" == @* ]] && printf '{"email_domain":{"domain":"%s"}}' "${1#@}" || printf '{"email":{"email":"%s"}}' "$(echo "$1" | tr A-Z a-z)"; }
case "${1:-}" in
  create)
    cf POST /groups "{\"name\":\"$NAME\",\"include\":[{\"email\":{\"email\":\"omar@dbaomarhuertasllc.com\"}},{\"email\":{\"email\":\"polina@dbaomarhuertasllc.com\"}},{\"email\":{\"email\":\"chloe@dbaomarhuertasllc.com\"}}]}" \
      | python3 -c 'import json,sys;r=json.load(sys.stdin)["result"];print("EARLY_ACCESS_GROUP_ID =",r["id"])' ;;
  list) need_group; cf GET "/groups/$GROUP" | python3 -c 'import json,sys;r=json.load(sys.stdin)["result"]
for i in r["include"]: print(" ", (i.get("email") or {}).get("email") or "@"+(i.get("email_domain") or {}).get("domain","?") if ("email" in i or "email_domain" in i) else "  (other rule) "+json.dumps(i))' ;;
  add|remove)
    [[ -n "${2:-}" ]] || { echo "usage: $0 $1 <email|@domain>" >&2; exit 2; }
    need_group; R=$(rule "$2")
    BODY=$(cf GET "/groups/$GROUP" | python3 -c 'import json,sys;r=json.load(sys.stdin)["result"];new=json.loads(sys.argv[2]);inc=[i for i in r["include"] if i!=new]
inc += [new] if sys.argv[1]=="add" else []
print(json.dumps({"name":r["name"],"include":inc,"exclude":r.get("exclude",[]),"require":r.get("require",[])}))' "$1" "$R")
    cf PUT "/groups/$GROUP" "$BODY" >/dev/null && echo "$1 $2: ok (portal sees it within 60 s)" ;;
  link)
    need_group
    for pair in "$CHAT_APP:$CHAT_POL" "$CONSOLE_APP:$CONSOLE_POL"; do
      app=${pair%%:*}; pol=${pair##*:}
      cf PUT "/apps/$app/policies/$pol" "{\"name\":\"Allowed people (Albena Early Access group)\",\"decision\":\"allow\",\"include\":[{\"group\":{\"id\":\"$GROUP\"}}]}" >/dev/null && echo "linked $app"
    done ;;
  *) sed -n 2,10p "$0"; exit 2 ;;
esac
