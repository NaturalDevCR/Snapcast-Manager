#!/usr/bin/env bash
#
# Task 16: standalone test harness for scripts/lib/migration.sh's pure
# unit-file-User= detection logic. No root, no systemd, no useradd, no
# filesystem writes outside this process -- exercises the exact same
# functions scripts/install.sh sources and calls, against sample unit-file
# CONTENT strings only. Runnable anywhere bash is, including this macOS
# dev environment.
#
# Usage: bash scripts/test-migration-detection.sh
# Exit 0: all assertions passed. Exit 1: at least one failed.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/migration.sh
source "$SCRIPT_DIR/lib/migration.sh"

pass=0
fail=0

assert_needs_migration() {
  local desc="$1" content="$2"
  if unit_needs_user_migration "$content"; then
    echo "PASS: $desc -> needs migration (expected)"
    pass=$((pass + 1))
  else
    echo "FAIL: $desc -> expected needs-migration=true, got false"
    fail=$((fail + 1))
  fi
}

assert_already_migrated() {
  local desc="$1" content="$2"
  if unit_needs_user_migration "$content"; then
    echo "FAIL: $desc -> expected needs-migration=false, got true"
    fail=$((fail + 1))
  else
    echo "PASS: $desc -> already migrated (expected)"
    pass=$((pass + 1))
  fi
}

# ---- cases that MUST be detected as needing migration ----

assert_needs_migration "no User= line at all (genuine pre-Task-16 install)" "$(cat <<'EOF'
[Unit]
Description=Snapcast Manager Service
After=network.target snapserver.service

[Service]
Type=simple
WorkingDirectory=/opt/snapcast-manager/server
ExecStart=/usr/bin/node dist/index.js
Restart=always
EnvironmentFile=/opt/snapcast-manager/server/.env

[Install]
WantedBy=multi-user.target
EOF
)"

assert_needs_migration "User=root (install.sh run directly as root, pre-Task-16)" "$(printf '[Service]\nType=simple\nUser=root\nExecStart=/usr/bin/node dist/index.js\n')"

assert_needs_migration "User=pi (install.sh run as a non-root sudo-capable login user, pre-Task-16)" "$(printf '[Service]\nType=simple\nUser=pi\nExecStart=/usr/bin/node dist/index.js\n')"

assert_needs_migration "empty content (no unit file at all / read failure upstream)" ""

assert_needs_migration "User=snapmanager2 (must not false-match a similar-but-different value)" "$(printf '[Service]\nUser=snapmanager2\n')"

assert_needs_migration "User= with trailing garbage on the same line is not an exact match" "$(printf '[Service]\nUser=snapmanager # legacy comment style, not really a comment to systemd\n')"

# ---- cases that MUST be detected as already migrated (no-op) ----

assert_already_migrated "User=snapmanager, clean" "$(printf '[Service]\nType=simple\nUser=snapmanager\nExecStart=/usr/bin/node dist/index.js\n')"

assert_already_migrated "User=snapmanager with surrounding whitespace" "$(printf '[Service]\n  User=snapmanager   \nExecStart=/usr/bin/node dist/index.js\n')"

assert_already_migrated "User=snapmanager as the only line" "User=snapmanager"

echo ""
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
