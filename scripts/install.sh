#!/bin/bash

# Snapcast Manager - Installer Script
# Designed for Debian/Ubuntu headless servers

set -e

# Colors and formatting for output. Plain text when stdout isn't a terminal,
# so logs and CI output stay readable.
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    CYAN='\033[0;36m'
    MAGENTA='\033[0;35m'
    BOLD='\033[1m'
    DIM='\033[2m'
    NC='\033[0m' # No Color
else
    RED=''
    GREEN=''
    YELLOW=''
    CYAN=''
    MAGENTA=''
    BOLD=''
    DIM=''
    NC=''
fi

case "${LC_ALL:-${LC_CTYPE:-${LANG:-}}}" in
    *UTF-8*|*UTF8*|*utf-8*|*utf8*)
        OK_MARK='✓'
        WARN_MARK='!'
        FAIL_MARK='✗'
        ;;
    *)
        OK_MARK='[OK]'
        WARN_MARK='[!]'
        FAIL_MARK='[X]'
        ;;
esac

# Task 16: pure unit-file User= migration-detection logic lives in
# scripts/lib/migration.sh so it can be exercised by the standalone test
# harness (scripts/test-migration-detection.sh) without touching the
# filesystem/root/systemd. Resolved relative to THIS script's own location
# (not $PWD) so it works both when run directly from a checked-out repo and
# after the remote-install flow's `exec bash scripts/install.sh` re-invocation
# from within $INSTALL_BASE_DIR (see Step 0 below) -- by the time either path
# reaches here, install.sh is always being run as a real file, never piped
# directly into bash with no path of its own.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/lib/migration.sh" ]; then
    # shellcheck source=lib/migration.sh
    source "$SCRIPT_DIR/lib/migration.sh"
fi

# Task 75: same pattern, for scripts/lib/verify-download.sh's pure
# verify_download_hash() function (used by the remote-download flow below to
# verify a downloaded release .zip's size/hash before extracting it).
# Neither this file nor migration.sh above is actually packaged into the
# release .zip (release.yml's "Prepare Release Package" step only copies
# scripts/install.sh itself -- confirmed by reading that step; a real,
# pre-existing gap, flagged separately, not fixed here as it's out of this
# task's scope) NOR present at all in the primary documented install path
# (`curl -sL .../install.sh | bash`, README.md/docs/installation.md --
# nothing but this one file is ever fetched). So this optional source is a
# best-effort win for the rarer case of running install.sh from a full git
# checkout where scripts/lib/ happens to sit alongside it; the declare -f
# guarded fallback definition at this function's actual call site below
# (same "declare -f ... || define a fallback" pattern already used for
# unit_needs_user_migration further down this file) is what guarantees real
# verification actually runs on the common real-world paths.
if [ -f "$SCRIPT_DIR/lib/verify-download.sh" ]; then
    # shellcheck source=lib/verify-download.sh
    source "$SCRIPT_DIR/lib/verify-download.sh"
fi

if [ -n "${SNAPCAST_MANAGER_VERSION:-}" ]; then
    if [[ ! "$SNAPCAST_MANAGER_VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
        echo "Invalid SNAPCAST_MANAGER_VERSION" >&2
        exit 1
    fi
    VERSION="$SNAPCAST_MANAGER_VERSION"
else
    LATEST_RELEASE=$(curl -sL "https://api.github.com/repos/NaturalDevCR/Snapcast-Manager/releases/latest" | grep '"tag_name"' | head -1 | cut -d '"' -f 4)
    VERSION="${LATEST_RELEASE:-v0.4.3}"
fi
APP_VERSION="$VERSION"

INSTALL_BASE_DIR="/opt/snapcast-manager"
SERVICE_NAME="snapmanager"
UNIT_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
# Task 16: dedicated, unprivileged system user the service runs as (see
# SECURITY.md's "Privilege model" section / .superpowers/sdd/task-16-report.md).
# Coincidentally the same literal string as SERVICE_NAME above, but they are
# two different concepts (a systemd unit name vs. a Unix account name) --
# kept as a separate constant so the rest of this script is self-documenting
# about which one it means at each call site.
SNAPMANAGER_USER="snapmanager"
DEFAULT_PORT=3000
DEFAULT_MODE="both"
AUTO_CONFIRM=false
# In an unpacked release until its installer finishes the second half.
INCOMPLETE_MARKER=".update-incomplete"

# Remote flow state, read by on_exit.
WORK_DIR=""
STAGE_DIR=""
OLD_INSTALL_INTACT=false
SERVICE_STOPPED=false

# ---- Terminal output ----
#
# One visual vocabulary for the whole run: numbered steps, then one indented
# result line per thing that happened. Command output goes to the log file,
# never to the screen (see spin/run_quiet below).
STEP_NUM=0
STEP_TOTAL=0

ui_step() {
    STEP_NUM=$((STEP_NUM + 1))
    echo -e "\n${BOLD}${CYAN}[${STEP_NUM}/${STEP_TOTAL}]${NC} ${BOLD}$1${NC}"
}
ui_ok() { echo -e "      ${GREEN}${OK_MARK}${NC} $1"; }
ui_warn() { echo -e "      ${YELLOW}${WARN_MARK}${NC} $1"; }
ui_error() { echo -e "      ${RED}${FAIL_MARK} $1${NC}"; }
ui_note() { echo -e "        ${DIM}$1${NC}"; }
ui_heading() { echo -e "\n${BOLD}$1${NC}"; }
ui_row() { printf "  %-11s %b\n" "$1" "$2"; }

# The log is created on first use, so a run that stops at the first question
# leaves nothing in /tmp. Exported so the re-executed installer appends to the
# same file. mktemp makes it private to the user running the installer.
INSTALL_LOG="${SNAPMGR_INSTALL_LOG:-}"
ensure_log() {
    if [ -z "$INSTALL_LOG" ]; then
        INSTALL_LOG=$(mktemp /tmp/snapcast-manager-install.XXXXXX)
    fi
    export SNAPMGR_INSTALL_LOG="$INSTALL_LOG"
}

show_log_tail() {
    ensure_log
    tail -n "${1:-12}" "$INSTALL_LOG" | sed 's/^/        /'
}

# Runs a command with its output in the log and a spinner on a terminal.
# Prints one result line and returns the command's status.
#
# The command stays in the foreground and the spinner is the background job,
# not the other way round: a non-interactive shell starts background jobs with
# SIGINT ignored, so Ctrl-C would leave npm or apt-get running. stdin is
# /dev/null because under `curl | bash` it is the rest of this script, and
# because a hidden prompt would look like a hang.
spin() {
    local label="$1"
    shift
    ensure_log
    printf '\n=== %s\n$ %s\n' "$label" "$*" >> "$INSTALL_LOG"

    local spinner=""
    if [ -t 1 ]; then
        (
            frames='|/-\'
            i=0
            while kill -0 "$$" 2>/dev/null; do
                printf '\r      %s %s' "${frames:$((i % 4)):1}" "$label"
                i=$((i + 1))
                sleep 0.2
            done
        ) &
        spinner=$!
    fi

    local status=0
    "$@" >> "$INSTALL_LOG" 2>&1 < /dev/null || status=$?

    if [ -n "$spinner" ]; then
        kill "$spinner" 2>/dev/null || true
        wait "$spinner" 2>/dev/null || true
        printf '\r\033[K'
    fi

    if [ "$status" -eq 0 ]; then
        ui_ok "$label"
    else
        ui_error "$label failed"
    fi
    return "$status"
}

# spin, plus the end of the log when the command fails.
run_quiet() {
    local status=0
    spin "$@" || status=$?
    if [ "$status" -ne 0 ]; then
        show_log_tail 12
    fi
    return "$status"
}

# Keeps the full journal in the log and shows only its tail.
show_service_logs() {
    local journal
    ensure_log
    journal=$($SUDO journalctl -u "$SERVICE_NAME" -n 50 --no-pager 2>&1 || true)
    printf '\n=== journalctl -u %s\n%s\n' "$SERVICE_NAME" "$journal" >> "$INSTALL_LOG"
    ui_note "Last lines from the service log:"
    printf '%s\n' "$journal" | tail -n 10 | sed 's/^/        /'
}

remove_temporary_files() {
    if [ -n "$WORK_DIR" ]; then
        $SUDO rm -rf "$WORK_DIR" || true
    fi
    if [ -n "$STAGE_DIR" ]; then
        $SUDO rm -rf "$STAGE_DIR" || true
    fi
}

# Only for a failure before the swap in replace_install: the old install is
# still whole, so it can simply run again.
restart_previous_version() {
    if [ "$SERVICE_STOPPED" != true ]; then
        return 0
    fi
    if $SUDO systemctl start "$SERVICE_NAME" 2>/dev/null; then
        ui_note "The previous version is running again."
    else
        ui_error "The previous version did not restart. Try: systemctl start $SERVICE_NAME"
    fi
}

on_exit() {
    local status=$?
    remove_temporary_files
    if [ "$status" -eq 0 ]; then
        return 0
    fi
    echo ""
    ui_error "Setup did not finish."
    if [ -n "$INSTALL_LOG" ] && [ -s "$INSTALL_LOG" ]; then
        ui_note "Full log: $INSTALL_LOG"
    fi
    if [ "$OLD_INSTALL_INTACT" = true ]; then
        ui_note "The installed version was not changed."
        restart_previous_version
    fi
    ui_note "After fixing the problem, re-run this installer."
}

# Confirms the app answers HTTP. `systemctl is-active` alone isn't enough:
# Restart=always reports a crash-looping unit as active between crashes.
wait_for_app() {
    local _
    for _ in $(seq 1 "${APP_WAIT_SECONDS:-20}"); do
        if curl -fsS -o /dev/null --max-time 2 "http://127.0.0.1:${APP_PORT}/api/health" 2>/dev/null; then
            return 0
        fi
        sleep 1
    done
    return 1
}

# better-sqlite3 is a native addon: without its compiled binding the server
# can't start, and npm only warns when its install script doesn't run.
verify_native_modules() {
    if node -e "new (require('better-sqlite3'))(':memory:')" >/dev/null 2>&1; then
        ui_ok "Native modules load correctly"
        return 0
    fi
    ui_error "better-sqlite3 failed to load, so the server cannot start."
    show_log_tail 12
    exit 1
}

# Reads one line from the terminal into ANSWER. Returns 1 when there is no
# terminal to ask on. Under `curl | bash` stdin is the script, so it reads
# /dev/tty, and it must open the device to test it: the node exists even for
# a process with no controlling terminal, where opening it fails.
ask() {
    local prompt="$1"
    ANSWER=""
    if [ -t 0 ]; then
        read -r -p "$prompt" ANSWER || ANSWER=""
    elif (: < /dev/tty) 2>/dev/null; then
        read -r -p "$prompt" ANSWER < /dev/tty || ANSWER=""
    else
        return 1
    fi
}

prompt_yes_no() {
    local prompt="$1"
    local default="$2"
    local hint="y/N"
    if [ "$default" = "y" ]; then
        hint="Y/n"
    fi

    if [ "$AUTO_CONFIRM" = true ]; then
        ui_note "$prompt [Auto-confirmed: y]"
        return 0
    fi

    if ! ask "$prompt ($hint): "; then
        ui_note "$prompt [Auto-answered: $default]"
        ANSWER="$default"
    fi

    case "${ANSWER:-$default}" in
        y|Y|yes|Yes|YES) return 0 ;;
        *) return 1 ;;
    esac
}

