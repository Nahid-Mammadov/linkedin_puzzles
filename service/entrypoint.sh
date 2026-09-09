#!/bin/bash
set -euo pipefail
umask 077
mkdir -p "${DATA_DIR:-/data}" "$HOME"
if [[ "${1:-run}" == status ]]; then
  exec node /app/service/cli.js status
fi
# Kernel lock is released even after a crash. Both modes use the same profile.
exec 9>"${DATA_DIR:-/data}/profile.lock"
flock -n -E 75 9 || { echo 'Browser profile is busy (login or another run).'; exit 75; }
if [[ "${1:-run}" == login ]]; then
  export DISPLAY=:99
  Xvfb "$DISPLAY" -screen 0 1360x900x24 -nolisten tcp &
  xvfb_pid=$!
  cleanup() {
    # Let Chromium flush its profile before tearing down its display.
    if [[ -n "${browser_pid:-}" ]]; then
      kill "$browser_pid" 2>/dev/null || true
      wait "$browser_pid" 2>/dev/null || true
    fi
    kill "${vnc_pid:-}" "${web_pid:-}" "${wm_pid:-}" "$xvfb_pid" 2>/dev/null || true
  }
  trap cleanup EXIT
  trap 'exit 0' TERM INT
  for n in {1..50}; do [[ -S /tmp/.X11-unix/X99 ]] && break; sleep .1; done
  fluxbox >/tmp/window-manager.log 2>&1 & wm_pid=$!
  x11vnc -display "$DISPLAY" -localhost -forever -shared -nopw -rfbport 5900 >/tmp/vnc.log 2>&1 & vnc_pid=$!
  websockify --web /usr/share/novnc 6080 localhost:5900 >/tmp/websockify.log 2>&1 & web_pid=$!
  node /app/service/cli.js login & browser_pid=$!
  wait "$browser_pid"
else
  exec node /app/service/cli.js "$@"
fi
