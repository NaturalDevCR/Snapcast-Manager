#!/usr/bin/env bash
#
# Regression guard for the Tailwind v4 token system (Task 18).
#
# Context: client/ uses Tailwind v4, which is CSS-first -- utility classes
# only exist if their color/font names are registered in an `@theme` block
# in client/src/style.css. There used to be a v3-style client/tailwind.config.js
# sitting next to it that LOOKED authoritative but was never read by
# Tailwind v4 (no `@config` directive referenced it anywhere), so classes
# like `bg-brand-primary`, `text-brand-primary`, `text-text-main` and
# `text-text-muted` -- all used extensively across client/src/**/*.vue --
# silently compiled to nothing. The bug was invisible in casual testing
# because most text still looked right by inheritance from `body`.
#
# This script rebuilds the client and asserts that the compiled CSS still
# contains real rules for a small, fixed set of utility classes that can
# only exist if the @theme block in style.css is intact. If someone edits
# style.css and drops/renames one of these @theme entries, or the
# tailwind.config.js/@theme wiring regresses in some other way, this script
# fails loudly instead of shipping silently-broken styling again.
#
# Exit 0: all expected classes found with non-empty rules.
# Exit 1: build failed, or a build succeeded but is missing one or more
#         expected classes.

set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Building client (npm run build)..."
npm run build

CSS_FILES=(dist/assets/*.css)
if [[ ! -e "${CSS_FILES[0]}" ]]; then
  echo "FAIL: no CSS file found under dist/assets/ after build." >&2
  exit 1
fi

# Tailwind v4 minifies output and groups selectors that share a declaration
# block with commas (e.g. ".bg-brand-primary,.bg-brand-primary\/5{...}"), so
# each expected class must be matched as a selector token immediately
# followed by "," or "{" -- not merely present as a substring of a longer
# opacity-modifier class name like ".bg-brand-primary\/10".
#
# Selectors are escaped by Tailwind v4 as literal ".<escaped-class>{" /
# ".<escaped-class>," in the compiled CSS (verified against a real build's
# output -- plain dashes in these particular class names need no escaping).
EXPECTED_CLASSES=(
  ".bg-brand-primary"
  ".text-brand-primary"
  ".border-brand-primary"
  ".bg-brand-bg"
  ".bg-brand-surface"
  ".text-text-main"
  ".text-text-muted"
  ".font-sans"
)

MISSING=()
for cls in "${EXPECTED_CLASSES[@]}"; do
  # Escape the leading "." for the regex, then require it's followed by
  # "," or "{" (not "\/", which would mean it's only present as the base of
  # an opacity-modifier variant such as .bg-brand-primary\/10).
  pattern="\\${cls}[,{]"
  if ! grep -qE "$pattern" "${CSS_FILES[@]}"; then
    MISSING+=("$cls")
  fi
done

if [[ ${#MISSING[@]} -gt 0 ]]; then
  echo "FAIL: the following expected Tailwind utility classes are missing from the compiled CSS:" >&2
  for cls in "${MISSING[@]}"; do
    echo "  - $cls" >&2
  done
  echo "" >&2
  echo "This means the Tailwind v4 @theme block in client/src/style.css (or its" >&2
  echo "wiring) has regressed -- these utility classes are used throughout" >&2
  echo "client/src/**/*.vue and MUST compile to real CSS rules. See Task 18" >&2
  echo "(.superpowers/sdd/task-18-report.md) for the original bug writeup." >&2
  exit 1
fi

echo "==> OK: all expected theme utility classes are present in the compiled CSS."
