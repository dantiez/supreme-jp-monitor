#!/bin/bash
# Installs the launchd agent that serves scan requests.
#
# WHY A SCRIPT AND NOT A COMMITTED PLIST. launchd expands neither ~ nor $HOME
# inside ProgramArguments, so a checked-in plist has to hardcode one machine's
# absolute path. It then silently keeps pointing at wherever the repository used
# to be. This writes the path the repository is at right now.
#
# THE FAILURE THIS EXISTS TO PREVENT. macOS protects ~/Downloads, ~/Desktop and
# ~/Documents (TCC). A launchd agent may not execute anything inside them
# without Full Disk Access, and the way it fails is exit code 126 with
# "Operation not permitted" in a log nobody thinks to open -- the agent looks
# installed, `launchctl list` shows it, and it simply never runs. Checked up
# front and refused with an explanation instead.
set -uo pipefail

LABEL="com.supreme-jp-monitor.scan"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
SCRIPT="$PROJECT_DIR/scripts/scheduled-scan.sh"
LOG_DIR="$HOME/Library/Logs/supreme-jp-monitor"
INTERVAL="${INTERVAL:-60}"

for protected in "$HOME/Downloads" "$HOME/Desktop" "$HOME/Documents"; do
  case "$PROJECT_DIR/" in
    "$protected"/*)
      cat >&2 <<MSG

KHÔNG cài được: dự án đang nằm trong thư mục macOS bảo vệ.

  $PROJECT_DIR

macOS không cho tiến trình nền chạy file trong Downloads, Desktop hay
Documents. Agent sẽ cài được, launchctl sẽ liệt kê nó, nhưng nó không bao giờ
chạy — chỉ báo "Operation not permitted" trong log.

Chuyển dự án ra ngoài rồi chạy lại:

  mv "$PROJECT_DIR" ~/supreme-jp-monitor
  cd ~/supreme-jp-monitor && ./scripts/install-agent.sh

MSG
      exit 1
      ;;
  esac
done

if [ ! -x "$SCRIPT" ]; then
  echo "KHÔNG cài được: $SCRIPT không tồn tại hoặc không có quyền chạy." >&2
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"

# Replaces any previous version rather than layering on top of it.
launchctl unload "$PLIST" 2>/dev/null

cat > "$PLIST" <<PLIST_END
<?xml version="1.0" encoding="UTF-8"?>
<!-- Sinh bởi scripts/install-agent.sh — đừng sửa tay, chạy lại script. -->
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$SCRIPT</string>
  </array>
  <key>StartInterval</key>
  <integer>$INTERVAL</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/launchd.out.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/launchd.err.log</string>
</dict>
</plist>
PLIST_END

plutil -lint "$PLIST" >/dev/null || { echo "plist sinh ra bị lỗi cú pháp." >&2; exit 1; }
launchctl load "$PLIST" || { echo "launchctl load thất bại." >&2; exit 1; }

echo "Đã cài: $LABEL"
echo "  chạy      : $SCRIPT"
echo "  mỗi       : ${INTERVAL}s"
echo "  log       : $LOG_DIR/scan.log"

# RunAtLoad means the first check has already started. Its exit status is the
# proof that the agent works, and is the whole reason to look.
sleep 4
STATUS=$(launchctl list | awk -v l="$LABEL" '$3 == l { print $2 }')
if [ "${STATUS:-}" = "0" ]; then
  echo "  lần chạy đầu: OK"
else
  echo "  lần chạy đầu: mã thoát ${STATUS:-?} — xem $LOG_DIR/launchd.err.log" >&2
fi
