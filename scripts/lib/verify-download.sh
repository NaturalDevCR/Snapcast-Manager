#!/usr/bin/env bash
#
# Task 75: pure size+hash verification logic used by scripts/install.sh's
# remote-download flow to verify a downloaded release .zip against the
# size/digest fields GitHub's own Releases API already returns for that
# asset (see the API-parsing logic in install.sh itself, immediately above
# where this is sourced, for how those values are extracted). Deliberately
# takes a FILE PATH + expected size/digest as plain arguments (never reaches
# out to the network itself) so it can be exercised by the standalone test
# harness (scripts/test-verify-download.sh) against real throwaway files, in
# any environment -- same pattern as scripts/lib/migration.sh /
# scripts/test-migration-detection.sh (Task 16).
#
# This is the bash equivalent of server/src/services/system.ts's
# verifyDownloadedAsset() (Task 61): size checked first (cheap), then a real
# SHA256 hash computed and compared, and ANY mismatch (missing file, size
# mismatch, or hash mismatch) returns failure -- callers are expected to
# abort BEFORE extraction/install on a non-zero return, exactly matching
# verifyDownloadedAsset()'s "abort before dpkg -i" discipline.
#
# Sourced by scripts/install.sh; not meant to be run directly.

# verify_download_hash FILE_PATH EXPECTED_SIZE EXPECTED_DIGEST
#
# FILE_PATH: path to the already-downloaded file to verify.
# EXPECTED_SIZE: size in bytes as reported by GitHub's API (the asset's
#   "size" field), or empty string if unavailable -- the size check is
#   skipped (not failed) when empty, matching verifyDownloadedAsset()'s own
#   `typeof expectedSize === 'number'` guard.
# EXPECTED_DIGEST: GitHub's own "digest" field, either in its native
#   "sha256:<hex>" form or bare "<hex>" -- both accepted, so callers can
#   pass the raw API value through unmodified. Empty string skips the hash
#   check (matching verifyDownloadedAsset()'s own `if (expectedDigest)`
#   guard) -- this is NOT the same as a mismatch; it means "nothing to
#   verify the hash against" (e.g. GitHub's source-archive fallback zip,
#   which is not a release asset and has no digest field at all).
#
# Returns 0 if every check that HAD data to compare against passed
# (including the degenerate case where both EXPECTED_SIZE and
# EXPECTED_DIGEST are empty -- nothing to check, so nothing failed).
# Returns 1 and prints a clear message to stderr on the file being missing,
# a size mismatch, or a hash mismatch. Size is always checked before hash.
verify_download_hash() {
  local file_path="$1"
  local expected_size="$2"
  local expected_digest="$3"

  if [ ! -f "$file_path" ]; then
    echo "verify_download_hash: file not found: $file_path" >&2
    return 1
  fi

  if [ -n "$expected_size" ]; then
    local actual_size
    # GNU stat (Linux/coreutils, the real target platform per this script's
    # header) uses -c; BSD/macOS stat (this dev machine, useful for running
    # the test harness locally) uses -f -- try both, in that order, so this
    # function itself stays portable for local testing even though
    # install.sh only ever actually runs on Debian/Ubuntu.
    actual_size=$(stat -c '%s' "$file_path" 2>/dev/null || stat -f '%z' "$file_path" 2>/dev/null)
    if [ -z "$actual_size" ]; then
      echo "verify_download_hash: unable to determine file size for $file_path" >&2
      return 1
    fi
    if [ "$actual_size" != "$expected_size" ]; then
      echo "verify_download_hash: size mismatch for $file_path -- GitHub reported $expected_size bytes, got $actual_size bytes" >&2
      return 1
    fi
  fi

  if [ -n "$expected_digest" ]; then
    local expected_hash actual_hash
    expected_hash="${expected_digest#sha256:}"
    if command -v sha256sum >/dev/null 2>&1; then
      actual_hash=$(sha256sum "$file_path" | cut -d ' ' -f 1)
    elif command -v shasum >/dev/null 2>&1; then
      actual_hash=$(shasum -a 256 "$file_path" | cut -d ' ' -f 1)
    else
      echo "verify_download_hash: neither sha256sum nor shasum is available to compute a hash" >&2
      return 1
    fi
    if [ "$actual_hash" != "$expected_hash" ]; then
      echo "verify_download_hash: hash mismatch for $file_path -- GitHub reported sha256:$expected_hash, computed sha256:$actual_hash" >&2
      return 1
    fi
  fi

  return 0
}
