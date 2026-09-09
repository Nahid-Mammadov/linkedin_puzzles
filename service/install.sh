#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
service_dir="$PWD"
# Fixed systemd escaping is unnecessary for the supported server install path.
[[ "$service_dir" != *[[:space:]%]* ]] || { echo 'Install under a path without whitespace or %. ' >&2; exit 1; }
mkdir -p data "$HOME/.config/systemd/user"
chmod 700 data
docker compose build solver
cat > "$HOME/.config/systemd/user/linkedin-puzzles.service" <<UNIT
[Unit]
Description=Solve LinkedIn puzzles by request in headless Chromium
[Service]
Type=oneshot
WorkingDirectory=$service_dir
ExecStart=$(command -v docker) compose run --rm -T solver run
TimeoutStartSec=20min
TimeoutStopSec=45s
SuccessExitStatus=75
UNIT
cat > "$HOME/.config/systemd/user/linkedin-puzzles.timer" <<'UNIT'
[Unit]
Description=Daily LinkedIn puzzles at 4:30 AM Pacific
[Timer]
OnCalendar=*-*-* 04:30:00 America/Los_Angeles
Persistent=true
Unit=linkedin-puzzles.service
[Install]
WantedBy=timers.target
UNIT
systemctl --user daemon-reload
systemctl --user enable --now linkedin-puzzles.timer
systemctl --user list-timers linkedin-puzzles.timer --no-pager
