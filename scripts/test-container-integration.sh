#!/bin/bash
# Task 65 (Stage 5, item 5.6): container-based integration test.
#
# Runs INSIDE the systemd-PID-1 container built from
# docker/Dockerfile.integration-test (see .github/workflows/
# container-integration.yml, which `docker exec`s this script into the
# running container as root -- the same way a real admin installing this
# app for the first time would run install.sh: as root, or root-equivalent
# via sudo). Exercises, against a REAL running instance on a REAL
# filesystem with REAL systemd units (no mocks anywhere in this file):
#
#   1. scripts/install.sh -y (LOCAL-source flow) -- asserts snapmanager.service
#      is genuinely active afterward, not just that the script exited 0.
#   2. First-run setup (POST /api/auth/setup, GET /api/auth/setup-status, POST /api/auth/login).
#   3. Pipe source creation (POST /api/pipe-sources) -- asserts the FIFO,
#      the generated systemd unit, and the snapserver.conf edit are all
#      genuinely on disk.
#   4. Adoption of a hand-created, unmanaged pipe (POST /api/pipe-sources/adopt)
#      -- asserts discover() finds it and adopt() reuses (not duplicates)
#      its existing unit file.
#   5. Backup + restore (POST /api/snapshots, POST /api/snapshots/:id/restore)
#      -- asserts a real filesystem change is genuinely reverted. See this
#      script's own "Step 5" comment below for an important, disclosed
#      scope note on which backup mechanism this actually exercises.
#   6. Old-style-DB migration -- constructs a genuine (not synthetic) pre-
#      schema_migrations database by stripping that table from the real DB
#      steps 1-5 already produced, restarts the app against it, and asserts
#      it starts cleanly with the pre-existing data intact.
#   7. Reboot simulation (Task 66) -- stops the unit, `rm -rf`s
#      /run/snapcast-manager to reproduce a real host reboot's tmpfs wipe,
#      restarts it, and asserts it comes up clean with the directory
#      recreated snapmanager:audio mode 770 by the unit's own
#      RuntimeDirectory= directive (not the installer's one-time mkdir,
#      which never runs again after install).
#   8. services/backup.ts's real BackupService round-trip (POST
#      /api/system/install/mpd, POST /api/system/update/mpd, POST
#      /api/system/backups/restore) -- the job-based install/update path
#      Step 5's scope note above says routes/snapshot.ts does NOT exercise.
#      Installs the real `mpd` Debian package, updates it (which runs
#      safeBackupOrAbort() -> createPreUpdateBackup() -> a REAL `sudo tar
#      czf`), and restores that backup (a REAL staged `sudo tar -xzf` +
#      `sudo cp -r -T`) -- proving all of it genuinely works under the
#      hardened snapmanager sandbox. Closes/verifies three real gaps found
#      while doing this verification, all disclosed in SECURITY.md: (1)
#      `/usr/bin/tar` missing from scripts/sudoers.d/snapcast-manager
#      entirely (Task 65's own disclosed-but-unfixed finding); (2)
#      `ReadWritePaths=` never covering a real `apt-get install`'s actual
#      write targets; (3) `restoreBackup()`'s old in-place `tar -xPzf`
#      failing on any individually-granted single file.
#
# Every step asserts something concrete and independently checkable (a real
# systemd active-state, a real file's real content, a real HTTP response
# body) -- never just "the previous command's exit code was 0" alone, per
# the task brief's explicit requirement.
#
# Exits non-zero (via `fail`) on the first assertion that doesn't hold, and
# dumps diagnostic context (journal, systemctl status, last API response)
# on the way out so a real CI failure is debuggable from the workflow log
# alone.

set -uo pipefail

REPO_DIR="/opt/snapcast-manager"
PORT="3000"
BASE_URL="http://127.0.0.1:${PORT}"
SERVICE_NAME="snapmanager"
DB_PATH="${REPO_DIR}/data/snapmanager.db"
API_BODY_FILE="$(mktemp)"

# ---- output helpers ----
GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
step()  { echo -e "\n${CYAN}==> $*${NC}"; }
ok()    { echo -e "${GREEN}[OK]${NC} $*"; }
info()  { echo -e "    $*"; }

fail() {
  echo -e "\n${RED}[FAIL]${NC} $*" >&2
  echo -e "${YELLOW}---- diagnostics ----${NC}" >&2
  echo "--- systemctl status ${SERVICE_NAME} ---" >&2
  systemctl status "${SERVICE_NAME}" --no-pager -l 2>&1 | tail -n 40 >&2 || true
  echo "--- journalctl -u ${SERVICE_NAME} (last 100 lines) ---" >&2
  journalctl -u "${SERVICE_NAME}" -n 100 --no-pager 2>&1 >&2 || true
  # `ExecError`'s own `.message` is deliberately just "<bin> exited with
  # code <n>" (see server/src/platform/exec.ts) -- never the real
  # stdout/stderr, so a sudo-related failure surfaced through an API
  # response body alone is otherwise a dead end to debug from CI logs.
  # sudo logs its own PAM/audit messages under the "sudo" syslog identifier
  # regardless of which unit invoked it, independent of -u snapmanager.
  echo "--- journalctl -t sudo (last 50 lines) ---" >&2
  journalctl -t sudo -n 50 --no-pager 2>&1 >&2 || true
  echo "--- last API response body (${API_BODY_FILE}) ---" >&2
  cat "${API_BODY_FILE}" 2>&1 >&2 || true
  echo >&2
  exit 1
}

# ---- generic wait helpers ----
wait_for_active() {
  local unit="$1" timeout="${2:-30}" waited=0
  while [ "$waited" -lt "$timeout" ]; do
    if systemctl is-active --quiet "$unit"; then return 0; fi
    sleep 1
    waited=$((waited + 1))
  done
  return 1
}

wait_for_http() {
  local url="$1" timeout="${2:-30}" waited=0
  while [ "$waited" -lt "$timeout" ]; do
    if curl -sS -o /dev/null -w '' --max-time 2 "$url" 2>/dev/null; then return 0; fi
    sleep 1
    waited=$((waited + 1))
  done
  return 1
}

wait_for_path() {
  local path="$1" timeout="${2:-10}" waited=0
  while [ "$waited" -lt "$timeout" ]; do
    if [ -e "$path" ]; then return 0; fi
    sleep 1
    waited=$((waited + 1))
  done
  return 1
}

