#!/bin/bash
# Turns .env.local into the YAML file `gcloud run deploy --env-vars-file` reads.
#
# WHY NOT --set-env-vars. Passing secrets as command arguments writes the Neon
# connection string and the dashboard password into shell history, and into the
# process list of every user on the machine while the command runs. A file that
# is gitignored and never printed avoids both.
#
# This is still not Secret Manager: the values end up readable in the Cloud Run
# service configuration by anyone with console access to the project. For one
# person's project that is a reasonable trade; for a team it is not.
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"

SRC=".env.local"
OUT=".gcloud-env.yaml"

[ -f "$SRC" ] || { echo "Không thấy $SRC" >&2; exit 1; }

{
  echo "# Sinh từ .env.local bởi scripts/make-gcloud-env.sh — KHÔNG commit."
  # Cloud Run injects PORT itself and rejects it as an input, so it is not here.
  echo "HOST: \"0.0.0.0\""
  echo "DISPLAY_TIMEZONE: \"Asia/Tokyo\""
  # Only the keys the server actually reads. Anything else in .env.local stays
  # local rather than being shipped to a server that has no use for it.
  for key in DATABASE_URL DASHBOARD_PASSWORD DISCORD_WEBHOOK_URL SCRAPER_USER_AGENT REQUEST_DELAY_MS; do
    value=$(grep -E "^${key}=" "$SRC" | head -1 | cut -d= -f2- || true)
    # Strip surrounding quotes if the .env file used them.
    value="${value%\"}"; value="${value#\"}"
    value="${value%\'}"; value="${value#\'}"
    [ -n "$value" ] && printf '%s: "%s"\n' "$key" "$value"
  done
} > "$OUT"

chmod 600 "$OUT"

echo "Đã tạo $OUT (chmod 600, đã gitignore)."
echo "Các biến ghi vào — chỉ hiện TÊN, không hiện giá trị:"
grep -oE '^[A-Z_]+' "$OUT" | sed 's/^/  /'