install_packages() {
    $SUDO apt-get update && $SUDO apt-get install -y "$@"
}

add_nodesource() {
    if [ -n "$SUDO" ]; then
        curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO -E bash -
    else
        curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    fi
}

is_valid_port() {
    [[ "$1" =~ ^[1-9][0-9]{0,4}$ ]] && [ "$1" -le 65535 ]
}

is_valid_mode() {
    case "$1" in
        client|server|both) return 0 ;;
        *) return 1 ;;
    esac
}

# Both values were validated, and printf keeps them from ever being parsed by
# a shell running as root.
write_env_file() {
    printf 'PORT=%s\nSNAPCAST_MODE=%s\nNODE_ENV=production\n' "$APP_PORT" "$APP_MODE" \
        | $SUDO tee "$1" >/dev/null
}

# Prints vX.Y.Z from a package.json, or nothing.
read_package_version() {
    local version=""
    if [ -f "$1" ]; then
        version=$(grep -m 1 '"version"' "$1" | cut -d '"' -f 4)
    fi
    if [ -n "$version" ]; then
        echo "v$version"
    fi
}

read_saved_env() {
    local env_file="$INSTALL_BASE_DIR/server/.env"
    if [ ! -e "$env_file" ]; then
        return 0
    fi
    # Mode 600 and owned by the service user once the service is set up.
    if [ -r "$env_file" ]; then
        cat "$env_file"
    else
        $SUDO cat "$env_file" 2>/dev/null || true
    fi
}

# Security: the service user owns server/.env and this script usually runs as
# root, so its content is untrusted. Never source it. Values are extracted as
# text here and validated in detect_install before anything uses them.
saved_env_value() {
    printf '%s\n' "$2" | sed -n "s/^$1=//p" | tail -n 1 | tr -d "\r\"' "
}

# Must run before anything touches $INSTALL_BASE_DIR: its server/.env is where
# the saved settings come from.
detect_install() {
    EXISTING_INSTALL=false
    INSTALLED_VERSION=""
    SAVED_PORT=""
    SAVED_MODE=""
    SERVICE_INSTALLED=false

    if [ -f "$UNIT_FILE" ]; then
        SERVICE_INSTALLED=true
    fi
    if [ ! -d "$INSTALL_BASE_DIR" ]; then
        return 0
    fi

    EXISTING_INSTALL=true
    INSTALLED_VERSION=$(read_package_version "$INSTALL_BASE_DIR/server/package.json")
    # The files of the new version are in place but it was never set up, so
    # it must not count as up to date.
    if [ -e "$INSTALL_BASE_DIR/$INCOMPLETE_MARKER" ]; then
        ui_warn "The last run did not finish. This run completes it."
        INSTALLED_VERSION=""
    fi

    local saved_env value
    saved_env=$(read_saved_env)
    if [ -z "$saved_env" ]; then
        return 0
    fi

    value=$(saved_env_value PORT "$saved_env")
    if is_valid_port "$value"; then
        SAVED_PORT="$value"
    elif [ -n "$value" ]; then
        ui_warn "Ignoring invalid PORT in the saved settings."
    fi

    value=$(saved_env_value SNAPCAST_MODE "$saved_env")
    if is_valid_mode "$value"; then
        SAVED_MODE="$value"
    elif [ -n "$value" ]; then
        ui_warn "Ignoring invalid SNAPCAST_MODE in the saved settings."
    else
        # Installs older than the mode setting ran with the server's default.
        SAVED_MODE="$DEFAULT_MODE"
    fi
}

choose_mode() {
    ui_heading "Installation mode"
    echo -e "  1) ${BOLD}Snapclient Manager only${NC}  Manage audio output clients"
    echo -e "  2) ${BOLD}Snapserver Manager only${NC}  Manage the audio server"
    echo -e "  3) ${BOLD}Snapcast Manager (both)${NC}  Full server and client management"

    if ask "Select mode (1-3) [3]: "; then
        case "${ANSWER:-3}" in
            1) APP_MODE="client" ;;
            2) APP_MODE="server" ;;
            *) APP_MODE="both" ;;
        esac
        MODE_SOURCE="chosen"
    else
        APP_MODE="$DEFAULT_MODE"
        MODE_SOURCE="default"
    fi
}

choose_port() {
    while true; do
        if ! ask "Web interface port [$DEFAULT_PORT]: "; then
            APP_PORT="$DEFAULT_PORT"
            PORT_SOURCE="default"
            return 0
        fi
        APP_PORT="${ANSWER:-$DEFAULT_PORT}"
        if is_valid_port "$APP_PORT"; then
            PORT_SOURCE="chosen"
            return 0
        fi
        ui_warn "Enter a port number from 1 to 65535."
    done
}

# Each setting comes from, in order: its flag, the saved install, a question
# (only when there is nothing saved), or the default under -y.
collect_settings() {
    if [ -z "$APP_MODE" ]; then
        if [ -n "$SAVED_MODE" ]; then
            APP_MODE="$SAVED_MODE"
            MODE_SOURCE="saved"
        elif [ "$AUTO_CONFIRM" = true ]; then
            APP_MODE="$DEFAULT_MODE"
            MODE_SOURCE="default"
        else
            choose_mode
        fi
    fi

    if [ -z "$APP_PORT" ]; then
        if [ -n "$SAVED_PORT" ]; then
            APP_PORT="$SAVED_PORT"
            PORT_SOURCE="saved"
        elif [ "$AUTO_CONFIRM" = true ]; then
            APP_PORT="$DEFAULT_PORT"
            PORT_SOURCE="default"
        else
            choose_port
        fi
    fi

    if [ -z "$INSTALL_SERVICE" ]; then
        if [ "$SERVICE_INSTALLED" = true ]; then
            INSTALL_SERVICE=true
        elif prompt_yes_no "Install Snapcast Manager as a systemd service?" "y"; then
            INSTALL_SERVICE=true
        else
            INSTALL_SERVICE=false
        fi
    fi
}

source_label() {
    case "$1" in
        saved) echo " ${DIM}(saved)${NC}" ;;
        flag) echo " ${DIM}(from flag)${NC}" ;;
        default) echo " ${DIM}(default)${NC}" ;;
    esac
}

print_settings() {
    ui_row "Mode" "$APP_MODE$(source_label "$MODE_SOURCE")"
    ui_row "Port" "$APP_PORT$(source_label "$PORT_SOURCE")"
    if [ "$INSTALL_SERVICE" = true ]; then
        ui_row "Service" "$SERVICE_NAME (systemd)"
    else
        ui_row "Service" "not installed"
    fi
}

no_tty_abort() {
    ui_error "No TTY available for input. Aborting."
    exit 1
}

choose_other_action() {
    ui_heading "Other options"
    echo -e "  1) ${BOLD}Force re-install${NC}  Replaces the app, keeps database and settings"
    echo -e "  2) ${BOLD}Clean re-install${NC}  ${RED}Deletes everything${NC} and starts fresh"
    echo -e "  3) ${BOLD}Uninstall${NC}"
    echo -e "  4) ${BOLD}Abort${NC}"

    ask "Select an option (1-4): " || no_tty_abort
    case "$ANSWER" in
        1)
            ACTION="force"
            ;;
        2)
            ACTION="clean"
            ;;
        3)
            uninstall_snapmanager
            ;;
        *)
            echo "Installation aborted."
            exit 0
            ;;
    esac
}

# The one decision an existing install needs. Enter accepts the update, and
# the destructive actions sit behind "o" rather than next to it.
choose_action() {
    if [ "$INSTALLED_VERSION" = "$VERSION" ]; then
        if [ "$AUTO_CONFIRM" = true ]; then
            echo ""
            ui_ok "Already on $VERSION. Nothing to do."
            exit 0
        fi
        ask "Already up to date. Press Enter to exit, or o for other options: " || no_tty_abort
        case "$ANSWER" in
            o|O)
                choose_other_action
                ;;
            *)
                exit 0
                ;;
        esac
        return 0
    fi

    if [ "$AUTO_CONFIRM" = true ]; then
        ACTION="update"
        return 0
    fi

    while true; do
        ask "Update to $VERSION now? (Y/n, or o for other options): " || no_tty_abort
        case "${ANSWER:-y}" in
            y|Y|yes|Yes|YES)
                ACTION="update"
                return 0
                ;;
            n|N|no|No|NO)
                echo "Installation aborted."
                exit 0
                ;;
            o|O)
                choose_other_action
                return 0
                ;;
            *)
                ui_warn "Type y, n or o."
                ;;
        esac
    done
}