# Polls GET /api/system/jobs/:id (routes/system.ts's jobService-backed
# endpoint) until the job reaches a terminal status ('done'/'error') or
# `timeout` seconds elapse. Writes the job's own JSON body to
# $API_BODY_FILE on every poll (same convention as `api()`) so callers can
# read `.status`/`.output`/`.error`/`.log` via `api_field` immediately
# afterward, and sets $JOB_STATUS to the final status ("timeout" if it never
# reached a terminal one). Package installs/updates genuinely take tens of
# seconds (real apt-get), so this polls on a longer interval than the other
# wait_for_* helpers above.
JOB_STATUS=""
wait_for_job() {
  local job_id="$1" timeout="${2:-120}" waited=0
  while [ "$waited" -lt "$timeout" ]; do
    api GET "/api/system/jobs/${job_id}"
    if [ "$API_STATUS" = "200" ]; then
      JOB_STATUS="$(api_field '.status')"
      if [ "$JOB_STATUS" = "done" ] || [ "$JOB_STATUS" = "error" ] || [ "$JOB_STATUS" = "interrupted" ]; then
        return 0
      fi
    fi
    sleep 2
    waited=$((waited + 2))
  done
  JOB_STATUS="timeout"
  return 1
}

# ---- tiny JSON HTTP client (curl + jq) ----
# Sets $API_STATUS (HTTP status code) and writes the response body to
# $API_BODY_FILE (read back via `jq` at each call site). Auth is applied
# via the global $AUTH_TOKEN when non-empty.
API_STATUS=""
AUTH_TOKEN=""
api() {
  local method="$1" path="$2" data="${3:-}"
  local args=(-sS -o "$API_BODY_FILE" -w '%{http_code}' -X "$method" "${BASE_URL}${path}" -H 'Content-Type: application/json')
  if [ -n "$AUTH_TOKEN" ]; then
    args+=(-H "Authorization: Bearer ${AUTH_TOKEN}")
  fi
  if [ -n "$data" ]; then
    args+=(-d "$data")
  fi
  API_STATUS="$(curl "${args[@]}")"
}

api_field() { jq -r "$1" "$API_BODY_FILE"; }

assert_status() {
  local expected="$1" context="$2"
  if [ "$API_STATUS" != "$expected" ]; then
    fail "$context: expected HTTP $expected, got $API_STATUS. Body: $(cat "$API_BODY_FILE")"
  fi
}

assert_file_contains() {
  local file="$1" pattern="$2" context="$3"
  [ -f "$file" ] || fail "$context: file $file does not exist"
  grep -qF -- "$pattern" "$file" || fail "$context: $file does not contain expected text: $pattern"
}

assert_file_not_contains() {
  local file="$1" pattern="$2" context="$3"
  [ -f "$file" ] || fail "$context: file $file does not exist"
  if grep -qF -- "$pattern" "$file"; then
    fail "$context: $file still contains text that should have been removed: $pattern"
  fi
}

# ============================================================================
# Step 1: Installation
# ============================================================================
step_1_installation() {
  step "Step 1/7: install.sh -y (LOCAL-source flow)"

  cd "$REPO_DIR" || fail "Step 1: $REPO_DIR does not exist"
  [ -d server ] && [ -d client ] || fail "Step 1: server/ or client/ missing from $REPO_DIR -- install.sh would take the REMOTE-download flow, not the local one this test requires"

  # Non-interactive, full ("both") install. install.sh itself already
  # exits non-zero (`set -e`) on any real failure, so a non-zero exit here
  # is a genuine install failure, not a soft warning.
  bash scripts/install.sh -y || fail "Step 1: install.sh -y exited non-zero"

  # The concrete, independently-checkable assertion the brief requires:
  # not just "the script exited 0", but that the REAL systemd unit it
  # created is genuinely active.
  #
  # NOTE (disclosed correction to this task's own brief): the brief's
  # wording for this step says to check `systemctl is-active snapserver`.
  # That is the Snapcast audio SERVER package, which install.sh's own
  # banner explicitly says it does NOT install ("Snapserver/Snapclient
  # will NOT be installed automatically"). The unit install.sh actually
  # creates and starts is `snapmanager.service` (SERVICE_NAME in
  # install.sh) -- the web dashboard/control server itself. That is the
  # unit checked below; see task-65-report.md for the full writeup.
  wait_for_active "$SERVICE_NAME" 30 || fail "Step 1: systemctl is-active $SERVICE_NAME did not become active within 30s"
  ok "systemctl is-active ${SERVICE_NAME}: active"

  # Regression guard: every privileged action the running app takes
  # (server/src/platform/exec.ts's needsSudo()-gated calls) depends on
  # `sudo` actually being able to escalate snapmanager -> root from INSIDE
  # this unit's own sandbox. This is what actually caught this task's
  # single biggest finding -- `NoNewPrivileges=yes` (previously in the
  # unit's own [Service] section) breaks setuid-based escalation, including
  # `sudo` itself, for the whole unit's process tree; confirmed for real via
  # this exact command class returning exit 1 with NO stderr at all before
  # that line was removed from install.sh (see task-65-report.md).
  #
  # Uses `systemctl daemon-reload` (not e.g. `sudo -n true`) deliberately:
  # `/etc/sudoers.d/snapcast-manager` scopes its NOPASSWD grants to
  # specific, literal commands (never a blanket "any command" rule -- see
  # SECURITY.md's "Privilege model"), so this must probe with a command
  # that is ACTUALLY granted (matching exactly what daemonReload() itself
  # calls in server/src/platform/systemd.ts) to distinguish "NoNewPrivileges
  # breaks sudo entirely" (silent exit 1, no stderr) from "this specific
  # command isn't in the sudoers grant" ("sudo: a password is required",
  # a completely different and unrelated failure this probe must NOT
  # conflate with the NoNewPrivileges regression it exists to catch --
  # `true` is not in the grant list, and correctly reproduced this exact
  # confusion during this task's own iteration).
  runuser -u snapmanager -- sudo -n systemctl daemon-reload || fail "Step 1: 'sudo -n systemctl daemon-reload' as snapmanager failed -- either sudo cannot escalate from inside this unit's sandbox (check for a reintroduced NoNewPrivileges=yes) or the sudoers.d grant for it is missing/broken"
  ok "sudo escalation works from inside the running unit (runuser -u snapmanager -- sudo -n systemctl daemon-reload)"

  [ "$(systemctl show "$SERVICE_NAME" -p User --value)" = "snapmanager" ] || fail "Step 1: systemctl show $SERVICE_NAME -p User did not report 'snapmanager' -- SECURITY.md's real-hardware checklist item 1"
  ok "systemctl show ${SERVICE_NAME} -p User: snapmanager (not root) -- SECURITY.md checklist item 1"

  [ -f "${REPO_DIR}/server/dist/index.js" ] || fail "Step 1: server/dist/index.js was not built"
  [ -f "${REPO_DIR}/client/dist/index.html" ] || fail "Step 1: client/dist/index.html was not built"
  ok "server and client build output present on disk"

  wait_for_http "${BASE_URL}/api/status" 30 || fail "Step 1: ${BASE_URL}/api/status did not respond within 30s of the service becoming active"
  api GET /api/status
  assert_status 200 "GET /api/status"
  [ "$(api_field '.status')" = "online" ] || fail "Step 1: GET /api/status body did not report status=online: $(cat "$API_BODY_FILE")"
  ok "GET /api/status: 200, status=online"
}

