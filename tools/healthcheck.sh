#!/bin/bash
# Deep health check for the Label Studio site.
# Prints "OK ..." (exit 0) or "FAIL: ..." / "WARN: ..." (exit 1).
URL="https://labels.billiondream.co.in"
HOST="labels.billiondream.co.in"
problems=()

# 1. HTTPS reachable + returns 200
code=$(curl -s -o /tmp/ls_health.html -w "%{http_code}" --max-time 20 "$URL/" 2>/dev/null)
if [ "$code" != "200" ]; then
  problems+=("site not returning 200 (got HTTP $code)")
else
  # 2. It's actually our app (not a GitHub 404 page)
  grep -q "Label Studio" /tmp/ls_health.html || problems+=("page loaded but 'Label Studio' missing — app may be broken")
fi

# 3. Encrypted reference present and intact (real one is ~3.6MB)
refbytes=$(curl -s -o /tmp/ls_ref.js -w "%{size_download}" --max-time 30 "$URL/assets/reference.enc.js" 2>/dev/null)
if ! grep -q '"ct":"' /tmp/ls_ref.js 2>/dev/null; then
  problems+=("encrypted reference missing or malformed")
elif [ "${refbytes:-0}" -lt 1000000 ]; then
  problems+=("encrypted reference too small (${refbytes} bytes) — may be the placeholder")
fi

# 4. HTTPS certificate expiry
exp=$(echo | openssl s_client -servername "$HOST" -connect "$HOST:443" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
if [ -n "$exp" ]; then
  exp_epoch=$(date -j -f "%b %d %T %Y %Z" "$exp" +%s 2>/dev/null)
  now=$(date +%s)
  if [ -n "$exp_epoch" ]; then
    days=$(( (exp_epoch - now) / 86400 ))
    [ "$days" -lt 14 ] && problems+=("HTTPS cert expires in $days days")
  fi
else
  problems+=("could not read HTTPS certificate")
fi

if [ ${#problems[@]} -eq 0 ]; then
  echo "OK — site up, app loads, reference intact (${refbytes} bytes), cert healthy."
  exit 0
else
  echo "FAIL: $(IFS='; '; echo "${problems[*]}")"
  exit 1
fi