uninstall_snapmanager() {
    ui_heading "Uninstall Snapcast Manager"
    if prompt_yes_no "Are you sure you want to completely remove Snapcast Manager?" "n"; then
        $SUDO systemctl stop $SERVICE_NAME 2>/dev/null || true
        $SUDO systemctl disable $SERVICE_NAME 2>/dev/null || true
        $SUDO rm -f "$UNIT_FILE"
        # Task 16: remove the app-scoped sudoers.d grant too -- safe to
        # remove unconditionally (a missing file is not an error), and
        # leaving it behind after uninstall would keep passwordless root
        # access to systemctl/apt-get/etc. granted to a 'snapmanager'
        # account that may later be reused for something else.
        $SUDO rm -f /etc/sudoers.d/snapcast-manager
        $SUDO systemctl daemon-reload
        ui_ok "Service stopped and removed"

        if [ -d "$INSTALL_BASE_DIR/data" ]; then
            if prompt_yes_no "Also delete all application data (database and settings)?" "n"; then
                $SUDO rm -rf "$INSTALL_BASE_DIR"
                ui_ok "Application and data removed"
            else
                # Remove everything EXCEPT 'data'
                $SUDO find "$INSTALL_BASE_DIR" -mindepth 1 -maxdepth 1 ! -name 'data' -exec rm -rf {} +
                ui_ok "Application removed, data kept in $INSTALL_BASE_DIR/data"
            fi
        else
            $SUDO rm -rf "$INSTALL_BASE_DIR"
            ui_ok "Application removed"
        fi

        ui_note "The '$SNAPMANAGER_USER' system user was left in place. Remove it with 'userdel $SNAPMANAGER_USER' if you want."
        echo ""
        ui_ok "Snapcast Manager has been uninstalled."
        exit 0
    else
        echo "Uninstallation cancelled."
        exit 0
    fi
}

# Parse arguments
AUTO_CONFIRM=false
RESTORE_FILE=""
APP_PORT=""
APP_MODE=""
INSTALL_SERVICE=""
RESUMED=false
RUN_KIND="install"
ACTION="install"

while [[ $# -gt 0 ]]; do
    case "$1" in
        # --auto-confirm is -y for the second half of a remote run, when a
        # release too old to know it should ignore it. See EXEC_ARGS below.
        -y|--yes|--auto-confirm)
            AUTO_CONFIRM=true
            shift
            ;;
        --restore)
            RESTORE_FILE="$2"
            shift 2
            ;;
        --restore=*)
            RESTORE_FILE="${1#*=}"
            shift
            ;;
        --port)
            APP_PORT="$2"
            shift 2
            ;;
        --port=*)
            APP_PORT="${1#*=}"
            shift
            ;;
        --mode)
            APP_MODE="$2"
            shift 2
            ;;
        --mode=*)
            APP_MODE="${1#*=}"
            shift
            ;;
        --no-service)
            INSTALL_SERVICE=false
            shift
            ;;
        --resumed=*)
            # Internal: the second half of a remote run, after the downloaded
            # release's own installer takes over. The first half has already
            # shown the summary and asked for confirmation.
            if [[ "${1#*=}" =~ ^(install|update):([0-9]+)/([0-9]+)$ ]]; then
                RESUMED=true
                RUN_KIND="${BASH_REMATCH[1]}"
                STEP_NUM="${BASH_REMATCH[2]}"
                STEP_TOTAL="${BASH_REMATCH[3]}"
            fi
            shift
            ;;
        *)
            shift
            ;;
    esac
done

# These values end up in server/.env and in curl's URL.
if [ -n "$APP_PORT" ] && ! is_valid_port "$APP_PORT"; then
    echo -e "${RED}Error: --port must be a number from 1 to 65535.${NC}" >&2
    exit 1
fi
if [ -n "$APP_MODE" ] && ! is_valid_mode "$APP_MODE"; then
    echo -e "${RED}Error: --mode must be client, server or both.${NC}" >&2
    exit 1
fi
MODE_SOURCE=""
PORT_SOURCE=""
if [ -n "$APP_MODE" ]; then
    MODE_SOURCE="flag"
fi
if [ -n "$APP_PORT" ]; then
    PORT_SOURCE="flag"
fi

# 1. Check for Linux
if [[ "$OSTYPE" != "linux-gnu"* ]]; then
    echo -e "${RED}Error: This script is intended for Linux systems only.${NC}"
    exit 1
fi

# Determine if SUDO is needed
if [ "$(id -u)" -eq 0 ]; then
    SUDO=""
else
    if command -v sudo >/dev/null 2>&1; then
        SUDO="sudo"
    else
        echo -e "${RED}Error: This script requires root privileges or sudo to be installed.${NC}"
        exit 1
    fi
fi

trap on_exit EXIT
# A signal would otherwise end the shell without running the EXIT trap.
trap 'exit 130' INT TERM