# ============================================================================
# Step 2: First-run setup
# ============================================================================
ADMIN_USERNAME="task65admin"
ADMIN_PASSWORD="Task65Integration!"   # 19 chars, clears MIN_PASSWORD_LENGTH=12

step_2_setup() {
  step "Step 2/7: first-run setup (POST /api/auth/setup, GET /api/auth/setup-status, POST /api/auth/login)"

  api GET /api/auth/setup-status
  assert_status 200 "GET /api/auth/setup-status (pre-setup)"
  [ "$(api_field '.isInitialized')" = "false" ] || fail "Step 2: expected isInitialized=false before setup, got: $(cat "$API_BODY_FILE")"
  ok "GET /api/auth/setup-status (pre-setup): isInitialized=false"

  api POST /api/auth/setup "$(jq -n --arg u "$ADMIN_USERNAME" --arg p "$ADMIN_PASSWORD" '{username:$u,password:$p}')"
  assert_status 201 "POST /api/auth/setup"
  local setup_token
  setup_token="$(api_field '.token')"
  [ -n "$setup_token" ] && [ "$setup_token" != "null" ] || fail "Step 2: POST /api/auth/setup did not return a token: $(cat "$API_BODY_FILE")"
  [ "$(api_field '.user.username')" = "$ADMIN_USERNAME" ] || fail "Step 2: created user's username mismatch: $(cat "$API_BODY_FILE")"
  ok "POST /api/auth/setup: 201, admin user '${ADMIN_USERNAME}' created"

  api GET /api/auth/setup-status
  assert_status 200 "GET /api/auth/setup-status (post-setup)"
  [ "$(api_field '.isInitialized')" = "true" ] || fail "Step 2: expected isInitialized=true after setup, got: $(cat "$API_BODY_FILE")"
  ok "GET /api/auth/setup-status (post-setup): isInitialized=true"

  api POST /api/auth/login "$(jq -n --arg u "$ADMIN_USERNAME" --arg p "$ADMIN_PASSWORD" '{username:$u,password:$p}')"
  assert_status 200 "POST /api/auth/login"
  AUTH_TOKEN="$(api_field '.token')"
  [ -n "$AUTH_TOKEN" ] && [ "$AUTH_TOKEN" != "null" ] || fail "Step 2: POST /api/auth/login did not return a token: $(cat "$API_BODY_FILE")"
  ok "POST /api/auth/login: 200, JWT obtained"
}

# ============================================================================
# Step 3: Pipe source creation
# ============================================================================
PIPE1_NAME="Test Radio Station"
PIPE1_FIFO="/run/snapcast-manager/snapfifo_test_radio_station"
PIPE1_UNIT="/etc/systemd/system/snapcast-radio-test-radio-station.service"
PIPE1_URL="http://example.invalid/stream.mp3"

step_3_create_pipe_source() {
  step "Step 3/7: pipe source creation (POST /api/pipe-sources)"

  api POST /api/pipe-sources "$(jq -n --arg n "$PIPE1_NAME" --arg u "$PIPE1_URL" '{name:$n,type:"radio",url:$u}')"
  assert_status 200 "POST /api/pipe-sources"
  local pipe_id
  pipe_id="$(api_field '.id')"
  [ -n "$pipe_id" ] && [ "$pipe_id" != "null" ] || fail "Step 3: POST /api/pipe-sources did not return an id: $(cat "$API_BODY_FILE")"
  ok "POST /api/pipe-sources: 200, id=${pipe_id}"

  # 1) The FIFO genuinely exists on disk (created by the generated unit's
  #    own ExecStartPre, which `systemctl start` already blocked on).
  wait_for_path "$PIPE1_FIFO" 10 || fail "Step 3: FIFO $PIPE1_FIFO was never created"
  [ -p "$PIPE1_FIFO" ] || fail "Step 3: $PIPE1_FIFO exists but is not a FIFO"
  ok "FIFO exists and is a real named pipe: ${PIPE1_FIFO}"

  # 2) The generated systemd unit exists and is correctly named/content.
  [ -f "$PIPE1_UNIT" ] || fail "Step 3: systemd unit $PIPE1_UNIT was not created"
  assert_file_contains "$PIPE1_UNIT" "$PIPE1_FIFO" "Step 3 unit file"
  assert_file_contains "$PIPE1_UNIT" "$PIPE1_URL" "Step 3 unit file"
  ok "systemd unit exists and references the right FIFO/URL: $(basename "$PIPE1_UNIT")"

  # 3) snapserver.conf (the real master config file) was actually updated.
  assert_file_contains /etc/snapserver.conf "$PIPE1_FIFO" "Step 3 snapserver.conf"
  assert_file_contains /etc/snapserver.conf "pipe://" "Step 3 snapserver.conf"
  ok "/etc/snapserver.conf contains the new pipe:// stream source"

  # 4) GET /api/pipe-sources reports it with the expected computed paths.
  api GET /api/pipe-sources
  assert_status 200 "GET /api/pipe-sources"
  local listed_fifo listed_service
  listed_fifo="$(jq -r --arg id "$pipe_id" '.[] | select(.id==$id) | .fifoPath' "$API_BODY_FILE")"
  listed_service="$(jq -r --arg id "$pipe_id" '.[] | select(.id==$id) | .serviceName' "$API_BODY_FILE")"
  [ "$listed_fifo" = "$PIPE1_FIFO" ] || fail "Step 3: listed fifoPath mismatch: got '$listed_fifo', expected '$PIPE1_FIFO'"
  [ "$listed_service" = "snapcast-radio-test-radio-station" ] || fail "Step 3: listed serviceName mismatch: got '$listed_service'"
  ok "GET /api/pipe-sources lists the new pipe with the correct fifoPath/serviceName"
}

