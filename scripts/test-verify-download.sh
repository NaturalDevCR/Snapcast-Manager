#!/usr/bin/env bash
#
# Task 75: standalone test harness for scripts/lib/verify-download.sh's pure
# verify_download_hash() function. No network, no root -- exercises the
# exact same function scripts/install.sh sources and calls, against real
# throwaway files created in a temp directory and their REAL, independently
# computed sha256 hashes (via `sha256sum`/`shasum` directly, not something
# the function itself generated) -- same pattern as
# scripts/test-migration-detection.sh (Task 16).
#
# Usage: bash scripts/test-verify-download.sh
# Exit 0: all assertions passed. Exit 1: at least one failed.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/verify-download.sh
source "$SCRIPT_DIR/lib/verify-download.sh"

pass=0
fail=0

assert_pass() {
  local desc="$1"; shift
  if verify_download_hash "$@" >/tmp/verify_download_test_out.$$ 2>&1; then
    echo "PASS: $desc -> verified (expected)"
    pass=$((pass + 1))
  else
    echo "FAIL: $desc -> expected pass, got failure:"
    sed 's/^/    /' /tmp/verify_download_test_out.$$
    fail=$((fail + 1))
  fi
  rm -f /tmp/verify_download_test_out.$$
}

assert_fail() {
  local desc="$1"; shift
  local expected_msg_substr="$1"; shift
  local out
  if out=$(verify_download_hash "$@" 2>&1); then
    echo "FAIL: $desc -> expected failure, got success"
    fail=$((fail + 1))
  else
    if printf '%s' "$out" | grep -qF -- "$expected_msg_substr"; then
      echo "PASS: $desc -> rejected with expected message (expected)"
      pass=$((pass + 1))
    else
      echo "FAIL: $desc -> rejected, but message did not contain '$expected_msg_substr'. Got: $out"
      fail=$((fail + 1))
    fi
  fi
}

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

TEST_FILE="$TMP_DIR/test-asset.bin"
printf 'snapcast-manager-release.zip test content for Task 75\n' > "$TEST_FILE"

if command -v sha256sum >/dev/null 2>&1; then
  REAL_SIZE=$(stat -c '%s' "$TEST_FILE" 2>/dev/null || stat -f '%z' "$TEST_FILE")
  REAL_HASH=$(sha256sum "$TEST_FILE" | cut -d ' ' -f 1)
elif command -v shasum >/dev/null 2>&1; then
  REAL_SIZE=$(stat -c '%s' "$TEST_FILE" 2>/dev/null || stat -f '%z' "$TEST_FILE")
  REAL_HASH=$(shasum -a 256 "$TEST_FILE" | cut -d ' ' -f 1)
else
  echo "Neither sha256sum nor shasum available -- cannot run this test harness." >&2
  exit 1
fi

echo "Real file size: $REAL_SIZE bytes"
echo "Real sha256: $REAL_HASH"
echo ""

WRONG_HASH="0000000000000000000000000000000000000000000000000000000000000000"
WRONG_SIZE=$((REAL_SIZE + 1))

# ---- cases that MUST pass ----

assert_pass "correct size + correct bare hash" \
  "$TEST_FILE" "$REAL_SIZE" "$REAL_HASH"

assert_pass "correct size + correct sha256:-prefixed hash (GitHub's own digest format)" \
  "$TEST_FILE" "$REAL_SIZE" "sha256:$REAL_HASH"

assert_pass "no expected size or digest provided (nothing to check against)" \
  "$TEST_FILE" "" ""

assert_pass "size provided, digest empty (only size checked)" \
  "$TEST_FILE" "$REAL_SIZE" ""

assert_pass "digest provided, size empty (only hash checked)" \
  "$TEST_FILE" "" "$REAL_HASH"

# ---- cases that MUST fail ----

assert_fail "wrong size" "size mismatch" \
  "$TEST_FILE" "$WRONG_SIZE" "$REAL_HASH"

assert_fail "wrong hash (deliberately incorrect, correct size)" "hash mismatch" \
  "$TEST_FILE" "$REAL_SIZE" "$WRONG_HASH"

assert_fail "wrong hash with sha256: prefix (deliberately incorrect)" "hash mismatch" \
  "$TEST_FILE" "$REAL_SIZE" "sha256:$WRONG_HASH"

assert_fail "size checked before hash: wrong size reported even with a correct digest" "size mismatch" \
  "$TEST_FILE" "$WRONG_SIZE" "$REAL_HASH"

assert_fail "missing file" "file not found" \
  "$TMP_DIR/does-not-exist.bin" "$REAL_SIZE" "$REAL_HASH"

echo ""
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