print_banner() {
    echo -e "${MAGENTA}${BOLD}"
cat << "EOF"
   _____                                 _     __  __                                   
  / ____|                               | |   |  \/  |                                  
 | (___  _ __   __ _ _ __   ___ __ _ ___| |_  | \  / | __ _ _ __   __ _  __ _  ___ _ __ 
  \___ \| '_ \ / _` | '_ \ / __/ _` / __| __| | |\/| |/ _` | '_ \ / _` |/ _` |/ _ \ '__|
  ____) | | | | (_| | |_) | (_| (_| \__ \ |_  | |  | | (_| | | | | (_| | (_| |  __/ |   
 |_____/|_| |_|\__,_| .__/ \___\__,_|___/\__| |_|  |_|\__,_|_| |_|\__,_|\__, |\___|_|   
                    | |                                                  __/ |          
                    |_|                                                 |___/           
EOF
    echo -e "${NC}"
    echo -e "${BOLD}Snapcast Manager Installer${NC}"
}

print_fresh_intro() {
    echo -e "\nThis sets up Snapcast Manager on this system:"
    echo -e "  - ${BOLD}Snapcast Manager${NC}: the web dashboard and control server"
    echo -e "  - ${BOLD}Node.js${NC}: the runtime for the server, if missing"
    echo -e "  - ${BOLD}System tools${NC}: curl, ffmpeg and build-essential, if missing"
    echo -e "\nSnapserver and Snapclient are ${BOLD}not${NC} installed here. Add them later from the web interface."
}

# Remote flow, existing install: one summary, one question, nothing else.
plan_existing_install() {
    collect_settings

    if [ "$INSTALLED_VERSION" = "$VERSION" ]; then
        ui_heading "Snapcast Manager is up to date"
    else
        ui_heading "Update available"
    fi
    ui_row "Installed" "${INSTALLED_VERSION:-unknown}"
    ui_row "New" "$VERSION"
    print_settings
    if [ "$INSTALLED_VERSION" != "$VERSION" ]; then
        ui_row "Data" "database and settings are kept"
    fi
    echo ""

    choose_action

    if [ "$ACTION" = "clean" ]; then
        # Starting fresh means not reusing the old install's answers either.
        if ! prompt_yes_no "This permanently deletes the database and all settings. Continue?" "n"; then
            echo "Installation aborted."
            exit 0
        fi
        PRESERVE_DATA=false
        SAVED_PORT=""
        SAVED_MODE=""
        if [ "$MODE_SOURCE" != "flag" ]; then
            APP_MODE=""
        fi
        if [ "$PORT_SOURCE" != "flag" ]; then
            APP_PORT=""
        fi
        collect_settings
        RUN_KIND="install"
    else
        RUN_KIND="update"
    fi

    # The user has decided. Nothing else in this run asks them anything.
    AUTO_CONFIRM=true
}

plan_fresh_install() {
    print_fresh_intro
    collect_settings

    ui_heading "Ready to install"
    ui_row "Version" "$VERSION"
    print_settings
    echo ""

    if ! prompt_yes_no "Install Snapcast Manager $VERSION?" "y"; then
        echo "Installation aborted."
        exit 0
    fi
}

# Local checkout: there is nothing to download and the menu doesn't apply,
# but an existing install's settings are still reused.
plan_local_install() {
    local local_version
    local_version=$(read_package_version server/package.json)
    VERSION="${local_version:-$VERSION}"

    if [ -z "$SAVED_PORT$SAVED_MODE" ] && [ "$SERVICE_INSTALLED" = false ]; then
        plan_fresh_install
        return 0
    fi

    RUN_KIND="update"
    collect_settings

    ui_heading "Install from this directory"
    ui_row "Source" "$PWD"
    ui_row "Version" "$VERSION"
    print_settings
    echo ""

    if ! prompt_yes_no "Continue?" "y"; then
        echo "Installation aborted."
        exit 0
    fi
    AUTO_CONFIRM=true
}

plan_steps() {
    # System requirements, dependencies, configuration.
    STEP_TOTAL=3
    if [ "$INSTALL_SERVICE" = true ]; then
        # Service setup, verification.
        STEP_TOTAL=$((STEP_TOTAL + 2))
    fi
    if [ "$REMOTE_FLOW" = true ]; then
        # Download, unpack.
        STEP_TOTAL=$((STEP_TOTAL + 2))
        if [ "$EXISTING_INSTALL" = true ]; then
            # Replace the old version.
            STEP_TOTAL=$((STEP_TOTAL + 1))
        fi
    fi
}

REMOTE_FLOW=false
PRESERVE_DATA=true
if [ "$RESUMED" = true ]; then
    # The first half settled all of this and passed it along.
    APP_PORT="${APP_PORT:-$DEFAULT_PORT}"
    APP_MODE="${APP_MODE:-$DEFAULT_MODE}"
    INSTALL_SERVICE="${INSTALL_SERVICE:-true}"
else
    if [[ ! -d "server" ]] || [[ ! -d "client" ]]; then
        REMOTE_FLOW=true
    fi

    print_banner
    detect_install

    if [ "$REMOTE_FLOW" = false ]; then
        plan_local_install
    elif [ "$EXISTING_INSTALL" = true ]; then
        plan_existing_install
    else
        plan_fresh_install
    fi

    plan_steps

    # Later steps run behind a spinner. Ask for the password now, where the
    # prompt can be seen.
    if [ -n "$SUDO" ]; then
        $SUDO -v 2>/dev/null || true
    fi
fi

# Application Configuration
APP_DIR="/opt/snapcast-manager"
REPO_URL="https://github.com/NaturalDevCR/Snapcast-Manager.git"
NODE_VERSION="22"


# Builds the complete new tree next to the install, on the same filesystem so
# that replace_install can rename it into place. Runs while the old version is
# still serving, so running out of disk here costs nothing.
stage_release() {
    local parent
    parent=$(dirname "$INSTALL_BASE_DIR")
    $SUDO mkdir -p "$parent"
    # Left by a run that was killed. *.old.* is not touched: it could be the
    # only copy of an install.
    $SUDO find "$parent" -maxdepth 1 -name "$(basename "$INSTALL_BASE_DIR").new.*" -exec rm -rf {} +

    STAGE_DIR=$($SUDO mktemp -d "${INSTALL_BASE_DIR}.new.XXXXXX")
    run_quiet "Copying the new version" $SUDO cp -r "$RELEASE_ROOT/." "$STAGE_DIR/"
    if [ "$IS_SOURCE_ARCHIVE" = true ]; then
        # Forces a rebuild, since this is source code.
        $SUDO touch "$STAGE_DIR/.rebuilding"
    fi

    # The second half writes this too, but only after its slow steps. Saving
    # it here means a run that fails in between still has the settings for the
    # next run. A release that doesn't know the marker would never remove it.
    write_env_file "$STAGE_DIR/server/.env"
    $SUDO chmod 600 "$STAGE_DIR/server/.env"
    if grep -q "$INCOMPLETE_MARKER" "$RELEASE_ROOT/scripts/install.sh"; then
        $SUDO touch "$STAGE_DIR/$INCOMPLETE_MARKER"
    fi
}

# Sets DATA_SOURCE to the directory holding the database, if there is one.
find_data_source() {
    DATA_SOURCE=""
    LEGACY_DATA_BACKUP=""
    # DB can be in root data/ (production) or server/data/ (legacy installs missing NODE_ENV)
    if [ -n "$($SUDO ls -A "$INSTALL_BASE_DIR/data" 2>/dev/null)" ]; then
        DATA_SOURCE="$INSTALL_BASE_DIR/data"
    elif [ -n "$($SUDO ls -A "$INSTALL_BASE_DIR/server/data" 2>/dev/null)" ]; then
        DATA_SOURCE="$INSTALL_BASE_DIR/server/data"
        ui_warn "Found database in the legacy path server/data/, migrating to data/"
    else
        # Installers up to v0.4.3 deleted the install before downloading, and
        # a failed download left the only copy here. /tmp is writable by every
        # local user, so anything root didn't create could be a planted
        # database and is ignored.
        local legacy=/tmp/snapmgr_data_backup
        if [ -d "$legacy" ] && [ ! -L "$legacy" ] \
            && [ -n "$($SUDO find "$legacy" -maxdepth 0 -user root ! -perm /022)" ]; then
            DATA_SOURCE="$legacy"
            LEGACY_DATA_BACKUP="$legacy"
            ui_warn "Found the database backup left by an earlier failed update"
        fi
    fi
}

# The only destructive part of the remote flow. The database is copied after
# the service stops so it is consistent, and the old tree is left whole until
# the new one, database included, is complete.
replace_install() {
    if [ "$EXISTING_INSTALL" = true ]; then
        SERVICE_STOPPED=false
        if $SUDO systemctl is-active --quiet "$SERVICE_NAME"; then
            SERVICE_STOPPED=true
        fi
        $SUDO systemctl stop "$SERVICE_NAME" 2>/dev/null || true
        ui_ok "Service stopped"

        if [ "$PRESERVE_DATA" = true ]; then
            find_data_source
            if [ -n "$DATA_SOURCE" ]; then
                $SUDO mkdir -p "$STAGE_DIR/data"
                run_quiet "Copying the database from $DATA_SOURCE" $SUDO cp -a "$DATA_SOURCE/." "$STAGE_DIR/data/"
            else
                ui_note "No database to keep."
            fi
        else
            ui_warn "Clean re-install: the database is not kept"
        fi
    fi

    # mktemp's 700 was only for building it.
    $SUDO chmod 755 "$STAGE_DIR"

    if [ "$EXISTING_INSTALL" = true ]; then
        local old_dir
        old_dir=$($SUDO mktemp -d "${INSTALL_BASE_DIR}.old.XXXXXX")
        # Ctrl-C between these two renames would leave no install at all.
        trap '' INT TERM
        if ! $SUDO mv -T "$INSTALL_BASE_DIR" "$old_dir/install"; then
            $SUDO rmdir "$old_dir" || true
            exit 1
        fi
        if ! $SUDO mv -T "$STAGE_DIR" "$INSTALL_BASE_DIR"; then
            $SUDO mv -T "$old_dir/install" "$INSTALL_BASE_DIR"
            $SUDO rmdir "$old_dir" || true
            exit 1
        fi
        STAGE_DIR=""
        OLD_INSTALL_INTACT=false
        trap 'exit 130' INT TERM
        $SUDO rm -rf "$old_dir"
        ui_ok "Previous version replaced"

        if [ -n "${LEGACY_DATA_BACKUP:-}" ]; then
            $SUDO rm -rf "$LEGACY_DATA_BACKUP"
        fi
        $SUDO systemctl disable "$SERVICE_NAME" 2>/dev/null || true
    else
        $SUDO mv -T "$STAGE_DIR" "$INSTALL_BASE_DIR"
        STAGE_DIR=""
    fi

    $SUDO chown -R $USER:$USER "$INSTALL_BASE_DIR"
}

# 0. Download the release (remote flow only)
if [ "$REMOTE_FLOW" = true ]; then
    # Nothing touches the current install until the new release is downloaded,
    # verified and unpacked, so a failure up to replace_install leaves the old
    # version running.
    OLD_INSTALL_INTACT="$EXISTING_INSTALL"

    ui_step "Downloading Snapcast Manager $VERSION"

    if ! command -v wget >/dev/null 2>&1 || ! command -v unzip >/dev/null 2>&1 || ! command -v sha256sum >/dev/null 2>&1; then
        # sha256sum (GNU coreutils) verifies the downloaded release .zip's
        # hash below (Task 75) before it is ever extracted/installed --
        # ships in every Debian/Ubuntu base install already, so this is
        # a defensive check, not an expected real-world install path.
        if prompt_yes_no "Missing wget, unzip, or sha256sum. Install them?" "y"; then
            run_quiet "Installing wget, unzip and coreutils" install_packages wget unzip coreutils
        else
            echo "Cannot proceed without wget, unzip, and sha256sum. Installation aborted."
            exit 1
        fi
    fi

    # Task 75: verify_download_hash() (scripts/lib/verify-download.sh)
    # size+hash-verifies the downloaded release .zip below, against the
    # size/digest fields GitHub's Releases API returns for that asset.
    # Fallback definition matching the exact real logic in that file --
    # see this script's earlier optional `source
    # "$SCRIPT_DIR/lib/verify-download.sh"` for why a fallback (rather
    # than just failing when the lib file is absent) is needed here: the
    # primary documented install path (`curl -sL .../install.sh |
    # bash`, README.md) fetches ONLY this one file, never scripts/lib/,
    # so relying solely on that optional source would silently skip
    # real verification on the most common real-world path -- defeating
    # this task's whole purpose. Kept byte-for-byte identical to
    # scripts/lib/verify-download.sh's real body (that file remains the
    # single source of truth exercised by scripts/test-verify-download.sh;
    # this is a deliberate, disclosed duplication for the piped-install
    # case, not a divergent reimplementation).
    if ! declare -f verify_download_hash >/dev/null 2>&1; then
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
    fi

    # Private to the user running this, so nothing can swap the archive between
    # the hash check and unpacking. Nothing here needs root.
    WORK_DIR=$(mktemp -d /tmp/snapcast-manager-update.XXXXXX)
    RELEASE_ARCHIVE="$WORK_DIR/snapmanager.zip"

    # Fetch the release's full API response once (not pre-filtered to
    # just browser_download_url lines, as before) -- Task 75 needs each
    # asset's "size"/"digest" fields too, which live in the SAME object
    # as its browser_download_url, not as standalone lines elsewhere in
    # the response.
    API_URL="https://api.github.com/repos/NaturalDevCR/Snapcast-Manager/releases/tags/${VERSION}"
    RELEASE_JSON=$(curl -sL "$API_URL" || true)

    # Isolate just the "assets": [ ... ] array (2-space indent, GitHub's
    # standard pretty-printed API format) so the per-asset block split
    # below can safely use "name" as a splitting anchor -- the top-level
    # release object ALSO has its own unrelated "name" field (the
    # release's display title, e.g. "v0.3.0"), which would otherwise be
    # ambiguous.
    ASSETS_JSON=$(printf '%s\n' "$RELEASE_JSON" | awk '
        /^  "assets": \[/ { flag=1 }
        flag { print }
        flag && /^  \],?$/ { exit }
    ')

    # This repo's release asset filename (release.yml's "Prepare Release
    # Package" step zips to exactly this name). Split ASSETS_JSON into
    # per-asset blocks on the 4-space-indented "{"/"}" object boundaries
    # (each array element), and keep only the block whose "name" field
    # is an EXACT match -- not a substring match. Requirement 1 (this
    # same task) now ALSO publishes a "snapcast-manager-release.zip.sha256"
    # asset in the SAME assets array; a naive `grep ".zip"` (the old
    # logic) would match EITHER asset depending on array order, since
    # ".zip" is a substring of both filenames. Anchoring on the closing
    # quote (`"name": "snapcast-manager-release.zip"` as a literal
    # substring, which cannot appear inside the longer ".zip.sha256"
    # name) makes the match exact.
    RELEASE_ASSET_NAME="snapcast-manager-release.zip"
    ASSET_BLOCK=$(printf '%s\n' "$ASSETS_JSON" | awk -v name="\"name\": \"$RELEASE_ASSET_NAME\"" '
        /^    \{$/ { block = "" }
        { block = block "\n" $0 }
        /^    \},?$/ {
            if (index(block, name) > 0) { print block; exit }
        }
    ')

    REPO_ZIP_URL=$(printf '%s\n' "$ASSET_BLOCK" | grep '"browser_download_url":' | head -n 1 | cut -d '"' -f 4 || true)
    ASSET_SIZE=$(printf '%s\n' "$ASSET_BLOCK" | grep '"size":' | head -n 1 | grep -oE '[0-9]+' || true)
    ASSET_DIGEST=$(printf '%s\n' "$ASSET_BLOCK" | grep '"digest":' | head -n 1 | cut -d '"' -f 4 || true)


    DOWNLOADED_PREBUILT_ASSET=false
    if spin "Downloading release archive" wget -qO "$RELEASE_ARCHIVE" "$REPO_ZIP_URL"; then
        DOWNLOADED_PREBUILT_ASSET=true
    else
        ui_warn "Pre-built asset $VERSION not found. Falling back to tagged source code..."
        REPO_ZIP_URL="https://github.com/NaturalDevCR/Snapcast-Manager/archive/refs/tags/${VERSION}.zip"
        run_quiet "Downloading source archive" wget -qO "$RELEASE_ARCHIVE" "$REPO_ZIP_URL"
    fi

    if [ "$DOWNLOADED_PREBUILT_ASSET" = true ]; then
        if [ -z "$ASSET_SIZE" ] && [ -z "$ASSET_DIGEST" ]; then
            # Genuinely nothing to verify against (e.g. GitHub API
            # response didn't include this asset's metadata for some
            # reason) -- logged clearly rather than silently treated as
            # a pass, matching verifyDownloadedAsset()'s (Task 61,
            # server/src/services/system.ts) own "no digest available"
            # non-fatal-but-disclosed handling.
            ui_warn "No size/hash metadata available from GitHub's API for this asset -- proceeding WITHOUT verification."
        elif ! verify_download_hash "$RELEASE_ARCHIVE" "$ASSET_SIZE" "$ASSET_DIGEST"; then
            ui_error "Downloaded release archive failed verification -- aborting BEFORE extraction/install."
            ui_note "This could mean a corrupted download, a mid-transfer network issue, or (far less"
            ui_note "likely) a tampered asset. Re-run the installer; if this keeps happening, please"
            ui_note "report it."
            exit 1
        else
            ui_ok "Verified: size and hash match GitHub's reported asset metadata"
        fi
    else
        # The tagged-source-code fallback above is a GitHub-generated
        # archive (Codeload), not a release asset -- it has no
        # size/digest field to verify against at all (distinct from the
        # "asset present but metadata missing" case above).
        ui_warn "Source-archive fallback has no GitHub-published checksum to verify against -- proceeding WITHOUT verification."
    fi

    ui_step "Unpacking files"
    EXTRACT_DIR="$WORK_DIR/extract"
    mkdir "$EXTRACT_DIR"
    run_quiet "Unpacking the archive" unzip -qo "$RELEASE_ARCHIVE" -d "$EXTRACT_DIR"

    # A source archive has a root folder, a release archive does not.
    RELEASE_ROOT="$EXTRACT_DIR"
    IS_SOURCE_ARCHIVE=false
    for candidate in "$EXTRACT_DIR"/Snapcast-Manager-*; do
        if [ -d "$candidate" ]; then
            RELEASE_ROOT="$candidate"
            IS_SOURCE_ARCHIVE=true
        fi
    done

    if [ ! -f "$RELEASE_ROOT/scripts/install.sh" ] || [ ! -f "$RELEASE_ROOT/server/package.json" ]; then
        ui_error "The downloaded archive is not a Snapcast Manager release."
        exit 1
    fi

    stage_release
    ui_ok "New version ready"

    if [ "$EXISTING_INSTALL" = true ]; then
        ui_step "Replacing the previous version"
    fi
    replace_install

    cd "$INSTALL_BASE_DIR"
    # Hand over to the installer inside this release, so the unit, sudoers
    # rule and paths it sets up match the release just unpacked.
    #
    # -y and --no-service are never passed together: a release older than
    # --no-service ignores it and would install the service under -y. When
    # the service was declined, that release asks again instead, and
    # --auto-confirm keeps this release from asking anything.
    EXEC_ARGS=("--resumed=${RUN_KIND}:${STEP_NUM}/${STEP_TOTAL}" "--port" "$APP_PORT" "--mode" "$APP_MODE")
    if [ "$INSTALL_SERVICE" = false ]; then
        EXEC_ARGS+=("--no-service")
        if [ "$AUTO_CONFIRM" = true ]; then
            EXEC_ARGS+=("--auto-confirm")
        fi
    elif [ "$AUTO_CONFIRM" = true ]; then
        EXEC_ARGS+=("-y")
    fi
    if [ -n "$RESTORE_FILE" ]; then
        EXEC_ARGS+=("--restore" "$RESTORE_FILE")
    fi
    # Same version as the summary, without asking GitHub a second time.
    if [[ "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
        export SNAPCAST_MANAGER_VERSION="$VERSION"
    fi
    # exec skips the EXIT trap.
    remove_temporary_files
    exec bash scripts/install.sh "${EXEC_ARGS[@]}"
fi

# 2. System requirements
ui_step "Checking system requirements"
PREREQS=()
if ! command -v curl >/dev/null 2>&1; then PREREQS+=("curl"); fi
if ! command -v ffmpeg >/dev/null 2>&1; then PREREQS+=("ffmpeg"); fi
if ! command -v lsb_release >/dev/null 2>&1; then PREREQS+=("lsb-release"); fi

if [ ${#PREREQS[@]} -gt 0 ]; then
    ui_warn "Missing: ${PREREQS[*]}"
    if prompt_yes_no "Do you want to install them?" "y"; then
        run_quiet "Installing ${PREREQS[*]}" install_packages "${PREREQS[@]}"
    fi
else
    ui_ok "curl, ffmpeg and lsb-release found"
fi

# Build tools, for native modules like better-sqlite3
if command -v make >/dev/null 2>&1; then
    ui_ok "Build tools found"
else
    ui_warn "Build tools (make/gcc) not detected"
    if prompt_yes_no "Install build-essential? (Highly recommended for database performance)" "y"; then
        run_quiet "Installing build-essential" install_packages build-essential
    fi
fi

# Node.js
if command -v node >/dev/null 2>&1; then
    NODE_VER=$(node -v)
    ui_ok "Node.js $NODE_VER found"
else
    ui_warn "Node.js not detected"
    if prompt_yes_no "Install Node.js 22?" "y"; then
        run_quiet "Adding the Node.js package source" add_nodesource
        run_quiet "Installing Node.js 22" $SUDO apt-get install -y nodejs
    else
        echo "Installation aborted."
        exit 1
    fi
fi

# 3. Dependencies and build
SOURCE_DIR="$PWD"
if [ -d "server/dist" ] && [ -d "client/dist" ] && [ ! -f ".rebuilding" ]; then
    ui_step "Installing dependencies"
    cd server
    run_quiet "Installing server dependencies" npm install --omit=dev
    verify_native_modules
else
    ui_step "Building Snapcast Manager"
    ui_note "Building from source. This can take several minutes."
    cd server
    run_quiet "Installing server dependencies" npm install
    verify_native_modules
    run_quiet "Building server" npm run build

    cd ../client
    run_quiet "Installing client dependencies" npm install
    run_quiet "Building client" npm run build
    cd ..
fi

# Clean up re-run flag
rm -f "$SOURCE_DIR/.rebuilding"

# 4. Configuration
ui_step "Applying configuration"

# Restore from backup file
if [ -n "$RESTORE_FILE" ]; then
    if [ -f "$RESTORE_FILE" ]; then
        WORK_DIR=$($SUDO mktemp -d /tmp/snapcast-manager-restore.XXXXXX)
        $SUDO tar -xzf "$RESTORE_FILE" -C "$WORK_DIR"
        
        if $SUDO test -d "$WORK_DIR/data"; then
            $SUDO mkdir -p "$INSTALL_BASE_DIR/data"
            $SUDO cp -rT "$WORK_DIR/data" "$INSTALL_BASE_DIR/data"
            $SUDO chown -R $USER:$USER "$INSTALL_BASE_DIR/data"
            ui_ok "Database restored from $RESTORE_FILE"
        fi
        
        if $SUDO test -f "$WORK_DIR/snapserver.conf"; then
            $SUDO cp "$WORK_DIR/snapserver.conf" /etc/snapserver.conf
            $SUDO chown snapserver:snapserver /etc/snapserver.conf
            ui_ok "snapserver.conf restored from $RESTORE_FILE"
        fi
        
    else
        ui_error "Backup file not found: $RESTORE_FILE"
    fi
fi

write_env_file "$INSTALL_BASE_DIR/server/.env"
ui_ok "Settings saved: mode $APP_MODE, port $APP_PORT"

# 5. Systemd Service setup (Task 16: dedicated 'snapmanager' user, sudoers.d,
# systemd sandboxing, and an idempotent migration path for pre-Task-16
# installs that were still running the whole service as $(whoami) -- often
# root). See SECURITY.md's "Privilege model" section and
# .superpowers/sdd/task-16-report.md for the full design and its explicitly
# documented residual risk/real-hardware validation checklist.
if [ "$INSTALL_SERVICE" = true ]; then
    ui_step "Setting up the system service"
    INSTALL_DIR="$INSTALL_BASE_DIR"
    SUDOERS_SRC="$INSTALL_DIR/scripts/sudoers.d/snapcast-manager"
    SUDOERS_DEST="/etc/sudoers.d/snapcast-manager"

    # Fallback definition in case an in-place upgrade from a very old
    # release somehow lacks scripts/lib/migration.sh (should not happen for
    # any install produced from this codebase going forward, since it ships
    # alongside install.sh itself) -- default to "always attempt the full,
    # idempotent migration steps below" rather than silently skip them.
    if ! declare -f unit_needs_user_migration >/dev/null 2>&1; then
        unit_needs_user_migration() { return 0; }
    fi

    ui_note "Applying privilege hardening: dedicated user, sudoers.d rule, systemd sandboxing"

    # --- 6a-pre. The `sudo` package itself (which provides `visudo` AND
    # `/usr/bin/sudo`) must be installed, independent of whether THIS
    # SCRIPT needed sudo to run. Found for real (v0.3.1) on a Proxmox VE
    # host logged in as root directly: `$(id -u) -eq 0` above sets
    # `SUDO=""` and skips the "is sudo installed?" check entirely (root
    # never needs to invoke `sudo` to elevate itself) -- but the privilege
    # MODEL this step is about to set up needs `sudo`/`visudo` to exist on
    # the HOST regardless, because it's the unprivileged `snapmanager`
    # user (not whoever ran this installer) that will need to invoke
    # `sudo` afterward for every privileged action the running app takes.
    # Proxmox VE (and any other root-login-only Debian host, which is
    # common -- root has no need for `sudo` when it's already root) does
    # NOT ship the `sudo` package by default. Without this check, `visudo`
    # not existing at all made Step 6c below fail with the exact same
    # generic "[!] The sudoers file failed 'visudo -c' validation -- NOT
    # installing it." message a genuine syntax error would produce
    # (`command -v visudo` failing makes the `if $SUDO visudo -c -f ...`
    # check below false either way) -- actively misleading, since the file
    # itself was never actually wrong.
    if ! command -v visudo >/dev/null 2>&1; then
        if ! run_quiet "Installing the 'sudo' package" install_packages sudo; then
            ui_error "Privilege-hardening cannot proceed without the 'sudo' package. Fix this manually (e.g. 'apt-get install sudo') and re-run this installer."
            exit 1
        fi
    fi

    # --- 6a. Dedicated system user (idempotent: skipped entirely if it already exists) ---
    if ! getent group audio >/dev/null 2>&1; then
        $SUDO groupadd audio
    fi
    if ! id -u "$SNAPMANAGER_USER" >/dev/null 2>&1; then
        if ! $SUDO useradd --system --no-create-home --shell /usr/sbin/nologin --groups audio "$SNAPMANAGER_USER"; then
            ui_error "Failed to create the '$SNAPMANAGER_USER' user."
            ui_note "Aborting BEFORE touching the systemd unit or restarting the service -- whatever"
            ui_note "configuration was already running (if any) has NOT been modified. Fix whatever"
            ui_note "useradd reported above and re-run this installer."
            exit 1
        fi
        ui_ok "User '$SNAPMANAGER_USER' created"
    else
        ui_ok "User '$SNAPMANAGER_USER' exists"
        # Idempotent top-up: harmless if already a member.
        $SUDO usermod -aG audio "$SNAPMANAGER_USER" 2>/dev/null || true
    fi

    # --- 6b. Ownership. Only the recursive chown of the (potentially large,
    # DB-containing) install tree is conditional on it not already being
    # correct -- this is what keeps a second run from being a "redundant
    # chown storm" per the task brief's idempotency requirement. The
    # smaller /etc paths below are cheap enough to just always re-assert. ---
    CURRENT_OWNER=$($SUDO stat -c '%U' "$INSTALL_BASE_DIR" 2>/dev/null || echo "")
    if [ "$CURRENT_OWNER" != "$SNAPMANAGER_USER" ]; then
        run_quiet "Setting ownership of $INSTALL_BASE_DIR" $SUDO chown -R "$SNAPMANAGER_USER:$SNAPMANAGER_USER" "$INSTALL_BASE_DIR"
    fi

    if [ -f "$INSTALL_DIR/server/.env" ]; then
        $SUDO chmod 600 "$INSTALL_DIR/server/.env"
        $SUDO chown "$SNAPMANAGER_USER:$SNAPMANAGER_USER" "$INSTALL_DIR/server/.env"
    fi

    # A handful of app-managed paths OUTSIDE /opt/snapcast-manager are
    # written to directly by the Node process via plain fs.writeFile/
    # fs.mkdir -- NEVER through sudo -- so they need real DAC ownership by
    # $SNAPMANAGER_USER, not just a ReadWritePaths sandbox exception (sudo
    # elevation never runs for these call sites, so ReadWritePaths alone
    # would leave them EACCES-denied to a non-root process). Grepped call
    # sites: server/src/services/config.ts's writeServerConfig()/
    # ensureModularStructure() (/etc/snapserver.conf, .base, .d/),
    # server/src/services/watchdog.ts's ensureConfig()
    # (/etc/snapcast-manager), server/src/routes/config.ts's POST
    # /api/config/snapclient (/etc/default/snapclient). Created if missing
    # (touch/mkdir as root, since /etc itself is not writable by
    # $SNAPMANAGER_USER) so the app can write into an EXISTING,
    # already-owned path even on a brand-new host where the corresponding
    # package (snapserver/mpd/snapclient) hasn't been installed yet.
    # Task 65: /etc/snapserver.conf.bak added to this loop (and to
    # ReadWritePaths= below). config.ts's writeServerConfigCore() --
    # the ONE place every write to /etc/snapserver.conf funnels through
    # (addStreamSource, saveSegment, deleteSegment, rebuildMasterConfig,
    # removeStreamSourceByFifo, ...) -- calls rotateMasterBak() before every
    # single write, which does installPrivilegedFile(SNAPSERVER_CONFIG_BAK,
    # ...) UNCONDITIONALLY whenever /etc/snapserver.conf already exists (even
    # empty, which it always does post-install.sh's own touch above) -- it
    # is not a rare/edge-case path, it runs on literally every config
    # mutation. ReadWritePaths= never included this path at all, so
    # ProtectSystem=strict made EVERY snapserver.conf write fail under the
    # hardened sandbox (confirmed for real: this task's own container test
    # hit `{"error":"sudo exited with code 1"}` on the very first POST
    # /api/pipe-sources -- `sudo cp` into a path outside every
    # ReadWritePaths= exception fails with a read-only-filesystem error,
    # same root cause class as the ReadWritePaths existence gaps above, just
    # a missing ENTRY rather than a missing pre-created target).
    for p in /etc/snapserver.conf /etc/snapserver.conf.base /etc/snapserver.conf.bak /etc/default/snapclient; do
        if [ ! -e "$p" ]; then
            $SUDO touch "$p"
        fi
        $SUDO chown "$SNAPMANAGER_USER:$SNAPMANAGER_USER" "$p"
    done
    for d in /etc/snapserver.conf.d /etc/snapcast-manager; do
        $SUDO mkdir -p "$d"
        $SUDO chown -R "$SNAPMANAGER_USER:$SNAPMANAGER_USER" "$d"
    done

    # Task 65 (container-integration-tests): EVERY path listed in the
    # hardened unit's ReadWritePaths= below must already exist on disk by
    # the time this unit first starts -- systemd's own mount-namespace setup
    # for a ReadWritePaths entry (file OR directory) hard-fails the unit
    # (`Failed to set up mount namespacing: ...: No such file or directory`,
    # `Failed at step NAMESPACE`) if the target is missing; it does NOT
    # auto-create it. This was never noticed before because this codebase
    # had never actually been run through a genuine fresh install with
    # NOTHING pre-existing (no mpd/snapserver/snap-ctrl ever installed, no
    # prior data/ dir from a restore) until this task's real, systemd-PID-1
    # container test -- confirmed for real, one path at a time, via actual
    # failed runs (see task-65-report.md for the full account). This is a
    # genuine pre-existing installer bug this task's real verification
    # uncovered, not a container-only quirk: the same missing-path failure
    # would happen identically on a real bare-metal fresh install.
    #
    # Two paths are written to DIRECTLY by the Node process (never through
    # sudo), so they need real $SNAPMANAGER_USER ownership, not just
    # existence -- server/src/database.ts's own dbDir (better-sqlite3 opens
    # the .db file directly) and server/src/services/snapshot.ts's
    # SNAPSHOTS_DIR (plain fs.copyFile/fs.mkdir, no installPrivilegedFile
    # call at all).
    for d in "$INSTALL_BASE_DIR/data" "$INSTALL_BASE_DIR/server/snapshots"; do
        $SUDO mkdir -p "$d"
        $SUDO chown -R "$SNAPMANAGER_USER:$SNAPMANAGER_USER" "$d"
    done

    # Every other gap: these are all written to exclusively through sudo
    # elevation (installPrivilegedFile()/runPrivileged(), confirmed by
    # grepping each real call site below), so root ownership is fine --
    # they only need to EXIST for ReadWritePaths' mount-namespace setup to
    # succeed. Each is created empty/root-owned here, matching exactly what
    # an uninstalled/never-touched host would otherwise have; whatever
    # actually manages each path later (mpd's own package, this app's own
    # runtime code, an admin action) is free to populate/re-own it normally
    # from that point on -- this only unblocks the FIRST unit start.
    #
    #   /etc/mpd.conf (file) + /var/lib/mpd (dir): services/pipeSources.ts's
    #     MPD_CONF_PATHS/writeMpdOutput() -- the original failure this task
    #     found first.
    #   /etc/snapclient-manager: services/snapclientInstances.ts's ENV_DIR.
    #   /var/lib/snapcast-manager/scripts: services/tools.ts's
    #     MANAGED_SCRIPTS_DIR (that file's own header comment already
    #     documents "nothing in this codebase or the installer ever creates"
    #     this directory as a known, disclosed gap -- this closes it at the
    #     one point that actually matters for NAMESPACE setup; the app's own
    #     lazy ensureManagedScriptsDir() remains as defense in depth for any
    #     future install path that skips this installer).
    #   /var/backups/snapmanager: services/backup.ts's BACKUP_DIR.
    #   /var/lib/snapserver: created by the snapserver PACKAGE itself once
    #     actually installed (services/system.ts's executeDebUpdate()); a
    #     host that has never installed snapserver doesn't have it yet.
    #   /etc/apt/keyrings: services/system.ts's mympd/nodesource GPG-key
    #     setup (`runPrivileged(['mkdir','-p','/etc/apt/keyrings'])`) --
    #     NOT guaranteed present on a minimal Debian bookworm base image
    #     (it's a Debian-wide convention, not something every base install
    #     ships by default).
    #   /etc/apt/sources.list.d: normally ships with every Debian apt
    #     install already; mkdir -p'd here too regardless, since it's free
    #     and this whole block's purpose is to stop assuming instead of
    #     verifying.
    #   /usr/share/snapserver/snap-ctrl (dir, confirmed by
    #     services/system.ts's `fs.promises.readdir(...)` call against this
    #     exact path): created by the dedicated snap-ctrl install action;
    #     absent on a host that has never run it.
    for d in /var/lib/mpd /etc/snapclient-manager /var/lib/snapcast-manager/scripts \
             /var/backups/snapmanager /var/lib/snapserver /etc/apt/keyrings \
             /etc/apt/sources.list.d /usr/share/snapserver/snap-ctrl; do
        $SUDO mkdir -p "$d"
    done
    if [ ! -e /etc/mpd.conf ]; then
        $SUDO touch /etc/mpd.conf
    fi

    # /run/snapcast-manager: services/pipeSources.ts's RUNTIME_DIR (the FIFO
    # directory) -- ephemeral by nature (lives on tmpfs-backed /run, so it
    # never survives a reboot regardless of this installer). This one-time
    # pre-creation used to be load-bearing for snapmanager.service's OWN
    # first start (its ReadWritePaths= entry for this path hard-fails the
    # unit's NAMESPACE setup if the target doesn't already exist on disk --
    # see the Task 65 ReadWritePaths comment block below), which could
    # happen before any pipe source had ever created it via
    # ensureRuntimeDir()/a radio unit's own ExecStartPre.
    #
    # That's now handled properly by the unit itself: NEW_UNIT_CONTENT below
    # carries a `RuntimeDirectory=snapcast-manager` directive, systemd's own
    # built-in mechanism for exactly this -- it (re-)creates /run/<name>
    # fresh before EVERY unit start (including after a real reboot's tmpfs
    # wipe, not just the first one), before ReadWritePaths=' mount-namespace
    # setup ever runs, and removes it on stop. That makes this block
    # redundant for correctness. Left in place anyway as harmless,
    # idempotent defense-in-depth: it's a no-op once RuntimeDirectory= has
    # created the directory, and it protects an install still running on a
    # pre-Task-66 unit file (before this migration ships) or a
    # hypothetically ancient systemd without RuntimeDirectory= support.
    $SUDO mkdir -p -m 0770 /run/snapcast-manager
    $SUDO chgrp audio /run/snapcast-manager 2>/dev/null || true

    # --- 6c. sudoers.d, validated via `visudo -c` BEFORE it is ever installed
    # live -- a syntactically broken sudoers file can lock out ALL sudo on
    # this host, so this check is not optional. A validation failure does
    # NOT abort the rest of this step (the service itself still starts fine
    # under User=$SNAPMANAGER_USER without it -- it just loses the ability
    # to perform privileged actions like installing packages), it is loudly
    # reported instead. ---
    if [ -f "$SUDOERS_SRC" ]; then
        TMP_SUDOERS=$(mktemp)
        cp "$SUDOERS_SRC" "$TMP_SUDOERS"
        if $SUDO visudo -c -f "$TMP_SUDOERS" >/dev/null 2>&1; then
            $SUDO install -o root -g root -m 0440 "$TMP_SUDOERS" "$SUDOERS_DEST"
            ui_ok "sudoers.d rule installed"
        else
            ui_error "The sudoers file failed 'visudo -c' validation -- NOT installing it."
            ui_note "The service will still be started as '$SNAPMANAGER_USER', but privileged actions"
            ui_note "(installing packages, controlling snapserver/snapclient/mpd, etc.) will fail with"
            ui_note "'sudo: a password is required' until this is fixed. This is very likely an"
            ui_note "installer/packaging bug rather than a host problem -- please report it, then"
            ui_note "re-run this installer once fixed."
        fi
        rm -f "$TMP_SUDOERS"
    else
        ui_warn "$SUDOERS_SRC not found in this release -- skipping sudoers.d installation."
    fi

    # --- 6d. Hardened unit file. Idempotent (a second run against an
    # already-migrated install renders byte-identical content and performs
    # NO write/reload/restart at all), and transactional against the LIVE
    # unit file: if a previous unit existed, it is backed up before being
    # overwritten, and restored (with its own daemon-reload + restart) if
    # the new configuration fails to come up -- the service is never left
    # running under a half-applied config. If there was no previous unit
    # (fresh install) there is nothing to roll back to, so a failure here
    # fails loudly and exits non-zero instead, per the task brief's second
    # sanctioned failure-handling option. ---
    #
    # Fix-pass additions to ReadWritePaths= below (Criticals #4/#5/#6, found
    # during post-Task-16 review -- `sudo` does NOT create a new mount
    # namespace, so every sudo-elevated child of this ProtectSystem=strict
    # unit stays inside the SAME read-only view unless its own required
    # writable state is listed explicitly here):
    #   /var/lib/dpkg /var/cache/apt /var/lib/apt/lists -- every apt-get/dpkg
    #     call (platform/apt.ts, executeDebUpdate(), uninstallPackage()) is
    #     sudo-elevated and needs to write its OWN package-manager state.
    #   /usr/local/bin /usr/bin -- install-shairport-sync.sh's `make install`
    #     (autotools default prefix /usr/local) installs nqptp/shairport-sync
    #     binaries to /usr/local/bin; uninstallPackage('shairport-sync')
    #     (server/src/services/system.ts) does
    #     `runPrivileged(['rm', '-f', '/usr/local/bin/shairport-sync',
    #     '/usr/local/bin/nqptp'])`; the script's own legacy-cleanup line
    #     also removes stale copies under /usr/bin and runs under `set -e`
    #     with no `|| true`, so a failure there would otherwise abort the
    #     whole script.
    #   /etc/passwd /etc/group /etc/shadow /etc/gshadow -- useradd/groupadd/
    #     usermod (install-shairport-sync.sh's `groupadd -r shairport-sync`/
    #     `useradd -r -M -g shairport-sync ...`, and executeDebUpdate()'s
    #     `usermod -d /var/lib/snapserver snapserver`) write the account
    #     database directly. This is the SAME "broad by necessity because the
    #     sudoers-granted tool itself already carries root-equivalent trust"
    #     reasoning already applied to apt-get/dpkg/make above, not a new,
    #     separate risk category -- see SECURITY.md's "Privilege model"
    #     section for the full writeup.
    #
    # Task 65 (container-integration-tests): `NoNewPrivileges=yes` REMOVED
    # from this unit -- this is the single most significant finding of that
    # task, confirmed for real, not guessed: `NoNewPrivileges=yes` sets the
    # kernel's `PR_SET_NO_NEW_PRIVS` flag for the unit's ENTIRE process tree,
    # which disables the effect of the setuid bit (and file capabilities) on
    # every subsequently exec'd binary -- including `sudo` itself. With it
    # set, `sudo` cannot escalate AT ALL from this unit, for ANY command,
    # regardless of what `/etc/sudoers.d/snapcast-manager` grants: confirmed
    # directly via `runuser -u snapmanager -- sudo -n true` returning exit
    # code 1 from inside a real running instance of this exact unit. Every
    # single sudo-gated privileged operation this app performs --
    # installing/updating/uninstalling any package, starting/stopping/
    # enabling ANY systemd unit (snapserver/snapclient/mpd/its own generated
    # pipe-source units), and every `installPrivilegedFile()` config write
    # (server/src/platform/files.ts, server/src/services/config.ts, etc.) --
    # goes through `needsSudo()`-gated `sudo` calls (server/src/platform/
    # exec.ts). This means `NoNewPrivileges=yes` did not add a hardening
    # LAYER on top of this app's Task-16 sudo-based privilege model -- it
    # silently made that entire model non-functional. This had never been
    # caught before because SECURITY.md's own "real-hardware validation
    # checklist" (added by Task 16, explicitly flagged there as REQUIRED
    # before production use) had never actually been run until this task's
    # real, systemd-PID-1 container verification. `NoNewPrivileges=yes` and
    # a sudo-based elevation architecture are fundamentally incompatible --
    # there is no narrower flag or carve-out that keeps one while allowing
    # the other; the only way to keep it would be to replace `sudo` entirely
    # with a non-setuid elevation mechanism (e.g. a small root-owned helper
    # invoked via a Unix socket, or systemd's own
    # AmbientCapabilities=/CapabilityBoundingSet= in place of full root
    # escalation), which is a materially larger architectural change than
    # this task's "small contained fix" scope -- left as a disclosed,
    # explicit follow-up rather than attempted here. See task-65-report.md
    # for the full account.
    #
    # Task 66: `RuntimeDirectory=snapcast-manager` added below.
    # /run/snapcast-manager (services/pipeSources.ts's RUNTIME_DIR) is
    # tmpfs-backed and does NOT survive a real host reboot; before this,
    # nothing re-created it on every boot -- only ensureRuntimeDir()/a radio
    # unit's own ExecStartPre, both of which only run once a pipe source has
    # actually been created or started. On a host where this unit starts
    # (After=network.target snapserver.service) before any pipe source ever
    # has, its own ReadWritePaths= entry for this path would hard-fail
    # NAMESPACE setup post-reboot, identically to the fresh-install gap Task
    # 65 found (see the ReadWritePaths comment block below). RuntimeDirectory=
    # is systemd's own built-in fix for exactly this: it (re-)creates
    # /run/<name>, owned by this unit's User=/Group=, fresh before EVERY
    # start -- not just the first -- ahead of ReadWritePaths' mount-namespace
    # setup, and removes it on stop. RuntimeDirectoryMode=0770 matches the
    # mode ensureRuntimeDir() already uses for this exact directory.
    #
    # Group ownership: `Group=audio` is added below (this unit previously
    # had no explicit `Group=`, defaulting to $SNAPMANAGER_USER's own
    # per-user primary group from useradd). ensureRuntimeDir()'s chgrp
    # convention -- and the FIFOs underneath, chgrp'd audio by the radio
    # unit's own ExecStartPre -- rely on group `audio` specifically, so
    # snapserver/mpd (both real `audio`-group members, not members of
    # $SNAPMANAGER_USER's own per-user group) need that to even traverse
    # into this directory. The first attempt here was an unprivileged
    # `ExecStartPre=-/bin/chgrp audio /run/snapcast-manager` instead (to
    # avoid touching Group=, since that also becomes the process's own
    # default GID for anything else it creates) -- REJECTED after real
    # container verification: the chgrp itself succeeded
    # (`code=exited, status=0/SUCCESS` in `systemctl status`), but the
    # directory's group was back to $SNAPMANAGER_USER's own group by the
    # time ExecStart ran anyway -- systemd re-applies RuntimeDirectory='s
    # configured User=/Group= ownership before EVERY Exec* line of a single
    # unit start, not just once, silently undoing a chgrp done in an earlier
    # one. `Group=audio` is the only durable fix; the side effect (any file
    # this process creates directly, without an explicit chown, now
    # defaults to group `audio` instead of $SNAPMANAGER_USER's own group)
    # is harmless here -- every such path (the SQLite DB, snapshots/) is
    # read/written exclusively by this same process under its own **user**
    # ownership, which is unaffected; nothing in this codebase gates access
    # by group equality.
    #
    # ReadWritePaths= widened to /etc, /var, /usr wholesale (post-Task-65
    # fix pass, found while verifying the missing-`tar`-sudoers-grant fix
    # end-to-end): the previous, narrowly-enumerated entry list only ever
    # covered paths THIS APP ITSELF writes directly. It never covered a REAL
    # `apt-get install`/`--only-upgrade` of a package with actual library
    # dependencies -- confirmed for real against a hardened container:
    # installing `mpd` for real fails with "Read-only file system" while
    # dpkg unpacks `/usr/lib/<arch-triplet>/liburing.so.2.3`,
    # `/usr/share/doc/libjs-jquery`, etc. -- none of which were ever in the
    # old list. This isn't specific to `mpd`: `mympd` (installMympd()),
    # `ffmpeg` (generic apt fallback in installPackage()), and `node`/`gpg`
    # (updateNodeJs()) all install real packages via the exact same
    # `apt.install()`/`apt.upgrade()` code path in server/src/services/
    # system.ts, and dpkg postinst scripts write to essentially
    # unpredictable paths driven by a package's own (and its TRANSITIVE
    # dependencies') maintainer scripts -- e.g. installing `mpd` was also
    # seen to touch `/etc/apache2` via a documentation-only transitive dep
    # (`javascript-common`), a path with zero connection to mpd itself.
    # There is no finite, enumerable path list that stays correct for
    # arbitrary future Debian packages this app's own package-management
    # feature is explicitly designed to install (see this repo's own
    # scripts/sudoers.d/snapcast-manager and SECURITY.md's "Package-
    # management is intentionally NOT narrowly restricted" section --
    # apt-get/dpkg are ALREADY granted broad, unrestricted-argument
    # NOPASSWD sudo access for exactly this reason; a real dpkg postinst
    # already runs arbitrary root code today regardless of this
    # mount-namespace boundary). Widening ReadWritePaths= to these three
    # top-level directories is the honest acknowledgment of that existing
    # trade-off, not a new one -- the narrower, individually-listed entries
    # below are now redundant (fully covered by /etc, /var, /usr, /run) but
    # are left in place rather than removed, both for the historical
    # reasoning attached to each and because $INSTALL_BASE_DIR/data and
    # $INSTALL_BASE_DIR/server/snapshots still need their own entries (they
    # don't live under /etc, /var, /usr, or /run).
    #
    # /run was ALSO widened wholesale in this same fix pass (was previously
    # only /run/snapcast-manager individually) -- confirmed for real: even
    # with /etc/var/usr open, a real `apt-get install mpd` still failed,
    # this time in mpd's own postinst script (`adduser --system mpd`
    # failing with "could not open lock file /run/adduser!"). Same
    # unpredictable-transitive-postinst-script reasoning as /etc/var/usr
    # above applies identically to /run. NOT redundant with `Task 66`'s
    # `RuntimeDirectory=snapcast-manager` right above -- that directive only
    # (re-)creates this app's OWN `/run/snapcast-manager` subdirectory
    # across reboots; this `ReadWritePaths=` widening is what lets an
    # unrelated dpkg postinst script write its OWN, different `/run` paths
    # (`/run/adduser`, etc.) that neither directive knew about in advance.
    NEW_UNIT_CONTENT=$(cat <<EOF
[Unit]
Description=Snapcast Manager Service
After=network.target snapserver.service

[Service]
Type=simple
User=$SNAPMANAGER_USER
Group=audio
WorkingDirectory=$INSTALL_DIR/server
RuntimeDirectory=snapcast-manager
RuntimeDirectoryMode=0770
ExecStart=$(command -v node) dist/index.js
Restart=always
EnvironmentFile=$INSTALL_DIR/server/.env
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
ReadWritePaths=$INSTALL_BASE_DIR/data $INSTALL_BASE_DIR/server/snapshots /run /etc /var /usr /etc/snapserver.conf /etc/snapserver.conf.base /etc/snapserver.conf.bak /etc/snapserver.conf.d /etc/snapcast-manager /var/lib/snapcast-manager/scripts /var/backups/snapmanager /etc/mpd.conf /var/lib/mpd /etc/systemd/system /etc/default/snapclient /etc/snapclient-manager /var/lib/snapserver /etc/apt/keyrings /etc/apt/sources.list.d /usr/share/snapserver/snap-ctrl /var/lib/dpkg /var/cache/apt /var/lib/apt/lists /usr/local/bin /usr/bin /etc/passwd /etc/group /etc/shadow /etc/gshadow

[Install]
WantedBy=multi-user.target
EOF
)

    UNIT_CHANGED=true
    UNIT_BACKUP=""
    if [ -f "$UNIT_FILE" ]; then
        EXISTING_UNIT_CONTENT=$($SUDO cat "$UNIT_FILE" 2>/dev/null || echo "")
        if unit_needs_user_migration "$EXISTING_UNIT_CONTENT"; then
            ui_note "Migrating the existing service to User=$SNAPMANAGER_USER"
        fi
        if [ "$EXISTING_UNIT_CONTENT" = "$NEW_UNIT_CONTENT" ]; then
            UNIT_CHANGED=false
        else
            UNIT_BACKUP=$(mktemp)
            $SUDO cp "$UNIT_FILE" "$UNIT_BACKUP"
        fi
    fi

    if [ "$UNIT_CHANGED" = false ]; then
        ui_ok "Service definition already up to date"
        $SUDO systemctl daemon-reload
        $SUDO systemctl enable "$SERVICE_NAME" 2>/dev/null || true
        # Post-v0.3.2 fix, found live: this branch used to assume the
        # service was already running whenever the unit file itself hadn't
        # changed, and never called start/restart -- true on a fresh
        # install (nothing to stop yet) but false on the REMOTE update
        # flow, which explicitly stops the running service earlier (see
        # this script's own "Stopping existing service..." step, well
        # before reaching here) to safely back up data before re-extracting
        # the new release. Whenever the unit content happens to be
        # byte-identical between the old and new version (true for a
        # v0.3.1 -> v0.3.2 update, since neither changed the unit template
        # itself), the service was left stopped after every such update --
        # confirmed live on a real host. Explicitly check and (re)start it.
        if ! $SUDO systemctl is-active --quiet "$SERVICE_NAME"; then
            $SUDO systemctl start "$SERVICE_NAME"
        fi
        if wait_for_app; then
            ui_ok "Service started"
        else
            ui_error "Service is not responding on port $APP_PORT."
            show_service_logs
            exit 1
        fi
    else
        echo "$NEW_UNIT_CONTENT" | $SUDO tee "$UNIT_FILE" >/dev/null
        $SUDO systemctl daemon-reload
        run_quiet "Enabling the service" $SUDO systemctl enable "$SERVICE_NAME"

        RESTART_OK=false
        if $SUDO systemctl restart "$SERVICE_NAME"; then
            # `systemctl restart` returning 0 only means the start request
            # was accepted, not that the process stayed up -- give it a
            # moment then verify it's actually active before declaring
            # success (Type=simple + Restart=always would otherwise mask a
            # persistent crash-loop, e.g. from a ReadWritePaths omission,
            # as a "successful" restart here).
            if wait_for_app; then
                RESTART_OK=true
            fi
        fi

        if [ "$RESTART_OK" = true ]; then
            ui_ok "Service installed and started as user '$SNAPMANAGER_USER'"
            [ -n "$UNIT_BACKUP" ] && rm -f "$UNIT_BACKUP"
        else
            ui_error "Service failed to start (or stay running) with the new hardened configuration."
            show_service_logs
            if [ -n "$UNIT_BACKUP" ]; then
                ui_note "Rolling back to the previous unit file so the service is not left down..."
                $SUDO cp "$UNIT_BACKUP" "$UNIT_FILE"
                $SUDO systemctl daemon-reload
                if $SUDO systemctl restart "$SERVICE_NAME"; then
                    ui_warn "Rolled back successfully -- the service is running again under its PREVIOUS configuration."
                    ui_note "The privilege-hardening migration did NOT complete. Investigate the error above"
                    ui_note "(commonly: a missing ReadWritePaths entry, or an unusual node/systemd path) and"
                    ui_note "re-run this installer -- it is safe to re-run."
                    rm -f "$UNIT_BACKUP" 2>/dev/null || true
                else
                    ui_error "Rollback ALSO failed to start the service. Manual intervention required."
                    ui_note "The previous unit file's content was saved at: $UNIT_BACKUP (left in place, NOT deleted)."
                fi
                exit 1
            else
                ui_note "No previous unit file existed to roll back to (this was a fresh install)."
                exit 1
            fi
        fi
    fi
fi

# 6. Verify, then report what is actually true.
FINAL_VERSION=$(read_package_version "$SOURCE_DIR/server/package.json")
FINAL_VERSION="${FINAL_VERSION:-$VERSION}"

if [ "$INSTALL_SERVICE" = true ]; then
    ui_step "Verifying the installation"
    if ! wait_for_app; then
        ui_error "Snapcast Manager is not answering on port $APP_PORT."
        show_service_logs
        exit 1
    fi
    ui_ok "Web interface responds on port $APP_PORT"
    if ! $SUDO systemctl is-active --quiet "$SERVICE_NAME"; then
        ui_error "Service '$SERVICE_NAME' is not active."
        show_service_logs
        exit 1
    fi
    ui_ok "Service '$SERVICE_NAME' is active"
    ui_ok "Version $FINAL_VERSION"
fi

$SUDO rm -f "$SOURCE_DIR/$INCOMPLETE_MARKER"

# Detect Local IP
LOCAL_IP=$(hostname -I | awk '{print $1}')
if [ -z "$LOCAL_IP" ]; then
    LOCAL_IP="<your-server-ip>"
fi

if [ -n "$INSTALL_LOG" ]; then
    rm -f "$INSTALL_LOG"
fi

if [ "$INSTALL_SERVICE" = true ]; then
    if [ "$RUN_KIND" = "update" ]; then
        echo -e "\n${GREEN}${BOLD}${OK_MARK} Snapcast Manager $FINAL_VERSION is updated and running${NC}\n"
    else
        echo -e "\n${GREEN}${BOLD}${OK_MARK} Snapcast Manager $FINAL_VERSION is installed and running${NC}\n"
    fi
    ui_row "Open" "${BOLD}http://${LOCAL_IP}:${APP_PORT}${NC}"
    ui_row "Mode" "$APP_MODE"
    if [ "$RUN_KIND" != "update" ]; then
        echo -e "\nOn your first visit, the Setup Wizard will guide you through the rest."
    fi
else
    echo -e "\n${YELLOW}${BOLD}Snapcast Manager $FINAL_VERSION is installed, but it is not running${NC}\n"
    ui_row "Files" "$SOURCE_DIR"
    ui_row "Mode" "$APP_MODE"
    ui_row "Port" "$APP_PORT"
    echo -e "\nThe system service was skipped. Run this installer again to set it up."
fi
echo -e "\nMade with ❤️ by NaturalDevCR.\n"