# ============================================================================
# Step 4: Adoption
# ============================================================================
LEGACY_NAME="Legacy Radio"
LEGACY_FIFO="/run/snapcast-manager/snapfifo_legacy_radio"
LEGACY_UNIT_BASENAME="snapcast-radio-legacy-radio"
LEGACY_UNIT="/etc/systemd/system/${LEGACY_UNIT_BASENAME}.service"
LEGACY_URL="http://example.invalid/legacy-stream.mp3"

step_4_adoption() {
  step "Step 4/7: adoption of a hand-created, unmanaged pipe source"

  # ---- Simulate a pre-existing, unmanaged setup, created OUTSIDE the app's own API ----
  mkdir -p /run/snapcast-manager
  chmod 0770 /run/snapcast-manager
  chgrp audio /run/snapcast-manager 2>/dev/null || true
  [ -p "$LEGACY_FIFO" ] || mkfifo -m 660 "$LEGACY_FIFO"
  chgrp audio "$LEGACY_FIFO" 2>/dev/null || true
  ok "Hand-created FIFO outside the app: ${LEGACY_FIFO}"

  # Append a `pipe://` source line directly to the LIVE master config
  # (mirrors exactly what a pre-existing, unmanaged install's snapserver.conf
  # would already contain), inserted right after the `[stream]` section
  # header so SnapConfigParser's sequential section-scan attributes it to
  # that section regardless of what else is already in the file.
  python3 - "$LEGACY_FIFO" "$LEGACY_NAME" <<'PYEOF'
import sys
fifo, name = sys.argv[1], sys.argv[2]
from urllib.parse import quote
path = "/etc/snapserver.conf"
with open(path) as f:
    lines = f.readlines()
source_line = (
    f"source = pipe://{fifo}?name={quote(name)}&codec=pcm&sampleformat=48000:16:2"
    "&idle_threshold=15000&send_silence=true&mode=create\n"
)
out = []
inserted = False
for line in lines:
    out.append(line)
    if not inserted and line.strip() == "[stream]":
        out.append(source_line)
        inserted = True
if not inserted:
    out.append("[stream]\n")
    out.append(source_line)
with open(path, "w") as f:
    f.writelines(out)
PYEOF
  assert_file_contains /etc/snapserver.conf "$LEGACY_FIFO" "Step 4 manual snapserver.conf edit"
  ok "Manually appended a pipe:// source line to /etc/snapserver.conf's [stream] section"

  # Hand-write a matching systemd unit -- same shape buildRadioServiceContent()
  # produces, so findServiceForFifo()'s content parsing (reconnect flags, -i URL)
  # has something real to extract.
  cat > "$LEGACY_UNIT" <<UNITEOF
[Unit]
Description=Radio Stream: ${LEGACY_NAME}
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=60
StartLimitBurst=10

[Service]
Type=simple
Restart=always
RestartSec=5
ExecStartPre=/bin/bash -c 'mkdir -p -m 0770 /run/snapcast-manager && chgrp audio /run/snapcast-manager 2>/dev/null || true; test -p ${LEGACY_FIFO} || mkfifo -m 660 ${LEGACY_FIFO}; chgrp audio ${LEGACY_FIFO} 2>/dev/null || true'
ExecStart=/bin/bash -o pipefail -c '/usr/bin/ffmpeg -hide_banner -reconnect 1 -reconnect_streamed 1 -reconnect_at_eof 1 -reconnect_delay_max 30 -i "${LEGACY_URL}" -f s16le -ar 48000 -ac 2 - | cat > ${LEGACY_FIFO}'
StandardOutput=null
StandardError=journal

[Install]
WantedBy=multi-user.target
UNITEOF
  systemctl daemon-reload
  ok "Manually created systemd unit outside the app: $(basename "$LEGACY_UNIT")"

  # ---- Discover it via the real API ----
  api GET /api/pipe-sources/discover
  assert_status 200 "GET /api/pipe-sources/discover"
  local discovered_service
  discovered_service="$(jq -r --arg fifo "$LEGACY_FIFO" '.[] | select(.fifoPath==$fifo) | .existingService.name' "$API_BODY_FILE")"
  [ "$discovered_service" = "$LEGACY_UNIT_BASENAME" ] || fail "Step 4: discover() did not find the hand-created unit for $LEGACY_FIFO (got existingService.name='$discovered_service'): $(cat "$API_BODY_FILE")"
  ok "GET /api/pipe-sources/discover found it: existingService.name=${discovered_service}"

  # ---- Adopt it via the real API ----
  api POST /api/pipe-sources/adopt "$(jq -n --arg n "$LEGACY_NAME" --arg u "$LEGACY_URL" --arg svc "$discovered_service" '{name:$n,type:"radio",url:$u,existingServiceName:$svc}')"
  assert_status 200 "POST /api/pipe-sources/adopt"
  local adopted_id
  adopted_id="$(api_field '.id')"
  [ -n "$adopted_id" ] && [ "$adopted_id" != "null" ] || fail "Step 4: POST /api/pipe-sources/adopt did not return an id: $(cat "$API_BODY_FILE")"
  ok "POST /api/pipe-sources/adopt: 200, id=${adopted_id}"

  # ---- Confirm it is now tracked ----
  api GET /api/pipe-sources
  assert_status 200 "GET /api/pipe-sources (post-adopt)"
  local tracked_name
  tracked_name="$(jq -r --arg id "$adopted_id" '.[] | select(.id==$id) | .name' "$API_BODY_FILE")"
  [ "$tracked_name" = "$LEGACY_NAME" ] || fail "Step 4: adopted pipe not tracked correctly: $(cat "$API_BODY_FILE")"
  ok "Adopted pipe is now tracked via GET /api/pipe-sources"

  # ---- Confirm the pre-existing unit file was REUSED, not duplicated ----
  # adopt() stops/disables/removes the matched unit then regenerates it
  # under the SAME bare name (name/slug is unchanged) -- so there must be
  # exactly one snapcast-radio-legacy-radio*.service file, not two.
  local unit_count
  unit_count="$(find /etc/systemd/system -maxdepth 1 -name "${LEGACY_UNIT_BASENAME}*.service" | wc -l | tr -d ' ')"
  [ "$unit_count" = "1" ] || fail "Step 4: expected exactly 1 unit file matching ${LEGACY_UNIT_BASENAME}*.service, found $unit_count"
  [ -f "$LEGACY_UNIT" ] || fail "Step 4: $LEGACY_UNIT no longer exists after adoption"
  assert_file_contains "$LEGACY_UNIT" "$LEGACY_URL" "Step 4 post-adopt unit file"
  ok "Exactly one unit file exists post-adoption (reused, not duplicated): $(basename "$LEGACY_UNIT")"
}

