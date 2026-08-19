#!/usr/bin/env bash
#
# Early-warning check for the shell-command-injection pattern used
# throughout server/src today: building a shell command string with a
# template literal (backtick string containing dollar-brace interpolation)
# and handing it straight to child_process's exec/execAsync, or to one of
# this codebase's local wrappers around them (this.run, this.runCommand).
# That string is executed through a shell, so any interpolated value that
# isn't strictly validated is a command-injection vector.
#
# Example of what this catches (server/src/services/pipeSources.ts):
#   await this.run(`${this.SUDO}systemctl stop ${getSystemdServiceName(pipe.name)}`);
#
# Excludes server/src/platform/ -- the safe home Stage 1 of
# docs/superpowers/plans/2026-08-18-professional-hardening.md will create,
# migrating these call sites to spawn() with an argv array instead of a
# shell string. This script only adds the check; it does not fix anything.
#
# Uses perl (present by default on macOS and GitHub Actions ubuntu runners)
# because the vulnerable template literals sometimes span multiple lines
# (e.g. server/src/services/system.ts), which a single-line grep would miss.
#
# Exit 0: no matches (clean).
# Exit 1: matches found (expected today -- see Stage 1 of the hardening plan).

set -euo pipefail

cd "$(dirname "$0")/.."

TARGET_DIR="server/src"
EXCLUDE_PREFIX="server/src/platform/"

RESULTS_FILE="$(mktemp)"
trap 'rm -f "$RESULTS_FILE"' EXIT

while IFS= read -r -d '' file; do
  if [[ "$file" == "$EXCLUDE_PREFIX"* ]]; then
    continue
  fi
  perl -0777 -ne '
    while (/(?:^|[^A-Za-z0-9_])(?:exec|execAsync|this\.run|this\.runCommand)\(\s*`([^`]*)`/gs) {
      my $body = $1;
      # Capture the match offset immediately -- @- / @+ are clobbered by
      # any subsequent regex match, including the $body =~ ... check below.
      my $start = $-[0];
      if ($body =~ /\$\{/) {
        my $upto = substr($_, 0, $start);
        my $line = 1 + ($upto =~ tr/\n//);
        print "$ARGV:$line\n";
      }
    }
  ' "$file" >> "$RESULTS_FILE"
done < <(find "$TARGET_DIR" -type f -name '*.ts' -print0)

if [ -s "$RESULTS_FILE" ]; then
  sort -u "$RESULTS_FILE"
  {
    echo ""
    echo "Shell-injection-prone pattern found: exec-family call built from a"
    echo "template literal with dollar-brace interpolation. See Stage 1 of"
    echo "docs/superpowers/plans/2026-08-18-professional-hardening.md."
  } >&2
  exit 1
fi

echo "No shell-injection-prone exec-family template-literal patterns found under $TARGET_DIR."
exit 0
