#!/bin/bash
# Serves scan requests, and refreshes stale data, on the machine that can reach
# the Japanese store.
#
# WHY THIS EXISTS: supreme.com picks a storefront from the caller's IP, and each
# one renames every product. The hosted dashboard is in Singapore and is served
# the SGD store, so it cannot scan. Its "Quét ngay" button records the ask in
# the shared database instead, and this picks it up.
#
# Run every minute by launchd. It exits immediately when there is nothing to do,
# so the cost of checking often is close to nothing -- and checking often is
# what makes the button on the other machine feel like a button.
#
# launchd gives a job almost no environment: no PATH beyond the system default,
# no shell profile, no nvm. Every path below is absolute for that reason -- a
# bare `npm` works when tested by hand and silently fails at 3am.
set -uo pipefail

PROJECT_DIR="$HOME/Downloads/supreme-jp-monitor"
NODE_BIN_DIR="/usr/local/bin"
LOG_DIR="$HOME/Library/Logs/supreme-jp-monitor"

mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/scan.log"

# A scan several times a day for years is otherwise a slow leak.
if [ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 5000000 ]; then
  mv "$LOG" "$LOG.1"
fi

export PATH="$NODE_BIN_DIR:/usr/bin:/bin:/usr/sbin:/sbin"

cd "$PROJECT_DIR" || {
  echo "$(date '+%F %T')  KHÔNG tìm thấy thư mục $PROJECT_DIR" >> "$LOG"
  exit 1
}

echo "--- $(date '+%F %T') kiểm tra ---" >> "$LOG"
"$NODE_BIN_DIR/npm" run worker -- --or-schedule >> "$LOG" 2>&1
STATUS=$?
[ $STATUS -ne 0 ] && echo "!!! $(date '+%F %T') LỖI, mã thoát $STATUS" >> "$LOG"

# A non-zero exit is usually the wrong-storefront guard, which means this
# machine has moved or is behind a VPN. Left in the log rather than swallowed.
exit $STATUS