# ============================================================================
# Step 5: Backup + restore
# ============================================================================
#
# SCOPE NOTE (disclosed, see task-65-report.md for the full writeup): this
# task's brief points at server/src/routes/snapshot.ts as "the real
# backup/restore endpoints Task 60 made component-aware". Reading the
# actual code: routes/snapshot.ts (POST /api/snapshots, POST
# /api/snapshots/:id/restore) is a SIMPLE, real, working single-file
# (/etc/snapserver.conf) backup/restore mechanism -- it is NOT the
# component-aware `collectSources()` logic Task 60 built. That logic lives
# in server/src/services/backup.ts, reachable only through the job-based
# package install/update endpoints in routes/system.ts (POST
# /api/system/install/:pkg, POST /api/system/update/:pkg), which perform
# REAL apt package operations as a side effect of reaching it -- a
# materially larger, network-dependent, flakier scope than this already-
# large task, and not what the brief's own file pointer names. This step
# therefore exercises routes/snapshot.ts exactly as named, which is still a
# genuinely real, first-ever-verified, filesystem-level backup/restore
# round-trip against a real running instance -- just not the Task 60
# component-aware path specifically. Disclosed rather than silently
# reinterpreted or silently skipped.
step_5_backup_restore() {
  step "Step 5/7: backup + restore (POST /api/snapshots, POST /api/snapshots/:id/restore)"

  local pre_snapshot_checksum
  pre_snapshot_checksum="$(sha256sum /etc/snapserver.conf | awk '{print $1}')"

  api POST /api/snapshots "$(jq -n '{name:"task65-pre-change",description:"Task 65 container integration test"}')"
  assert_status 201 "POST /api/snapshots"
  local snapshot_id snapshot_filename
  snapshot_id="$(api_field '.id')"
  snapshot_filename="$(api_field '.filename')"
  [ -n "$snapshot_id" ] && [ "$snapshot_id" != "null" ] || fail "Step 5: POST /api/snapshots did not return an id: $(cat "$API_BODY_FILE")"
  # SNAPSHOTS_DIR (services/snapshot.ts) = path.join(__dirname, '../../snapshots').
  # snapshot.ts compiles to server/dist/services/snapshot.js, so __dirname
  # there is server/dist/services -- two levels up is server/, giving
  # server/snapshots/ (NOT a top-level snapshots/ dir). Confirmed against
  # install.sh's own generated systemd unit, whose ReadWritePaths= grants
  # exactly `$INSTALL_BASE_DIR/server/snapshots` for this.
  [ -f "${REPO_DIR}/server/snapshots/${snapshot_filename}" ] || fail "Step 5: snapshot file ${REPO_DIR}/server/snapshots/${snapshot_filename} was not created on disk"
  ok "POST /api/snapshots: 201, id=${snapshot_id}, real file on disk: ${snapshot_filename}"

  # A real, detectable change made directly on disk.
  echo "# TASK65_TEST_MARKER $(date -u +%s)" >> /etc/snapserver.conf
  assert_file_contains /etc/snapserver.conf "TASK65_TEST_MARKER" "Step 5 pre-restore"
  ok "Made a real, detectable change to /etc/snapserver.conf"

  api POST "/api/snapshots/${snapshot_id}/restore"
  assert_status 200 "POST /api/snapshots/${snapshot_id}/restore"
  ok "POST /api/snapshots/${snapshot_id}/restore: 200"

  assert_file_not_contains /etc/snapserver.conf "TASK65_TEST_MARKER" "Step 5 post-restore"
  local post_restore_checksum
  post_restore_checksum="$(sha256sum /etc/snapserver.conf | awk '{print $1}')"
  [ "$post_restore_checksum" = "$pre_snapshot_checksum" ] || fail "Step 5: /etc/snapserver.conf content after restore does not match the pre-snapshot checksum (checksum-level, not just marker-substring, verification)"
  ok "The change was genuinely reverted -- restored content matches the pre-snapshot checksum exactly"
}

