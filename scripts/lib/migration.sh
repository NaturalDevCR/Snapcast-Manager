#!/usr/bin/env bash
#
# Task 16: pure string-logic used by scripts/install.sh to decide whether an
# on-disk snapmanager.service unit file needs migrating to the hardened
# User=snapmanager configuration. Deliberately takes unit file CONTENT as a
# plain string argument (never a path, never touches the filesystem, never
# calls systemctl/useradd/sudo) so it can be exercised by the standalone
# test harness (scripts/test-migration-detection.sh) in any environment,
# including this macOS dev machine with no real systemd/root -- see
# .superpowers/sdd/task-16-report.md's "Testing" section.
#
# Sourced by scripts/install.sh; not meant to be run directly.

# unit_file_user CONTENT
# Prints the value of the first "User=" directive found in CONTENT (a unit
# file's full text), or nothing if no such line is present. Leading
# whitespace before "User", whitespace around "=", and trailing whitespace
# on the value are all tolerated. A line that is itself commented out
# (starts with '#', ignoring leading whitespace) is skipped.
unit_file_user() {
  printf '%s\n' "$1" \
    | grep -E '^[[:space:]]*User[[:space:]]*=' \
    | head -n1 \
    | sed -E 's/^[[:space:]]*User[[:space:]]*=[[:space:]]*//; s/[[:space:]]*$//'
}

# unit_needs_user_migration CONTENT
# Returns 0 (true / "needs migration") unless CONTENT already has
# User=snapmanager set exactly. This is a deliberately broader condition
# than the task brief's literal "User= unset or User=root" -- it also
# treats any OTHER pre-existing User= value (e.g. a non-root sudo-capable
# login user under which install.sh happened to have been run pre-Task-16)
# as needing migration, since the end state this app wants is always
# exactly User=snapmanager. This is a superset of the brief's two named
# cases, not a narrower interpretation -- see task-16-report.md.
unit_needs_user_migration() {
  local content="$1"
  local current
  current="$(unit_file_user "$content")"
  [ "$current" != "snapmanager" ]
}