# ============================================================================
# Step 6: Old-style-DB migration
# ============================================================================
step_6_old_style_db_migration() {
  step "Step 6/7: old-style (pre-schema_migrations) database migration"

  [ -f "$DB_PATH" ] || fail "Step 6: DB file $DB_PATH does not exist"

  local applied_count
  applied_count="$(sqlite3 "$DB_PATH" "SELECT count(*) FROM schema_migrations;")"
  [ "$applied_count" = "7" ] || fail "Step 6: expected schema_migrations to have all 7 real migrations recorded before the test (this DB genuinely went through startup migration during steps 1-5), got $applied_count"
  ok "Sanity check: this is a REAL database that ran all 7 migrations for real during steps 1-5 (schema_migrations has 7 rows)"

  local pre_pipe_count
  pre_pipe_count="$(sqlite3 "$DB_PATH" "SELECT count(*) FROM radio_pipe_streams;")"
  [ "$pre_pipe_count" = "2" ] || fail "Step 6: expected 2 pre-existing radio_pipe_streams rows (from steps 3+4) before the DB swap, got $pre_pipe_count"

  info "Stopping ${SERVICE_NAME} before touching its database file..."
  systemctl stop "$SERVICE_NAME" || fail "Step 6: systemctl stop $SERVICE_NAME failed"
  wait_for_active "$SERVICE_NAME" 5 && fail "Step 6: $SERVICE_NAME is still active after systemctl stop"
  ok "${SERVICE_NAME} stopped"

  # Construct the genuinely "old-style" fixture: strip schema_migrations
  # from the REAL database steps 1-5 already produced through real usage
  # (real admin user, real pipe sources, real snapshot) -- per the brief,
  # the simplest realistic way to build an old-style-but-otherwise-real DB.
  # WAL-checkpoint first so the drop is fully durable in the main db file
  # before the app (which also uses WAL) reopens it.
  sqlite3 "$DB_PATH" "PRAGMA wal_checkpoint(TRUNCATE); DROP TABLE schema_migrations;" \
    || fail "Step 6: failed to drop schema_migrations from $DB_PATH"

  local tables_after_drop
  tables_after_drop="$(sqlite3 "$DB_PATH" ".tables")"
  echo "$tables_after_drop" | grep -qw "schema_migrations" && fail "Step 6: schema_migrations still present after DROP TABLE"
  echo "$tables_after_drop" | grep -qw "users" || fail "Step 6: users table missing from the old-style fixture -- this is not a real pre-existing DB"
  echo "$tables_after_drop" | grep -qw "radio_pipe_streams" || fail "Step 6: radio_pipe_streams table missing from the old-style fixture"
  ok "Constructed a genuine old-style DB: baseline+migrated tables/columns present, schema_migrations table gone"

  info "Restarting ${SERVICE_NAME} against the old-style DB..."
  systemctl start "$SERVICE_NAME" || fail "Step 6: systemctl start $SERVICE_NAME failed"
  wait_for_active "$SERVICE_NAME" 30 || fail "Step 6: $SERVICE_NAME did not become active within 30s after restarting against the old-style DB"
  ok "systemctl is-active ${SERVICE_NAME}: active (started cleanly against the old-style DB)"

  wait_for_http "${BASE_URL}/api/status" 30 || fail "Step 6: ${BASE_URL}/api/status did not respond within 30s of restart"

  # No fresh crash-loop: the unit's ActiveEnterTimestamp should be recent
  # and NSubProcess-free; the simplest, most decisive check is just that it
  # is STILL active a moment later (Type=simple + Restart=always would
  # otherwise mask a persistent crash-loop as "active" only momentarily).
  sleep 3
  systemctl is-active --quiet "$SERVICE_NAME" || fail "Step 6: $SERVICE_NAME stopped being active shortly after starting -- likely crash-looping"
  ok "${SERVICE_NAME} stayed active (no crash-loop) after the old-style-DB restart"

  # Pre-existing data intact: the admin user created in step 2.
  api GET /api/auth/setup-status
  assert_status 200 "GET /api/auth/setup-status (post-migration)"
  [ "$(api_field '.isInitialized')" = "true" ] || fail "Step 6: isInitialized=false after old-style-DB restart -- the pre-existing admin user was lost"
  ok "GET /api/auth/setup-status: isInitialized=true -- pre-existing admin user survived"

  api POST /api/auth/login "$(jq -n --arg u "$ADMIN_USERNAME" --arg p "$ADMIN_PASSWORD" '{username:$u,password:$p}')"
  assert_status 200 "POST /api/auth/login (post-migration)"
  AUTH_TOKEN="$(api_field '.token')"
  [ -n "$AUTH_TOKEN" ] && [ "$AUTH_TOKEN" != "null" ] || fail "Step 6: could not log in as the pre-existing admin after the old-style-DB restart"
  ok "Logged in as the pre-existing admin -- password hash intact"

  # Pre-existing pipe sources (steps 3+4) intact.
  api GET /api/pipe-sources
  assert_status 200 "GET /api/pipe-sources (post-migration)"
  local pipe_count
  pipe_count="$(jq 'length' "$API_BODY_FILE")"
  [ "$pipe_count" = "2" ] || fail "Step 6: expected 2 pipe sources to survive the old-style-DB migration, got $pipe_count: $(cat "$API_BODY_FILE")"
  ok "Both pre-existing pipe sources (steps 3+4) survived the migration"

  # schema_migrations was rebuilt (CREATE TABLE IF NOT EXISTS) and all 7
  # versions were recorded WITHOUT re-running any up() (isApplied() short-
  # circuited every one of them, since the tables/columns already existed)
  # -- the actual thing this step exists to prove.
  local post_migration_count
  post_migration_count="$(sqlite3 "$DB_PATH" "SELECT count(*) FROM schema_migrations;")"
  [ "$post_migration_count" = "7" ] || fail "Step 6: expected schema_migrations to have all 7 versions recorded after startup, got $post_migration_count"
  ok "schema_migrations rebuilt with all 7 versions recorded, none of them re-ran up() against already-present tables/columns"
}


# ============================================================================
# Step 7: reboot simulation (Task 66 -- RuntimeDirectory= regression test)
# ============================================================================
#
# /run/snapcast-manager is tmpfs-backed, so a real host reboot wipes it.
# Before Task 66, nothing re-created it on every boot -- only
# ensureRuntimeDir()/a radio unit's own ExecStartPre, both of which only run
# once a pipe source has actually been created or started. On a host where
# snapmanager.service starts (After=network.target snapserver.service)
# before any pipe source ever has, its own ReadWritePaths= entry for this
# path would hard-fail NAMESPACE setup post-reboot, identically to the
# fresh-install gap Task 65 found for the OTHER ReadWritePaths= entries.
#
# `systemctl stop` + `rm -rf` the directory + `systemctl start` is the
# closest a container test can get to a real reboot's tmpfs wipe without an
# actual reboot: it reproduces the exact on-disk precondition (path
# genuinely absent) that NAMESPACE setup would hit on step 1's freshly-
# installed unit if RuntimeDirectory= were missing or broken.
step_7_reboot_simulation() {
  step "Step 7/7: reboot simulation (RuntimeDirectory= regression test)"

  info "Stopping ${SERVICE_NAME}..."
  systemctl stop "$SERVICE_NAME" || fail "Step 7: systemctl stop $SERVICE_NAME failed"
  wait_for_active "$SERVICE_NAME" 5 && fail "Step 7: $SERVICE_NAME is still active after systemctl stop"

  info "Simulating a tmpfs wipe of /run/snapcast-manager..."
  rm -rf /run/snapcast-manager
  [ ! -e /run/snapcast-manager ] || fail "Step 7: /run/snapcast-manager still exists after rm -rf -- test setup itself is broken"
  ok "/run/snapcast-manager removed (tmpfs-wipe precondition reproduced)"

  info "Starting ${SERVICE_NAME} against the wiped /run/snapcast-manager..."
  systemctl start "$SERVICE_NAME" || fail "Step 7: systemctl start $SERVICE_NAME failed against a missing /run/snapcast-manager -- this is the exact NAMESPACE failure RuntimeDirectory= exists to prevent"
  wait_for_active "$SERVICE_NAME" 30 || fail "Step 7: $SERVICE_NAME did not become active within 30s after a simulated reboot"
  ok "${SERVICE_NAME} started cleanly against a wiped /run/snapcast-manager"

  [ -d /run/snapcast-manager ] || fail "Step 7: /run/snapcast-manager was not recreated by RuntimeDirectory= on unit start"
  ok "/run/snapcast-manager recreated by RuntimeDirectory= on unit start"

  local mode owner group
  mode="$(stat -c '%a' /run/snapcast-manager)"
  owner="$(stat -c '%U' /run/snapcast-manager)"
  group="$(stat -c '%G' /run/snapcast-manager)"
  [ "$mode" = "770" ] || fail "Step 7: /run/snapcast-manager mode is $mode, expected 770 (RuntimeDirectoryMode=)"
  [ "$owner" = "snapmanager" ] || fail "Step 7: /run/snapcast-manager owner is $owner, expected snapmanager"
  [ "$group" = "audio" ] || fail "Step 7: /run/snapcast-manager group is $group, expected audio (the ExecStartPre chgrp did not run/failed)"
  ok "/run/snapcast-manager is snapmanager:audio, mode 770 -- matches ensureRuntimeDir()'s own convention"

  wait_for_http "${BASE_URL}/api/status" 30 || fail "Step 7: ${BASE_URL}/api/status did not respond within 30s of restart"
  api GET /api/status
  assert_status 200 "Step 7 GET /api/status"
  [ "$(api_field '.status')" = "online" ] || fail "Step 7: GET /api/status body did not report status=online after simulated reboot: $(cat "$API_BODY_FILE")"
  ok "GET /api/status: online after simulated reboot"
}

# ============================================================================
# Step 8: services/backup.ts's real BackupService round-trip
# ============================================================================
#
# See this script's own top-of-file comment for why this step exists: Step
# 5 above exercises routes/snapshot.ts's simple single-file backup, NOT
# services/backup.ts's component-aware BackupService, which is reachable
# only through the job-based package install/update endpoints. Installs the
# real `mpd` Debian package (so it has real config files to back up),
# updates it (triggering safeBackupOrAbort() -> createPreUpdateBackup() ->
# a real `sudo tar czf`), then restores the resulting backup (`restoreBackup()`'s
# staged `sudo tar -xzf` + `sudo cp -r -T`, not a direct in-place `tar -xPzf`
# -- see backup.ts's own restoreBackup() docstring) -- proving both
# privileged code paths genuinely work under snapmanager's hardened
# sudo/systemd sandbox. This closes/verifies THREE real gaps Task 65
# disclosed and left unfixed, all found while verifying THIS step for real
# against a hardened container: (1) `/usr/bin/tar` was missing from
# scripts/sudoers.d/snapcast-manager entirely, so every privileged tar call
# used to fail outright with "sudo: a password is required"; (2) even with
# that grant added, a real `apt-get install mpd` still failed with
# "Read-only file system" (ReadWritePaths= never covered a real package
# install's actual write targets -- /usr/lib, /usr/share, /run/adduser,
# etc. -- until widened; see SECURITY.md's "ReadWritePaths= widened to
# /etc/var/usr/run" note); (3) restoreBackup()'s old in-place `tar -xPzf`
# failed on any individually-granted single file like /etc/mpd.conf (see
# SECURITY.md's "restoreBackup() stages through cp" note).
step_8_backup_service_round_trip() {
  step "Step 8/8: services/backup.ts round-trip (POST /api/system/install/mpd, POST /api/system/update/mpd, POST /api/system/backups/restore)"

  # ---- Install mpd for real, so it has real config files on disk ----
  api POST /api/system/install/mpd
  assert_status 202 "POST /api/system/install/mpd"
  local install_job_id
  install_job_id="$(api_field '.jobId')"
  [ -n "$install_job_id" ] && [ "$install_job_id" != "null" ] || fail "Step 8: POST /api/system/install/mpd did not return a jobId: $(cat "$API_BODY_FILE")"
  ok "POST /api/system/install/mpd: 202, jobId=${install_job_id}"

  wait_for_job "$install_job_id" 180 || fail "Step 8: install mpd job did not reach a terminal status within 180s (last status: ${JOB_STATUS})"
  [ "$JOB_STATUS" = "done" ] || fail "Step 8: install mpd job finished with status '${JOB_STATUS}', not 'done': $(cat "$API_BODY_FILE")"
  ok "install mpd job: done"

  [ -f /etc/mpd.conf ] || fail "Step 8: /etc/mpd.conf does not exist after installing mpd -- not a real package install"
  ok "/etc/mpd.conf exists on disk (real mpd package install)"

  api GET /api/system/installed/mpd
  assert_status 200 "GET /api/system/installed/mpd"
  [ "$(api_field '.installed')" = "true" ] || fail "Step 8: GET /api/system/installed/mpd reports installed=false after a successful install: $(cat "$API_BODY_FILE")"
  ok "GET /api/system/installed/mpd: installed=true"

  # ---- Update mpd for real -- this is the call that runs
  #      safeBackupOrAbort()/createPreUpdateBackup() with real, existing
  #      sources to archive, so it genuinely reaches `sudo tar czf`. A
  #      fresh install (above) would NOT exercise this: createPreUpdateBackup()
  #      skips the tar call entirely when there is nothing pre-existing to
  #      back up (see backup.ts's own comment on that early-return). ----
  local pre_update_backup_count
  pre_update_backup_count="$(find /var/backups/snapmanager -maxdepth 1 -name 'pre-mpd-*.tar.gz' 2>/dev/null | wc -l | tr -d ' ')"

  api POST /api/system/update/mpd '{}'
  assert_status 202 "POST /api/system/update/mpd"
  local update_job_id
  update_job_id="$(api_field '.jobId')"
  [ -n "$update_job_id" ] && [ "$update_job_id" != "null" ] || fail "Step 8: POST /api/system/update/mpd did not return a jobId: $(cat "$API_BODY_FILE")"
  ok "POST /api/system/update/mpd: 202, jobId=${update_job_id}"

  wait_for_job "$update_job_id" 180 || fail "Step 8: update mpd job did not reach a terminal status within 180s (last status: ${JOB_STATUS})"
  # A sudoers-grant gap surfaces here as status='error' with "sudo: a
  # password is required" somewhere in .error/.log -- this is the exact
  # regression this step exists to catch, so failure here is diagnosed with
  # the job's own body, not just a generic "not done".
  [ "$JOB_STATUS" = "done" ] || fail "Step 8: update mpd job finished with status '${JOB_STATUS}', not 'done' -- likely the pre-update backup's 'sudo tar' failed (check for a missing /usr/bin/tar grant in scripts/sudoers.d/snapcast-manager): $(cat "$API_BODY_FILE")"
  ok "update mpd job: done (safeBackupOrAbort() -> createPreUpdateBackup() -> 'sudo tar czf' succeeded)"

  # ---- The real backup file this update produced is genuinely on disk ----
  local post_update_backup_count new_backup_file
  post_update_backup_count="$(find /var/backups/snapmanager -maxdepth 1 -name 'pre-mpd-*.tar.gz' 2>/dev/null | wc -l | tr -d ' ')"
  [ "$post_update_backup_count" -gt "$pre_update_backup_count" ] || fail "Step 8: no new pre-mpd-*.tar.gz file appeared under /var/backups/snapmanager after updating mpd (before=$pre_update_backup_count, after=$post_update_backup_count)"
  # Filenames embed a sortable `pre-mpd-YYYYMMDD-HHMMSS.tar.gz` timestamp
  # (backup.ts's formatTimestamp()), so the lexicographically-last match is
  # genuinely the newest one -- no need for `find -newer`.
  new_backup_file="$(find /var/backups/snapmanager -maxdepth 1 -name 'pre-mpd-*.tar.gz' 2>/dev/null | sort | tail -n1)"
  [ -f "$new_backup_file" ] || fail "Step 8: could not locate the new backup file on disk"
  ok "New backup file genuinely on disk: ${new_backup_file}"

  # createPreUpdateBackup() sudo-chmod's the archive to 600 (backup.ts) --
  # confirms the SECOND privileged call (chmod, already granted pre-existing)
  # also completed, not just tar.
  local backup_mode
  backup_mode="$(stat -c '%a' "$new_backup_file")"
  [ "$backup_mode" = "600" ] || fail "Step 8: backup file mode is '$backup_mode', expected '600' (chmod step of createPreUpdateBackup() did not complete)"
  ok "Backup file mode is 600 (chmod step of createPreUpdateBackup() completed)"

  tar -tzf "$new_backup_file" | grep -q 'mpd.conf$' || fail "Step 8: backup archive $new_backup_file does not contain mpd.conf: $(tar -tzf "$new_backup_file")"
  ok "Backup archive genuinely contains mpd.conf ($(tar -tzf "$new_backup_file" | tr '\n' ' '))"

  # ---- A real, detectable change to the file this backup covers, made
  #      directly on disk -- same pattern as Step 5, so restore below proves
  #      a genuine revert, not just "the API returned 200". ----
  local pre_restore_sha
  echo "# TASK66_TEST_MARKER $(date -u +%s)" >> /etc/mpd.conf
  assert_file_contains /etc/mpd.conf "TASK66_TEST_MARKER" "Step 8 pre-restore"
  # Member names were stored WITH their leading `/` (the archive was created
  # with `--absolute-names` -- see backup.ts's createPreUpdateBackup()), so
  # `tar -xzOf` needs the leading slash too, or it silently extracts
  # nothing (empty stdout, NOT a non-zero exit) rather than failing loudly.
  pre_restore_sha="$(tar -xzOf "$new_backup_file" /etc/mpd.conf 2>/dev/null | sha256sum | awk '{print $1}')"
  [ -n "$pre_restore_sha" ] && [ "$pre_restore_sha" != "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" ] \
    || fail "Step 8: could not extract /etc/mpd.conf from $new_backup_file to compute its checksum (got empty/nonexistent-file sha256)"
  ok "Made a real, detectable change to /etc/mpd.conf (the file this backup covers)"

  # ---- Restore it for real -- restoreBackup()'s staged extract + `sudo cp
  #      -r -T` (see backup.ts's own docstring), via the direct restore
  #      endpoint. NOTE: this is mounted under /api/system (routes/system.ts
  #      is app.use('/api/system', ...) in index.ts), NOT bare /api/backups. ----
  local backup_basename
  backup_basename="$(basename "$new_backup_file")"
  api POST /api/system/backups/restore "$(jq -n --arg n "$backup_basename" '{name:$n}')"
  assert_status 200 "POST /api/system/backups/restore"
  ok "POST /api/system/backups/restore: 200 (${backup_basename}) -- staged 'sudo tar -xzf' + 'sudo cp -r -T' succeeded"

  # ---- GET /api/system/backups genuinely lists it ----
  api GET /api/system/backups
  assert_status 200 "GET /api/system/backups"
  local listed
  listed="$(jq -r --arg n "$backup_basename" '.backups[] | select(.name==$n) | .name' "$API_BODY_FILE")"
  [ "$listed" = "$backup_basename" ] || fail "Step 8: GET /api/system/backups does not list ${backup_basename}: $(cat "$API_BODY_FILE")"
  ok "GET /api/system/backups lists the new backup: ${backup_basename}"

  # ---- The change was genuinely reverted: /etc/mpd.conf no longer contains
  #      the marker, and matches the archived copy's checksum exactly --
  #      confirms cp -r -T actually landed the staged content, not just that
  #      the API call returned 200. ----
  assert_file_not_contains /etc/mpd.conf "TASK66_TEST_MARKER" "Step 8 post-restore"
  local post_restore_sha
  post_restore_sha="$(sha256sum /etc/mpd.conf | awk '{print $1}')"
  [ "$post_restore_sha" = "$pre_restore_sha" ] || fail "Step 8: /etc/mpd.conf content after restore does not match the archived copy's checksum (archived=$pre_restore_sha, real=$post_restore_sha) -- restoreBackup()'s staged cp -r -T did not genuinely land the content"
  ok "/etc/mpd.conf genuinely reverted -- matches the archived copy's checksum exactly (checksum-level, not just a 200 response)"
}

main() {
  step_1_installation
  step_2_setup
  step_3_create_pipe_source
  step_4_adoption
  step_5_backup_restore
  step_6_old_style_db_migration
  step_7_reboot_simulation
  step_8_backup_service_round_trip
  echo -e "\n${GREEN}==============================================${NC}"
  echo -e "${GREEN} ALL 8 container integration test steps passed${NC}"
  echo -e "${GREEN}==============================================${NC}"
}

main
