#!/bin/bash

# Snapcast Manager - Installer Script
# Designed for Debian/Ubuntu headless servers

set -e

# Colors and formatting for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
NC='\033[0m' # No Color

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

LATEST_RELEASE=$(curl -sL "https://api.github.com/repos/NaturalDevCR/Snapcast-Manager/releases/latest" | grep '"tag_name"' | head -1 | cut -d '"' -f 4)
VERSION="${LATEST_RELEASE:-v0.2.2}"
APP_VERSION="$VERSION"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'
INSTALL_BASE_DIR="/opt/snapcast-manager"
SERVICE_NAME="snapmanager"
# Task 16: dedicated, unprivileged system user the service runs as (see
# SECURITY.md's "Privilege model" section / .superpowers/sdd/task-16-report.md).
# Coincidentally the same literal string as SERVICE_NAME above, but they are
# two different concepts (a systemd unit name vs. a Unix account name) --
# kept as a separate constant so the rest of this script is self-documenting
# about which one it means at each call site.
SNAPMANAGER_USER="snapmanager"
AUTO_CONFIRM=false

# Helper to ask questions or auto-confirm
prompt_yes_no() {
    local prompt="$1"
    local default="$2"
    
    if [ "$AUTO_CONFIRM" = true ]; then
        echo -e "${prompt} [Auto-confirmed: y]"
        return 0
    fi

    local ans
    if [ -t 0 ]; then
        # Standard interactive terminal
        read -p "$prompt (y/n): " ans
    elif [ -c /dev/tty ]; then
        # Piped execution (curl | bash), but TTY is available
        read -p "$prompt (y/n): " ans < /dev/tty
    else
        # Truly headless (no TTY), use default
        echo -e "${prompt} [Auto-answered: ${default}]"
        [[ "$default" == "y" ]]
        return $?
    fi
    
    [[ "$ans" == "y" || "$ans" == "Y" ]]
}

uninstall_snapmanager() {
    echo -e "\n${RED}${BOLD}=== Uninstalling Snapcast Manager ===${NC}"
    if prompt_yes_no "Are you sure you want to completely remove Snapcast Manager?" "n"; then
        echo "Stopping and disabling service..."
        $SUDO systemctl stop $SERVICE_NAME 2>/dev/null || true
        $SUDO systemctl disable $SERVICE_NAME 2>/dev/null || true
        $SUDO rm -f /etc/systemd/system/${SERVICE_NAME}.service
        # Task 16: remove the app-scoped sudoers.d grant too -- safe to
        # remove unconditionally (a missing file is not an error), and
        # leaving it behind after uninstall would keep passwordless root
        # access to systemctl/apt-get/etc. granted to a 'snapmanager'
        # account that may later be reused for something else.
        $SUDO rm -f /etc/sudoers.d/snapcast-manager
        $SUDO systemctl daemon-reload
        echo -e "${YELLOW}Note: the '$SNAPMANAGER_USER' system user/group were NOT removed${NC} (left in place, standard practice for system accounts). Remove manually with 'userdel $SNAPMANAGER_USER' if desired."

        if [ -d "$INSTALL_BASE_DIR/data" ]; then
            if prompt_yes_no "Do you want to delete all application data (Database and settings)?" "n"; then
                echo "Removing application and data..."
                $SUDO rm -rf "$INSTALL_BASE_DIR"
            else
                echo "Removing application files but keeping $INSTALL_BASE_DIR/data..."
                # Remove everything EXCEPT 'data'
                $SUDO find "$INSTALL_BASE_DIR" -mindepth 1 -maxdepth 1 ! -name 'data' -exec rm -rf {} +
            fi
        else
            $SUDO rm -rf "$INSTALL_BASE_DIR"
        fi
        
        echo -e "${GREEN}[OK] Snapcast Manager has been uninstalled.${NC}"
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

while [[ $# -gt 0 ]]; do
    case "$1" in
        -y|--yes)
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
        *)
            shift
            ;;
    esac
done

# Determine if SUDO is needed
if [ "$(id -u)" -eq 0 ]; then
    SUDO=""
else
    if command -v sudo >/dev/null 2>&1; then
        SUDO="sudo"
    else
        echo -e "${RED}[!] Error: This script requires root privileges or sudo to be installed.${NC}"
        exit 1
    fi
fi

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
echo -e "${GREEN}${BOLD}=== Snapcast Manager Installer ($VERSION) ===${NC}"
echo -e "This script will set up Snapcast Manager on your system.\n"
echo -e "${CYAN}What will be installed:${NC}"
echo -e "  - ${BOLD}Snapcast Manager${NC}: The web dashboard and control server."
echo -e "  - ${BOLD}Node.js${NC}: The JavaScript runtime required to run the server."
echo -e "  - ${BOLD}System Tools${NC}: Utilities like curl, ffmpeg, and build-essential."
echo -e "\n${YELLOW}Note: Snapserver/Snapclient will NOT be installed automatically.${NC}"
echo -e "You can install them later directly from the web interface.\n"

if [ "$AUTO_CONFIRM" != true ]; then
    if ! prompt_yes_no "Do you want to proceed?" "y"; then
        echo "Installation aborted."
        exit 0
    fi
fi

# Choose installation mode (skip if already provided via --mode)
if [ -z "$APP_MODE" ]; then
    if [ "$AUTO_CONFIRM" = true ]; then
        APP_MODE="both"
        echo -e "Installation mode [Auto-confirmed: both]"
    else
        echo -e "\n${CYAN}${BOLD}Choose Installation Mode:${NC}"
        echo -e "  1) ${BOLD}Snapclient Manager Only${NC}  - Manage audio output clients"
        echo -e "  2) ${BOLD}Snapserver Manager Only${NC}  - Manage the audio server"
        echo -e "  3) ${BOLD}Snapcast Manager (both)${NC}  - Full server + client management"

        if [ -t 0 ]; then
            read -p "Select mode (1-3) [3]: " MODE_CHOICE
        elif [ -c /dev/tty ]; then
            read -p "Select mode (1-3) [3]: " MODE_CHOICE < /dev/tty
        else
            MODE_CHOICE=3
        fi

        case "${MODE_CHOICE:-3}" in
            1) APP_MODE="client" ;;
            2) APP_MODE="server" ;;
            *) APP_MODE="both" ;;
        esac
    fi
    echo -e "${GREEN}[OK] Mode set to: ${BOLD}$APP_MODE${NC}\n"
fi

# Application Configuration
APP_DIR="/opt/snapcast-manager"
REPO_URL="https://github.com/NaturalDevCR/Snapcast-Manager.git"
NODE_VERSION="22"


# 0. Check if we need to download the source
if [[ ! -d "server" ]] || [[ ! -d "client" ]]; then
    # Remote install flow
    echo -e "\n${YELLOW}Project files not found in current directory.${NC}"
    echo "It looks like you are running this script remotely."
    
    # Check if already installed
    # Check if already installed
    if [ -d "$INSTALL_BASE_DIR" ]; then
        # Detect currently installed version
        INSTALLED_VERSION="unknown"
        if [ -f "$INSTALL_BASE_DIR/server/package.json" ]; then
            INSTALLED_VERSION=$(grep -m 1 '"version"' "$INSTALL_BASE_DIR/server/package.json" | cut -d '"' -f 4 || echo "unknown")
            INSTALLED_VERSION="v$INSTALLED_VERSION"
        fi

        echo -e "${YELLOW}Snapcast Manager is already installed at $INSTALL_BASE_DIR.${NC}"
        echo -e "Installed Version: ${CYAN}${INSTALLED_VERSION}${NC}"
        echo -e "Installer Version: ${CYAN}${VERSION}${NC}"
        
        DO_UPDATE=false
        PRESERVE_DATA=true
        
        if [ "$INSTALLED_VERSION" = "unknown" ] || [ "$INSTALLED_VERSION" != "$VERSION" ]; then
            echo -e "\n${GREEN}An update is available or version mismatch detected.${NC}"
            echo -e "1) ${CYAN}Update / Upgrade${NC} (Preserves Database & Settings) - Recommended"
            echo -e "2) ${RED}Force Re-install${NC} (Wipes installation bundle but still backs up data)"
            echo -e "3) ${RED}Clean Re-install${NC} (Wipes everything, starting fresh)"
            echo -e "4) ${RED}Uninstall${NC}"
            echo -e "5) ${YELLOW}Abort${NC}"
            
            if [ "$AUTO_CONFIRM" = true ]; then
                CHOICE=1
                echo -e "Select option [Auto-confirmed: 1]"
            else
                if [ -t 0 ]; then
                    read -p "Select an option (1-5): " CHOICE
                elif [ -c /dev/tty ]; then
                    read -p "Select an option (1-5): " CHOICE < /dev/tty
                else
                    echo -e "${RED}[!] No TTY available for input. Aborting.${NC}"
                    exit 1
                fi
            fi

            case "$CHOICE" in
                1|2)
                    DO_UPDATE=true
                    ;;
                3)
                    DO_UPDATE=true
                    PRESERVE_DATA=false
                    ;;
                4)
                    uninstall_snapmanager
                    ;;
                *)
                    echo "Installation aborted."
                    exit 0
                    ;;
            esac
        else
            echo -e "\n${GREEN}You are already running the latest version ($VERSION).${NC}"
            echo -e "1) ${RED}Update / Force Re-install${NC} (Preserves Database & Settings)"
            echo -e "2) ${RED}Clean Re-install${NC} (Wipes everything, starting fresh)"
            echo -e "3) ${RED}Uninstall${NC}"
            echo -e "4) ${YELLOW}Abort${NC}"

            if [ "$AUTO_CONFIRM" = true ]; then
                CHOICE=4
                echo -e "Select option [Auto-confirmed: Abort]"
                exit 0
            else
                if [ -t 0 ]; then
                    read -p "Select an option (1-4): " CHOICE
                elif [ -c /dev/tty ]; then
                    read -p "Select an option (1-4): " CHOICE < /dev/tty
                else
                    echo -e "${RED}[!] No TTY available for input. Aborting.${NC}"
                    exit 1
                fi
            fi

            case "$CHOICE" in
                1)
                    DO_UPDATE=true
                    ;;
                2)
                    DO_UPDATE=true
                    PRESERVE_DATA=false
                    ;;
                3)
                    uninstall_snapmanager
                    ;;
                *)
                    echo "Installation aborted."
                    exit 0
                    ;;
            esac
        fi

        if [ "$DO_UPDATE" = true ]; then
            echo -e "\n${BLUE}Preparing for installation...${NC}"
            echo "Stopping existing service..."
            $SUDO systemctl stop $SERVICE_NAME 2>/dev/null || true
            $SUDO systemctl disable $SERVICE_NAME 2>/dev/null || true
            
            if [ "$PRESERVE_DATA" = true ]; then
                echo "Backing up database data securely..."
                # DB can be in root data/ (production) or server/data/ (legacy installs missing NODE_ENV)
                DB_SOURCE=""
                if [ -d "$INSTALL_BASE_DIR/data" ] && [ "$(ls -A $INSTALL_BASE_DIR/data 2>/dev/null)" ]; then
                    DB_SOURCE="$INSTALL_BASE_DIR/data"
                elif [ -d "$INSTALL_BASE_DIR/server/data" ] && [ "$(ls -A $INSTALL_BASE_DIR/server/data 2>/dev/null)" ]; then
                    DB_SOURCE="$INSTALL_BASE_DIR/server/data"
                    echo -e "${YELLOW}[!] Found DB in legacy path (server/data/), migrating to data/${NC}"
                fi

                if [ -n "$DB_SOURCE" ]; then
                    $SUDO rm -rf /tmp/snapmgr_data_backup
                    $SUDO cp -r "$DB_SOURCE" /tmp/snapmgr_data_backup
                    echo -e "${GREEN}[OK] Database backed up from $DB_SOURCE${NC}"
                else
                    echo "Data directory is empty or missing, skipping backup."
                fi
                
                if [ -f "/etc/snapserver.conf" ]; then
                    $SUDO cp /etc/snapserver.conf /tmp/snapserver_conf_backup
                fi
            else
                echo -e "${RED}[!] Clean re-install: Skipping configuration backups.${NC}"
                $SUDO rm -rf /tmp/snapmgr_data_backup /tmp/snapserver_conf_backup 2>/dev/null || true
            fi
            
            echo "Wiping existing application files..."
            $SUDO rm -rf "$INSTALL_BASE_DIR"
        else
            echo "Installation aborted by user."
            exit 0
        fi
    fi

    if [ ! -d "$INSTALL_BASE_DIR" ]; then
        if ! command -v wget >/dev/null 2>&1 || ! command -v unzip >/dev/null 2>&1 || ! command -v sha256sum >/dev/null 2>&1; then
            echo -e "${YELLOW}Step 0: Checking for essential tools...${NC}"
            # sha256sum (GNU coreutils) verifies the downloaded release .zip's
            # hash below (Task 75) before it is ever extracted/installed --
            # ships in every Debian/Ubuntu base install already, so this is
            # a defensive check, not an expected real-world install path.
            if prompt_yes_no "Missing wget, unzip, or sha256sum. Install them?" "y"; then
                $SUDO apt-get update
                $SUDO apt-get install -y wget unzip coreutils
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

        echo "Downloading pre-built release $VERSION..."

        $SUDO rm -rf "$INSTALL_BASE_DIR"
        $SUDO mkdir -p "$INSTALL_BASE_DIR"

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
        if $SUDO wget -qO /tmp/snapmanager.zip "$REPO_ZIP_URL"; then
            DOWNLOADED_PREBUILT_ASSET=true
        else
            echo -e "${RED}[!] Pre-built asset $VERSION not found. Falling back to tagged source code...${NC}"
            REPO_ZIP_URL="https://github.com/NaturalDevCR/Snapcast-Manager/archive/refs/tags/${VERSION}.zip"
            $SUDO wget -qO /tmp/snapmanager.zip "$REPO_ZIP_URL"
        fi

        if [ "$DOWNLOADED_PREBUILT_ASSET" = true ]; then
            echo "Verifying downloaded release archive against GitHub's reported size/hash..."
            if [ -z "$ASSET_SIZE" ] && [ -z "$ASSET_DIGEST" ]; then
                # Genuinely nothing to verify against (e.g. GitHub API
                # response didn't include this asset's metadata for some
                # reason) -- logged clearly rather than silently treated as
                # a pass, matching verifyDownloadedAsset()'s (Task 61,
                # server/src/services/system.ts) own "no digest available"
                # non-fatal-but-disclosed handling.
                echo -e "${YELLOW}[!] No size/hash metadata available from GitHub's API for this asset -- proceeding WITHOUT verification.${NC}"
            elif ! verify_download_hash /tmp/snapmanager.zip "$ASSET_SIZE" "$ASSET_DIGEST"; then
                echo -e "${RED}[!] Downloaded release archive failed verification -- aborting BEFORE extraction/install.${NC}"
                echo "This could mean a corrupted download, a mid-transfer network issue, or (far less"
                echo "likely) a tampered asset. Re-run the installer; if this keeps happening, please"
                echo "report it."
                $SUDO rm -f /tmp/snapmanager.zip
                exit 1
            else
                echo -e "${GREEN}[OK] Verified: size and hash match GitHub's reported asset metadata.${NC}"
            fi
        else
            # The tagged-source-code fallback above is a GitHub-generated
            # archive (Codeload), not a release asset -- it has no
            # size/digest field to verify against at all (distinct from the
            # "asset present but metadata missing" case above).
            echo -e "${YELLOW}[!] Source-archive fallback has no GitHub-published checksum to verify against -- proceeding WITHOUT verification.${NC}"
        fi

        echo "Extracting source..."
        TEMP_EXTRACT="/tmp/snapmgr_extract"
        $SUDO rm -rf "$TEMP_EXTRACT"
        $SUDO mkdir -p "$TEMP_EXTRACT"
        $SUDO unzip -qo /tmp/snapmanager.zip -d "$TEMP_EXTRACT"
        
        # Move contents to INSTALL_BASE_DIR. Note: source zip has a root folder, release zip does not.
        if [ -d $TEMP_EXTRACT/Snapcast-Manager-* ]; then
            ROOT_FOLDER=$(ls -d $TEMP_EXTRACT/Snapcast-Manager-*)
            $SUDO cp -r $ROOT_FOLDER/. "$INSTALL_BASE_DIR/"
            # Create flag to force rebuild since this is source code
            $SUDO touch "$INSTALL_BASE_DIR/.rebuilding"
        else
            $SUDO cp -r $TEMP_EXTRACT/. "$INSTALL_BASE_DIR/"
        fi
        
        $SUDO rm -rf "$TEMP_EXTRACT"
        $SUDO rm -f /tmp/snapmanager.zip

        # (Flag handled above)

        # Restore database if backup exists
        if [ -d "/tmp/snapmgr_data_backup" ] || [ -f "/tmp/snapserver_conf_backup" ]; then
            echo -e "\n${YELLOW}Restoring previous configuration and database...${NC}"
            if [ -d "/tmp/snapmgr_data_backup" ]; then
                $SUDO mkdir -p "$INSTALL_BASE_DIR/data"
                $SUDO cp -rT /tmp/snapmgr_data_backup "$INSTALL_BASE_DIR/data"
                echo -e "${GREEN}[OK] Database Data restored.${NC}"
            fi
            if [ -f "/tmp/snapserver_conf_backup" ]; then
                $SUDO cp /tmp/snapserver_conf_backup /etc/snapserver.conf
                echo -e "${GREEN}[OK] snapserver.conf restored.${NC}"
            fi
            
            # Clean up backups
            $SUDO rm -rf /tmp/snapmgr_data_backup
            $SUDO rm -f /tmp/snapserver_conf_backup
        fi
        
        $SUDO chown -R $USER:$USER "$INSTALL_BASE_DIR"
        
        echo -e "${GREEN}Resuming installation from $INSTALL_BASE_DIR...${NC}"
        cd "$INSTALL_BASE_DIR"
        # Re-run the script from the new location so relative paths work
        # Pass -y, --restore, and --port if they were used initially
        EXEC_ARGS=()
        if [ "$AUTO_CONFIRM" = true ]; then
            EXEC_ARGS+=("-y")
        fi
        if [ -n "$RESTORE_FILE" ]; then
            EXEC_ARGS+=("--restore" "$RESTORE_FILE")
        fi
        if [ -n "$APP_PORT" ]; then
            EXEC_ARGS+=("--port" "$APP_PORT")
        fi
        if [ -n "$APP_MODE" ]; then
            EXEC_ARGS+=("--mode" "$APP_MODE")
        fi
        exec bash scripts/install.sh "${EXEC_ARGS[@]}"
    else
        echo "Installation aborted."
        exit 1
    fi
fi

# 1. Check for Linux
if [[ "$OSTYPE" != "linux-gnu"* ]]; then
    echo -e "${RED}Error: This script is intended for Linux systems only.${NC}"
    exit 1
fi

# 2. Check for System Prerequisites (Prerequisites)
echo -e "\n${YELLOW}Step 1: Checking for system prerequisites (curl, ffmpeg, lsb-release)...${NC}"
PREREQS=()
if ! command -v curl >/dev/null 2>&1; then PREREQS+=("curl"); fi
if ! command -v ffmpeg >/dev/null 2>&1; then PREREQS+=("ffmpeg"); fi
if ! command -v lsb_release >/dev/null 2>&1; then PREREQS+=("lsb-release"); fi

if [ ${#PREREQS[@]} -gt 0 ]; then
    echo -e "${YELLOW}[!] Missing prerequisites: ${PREREQS[*]}${NC}"
    if prompt_yes_no "Do you want to install them?" "y"; then
        $SUDO apt-get update
        $SUDO apt-get install -y "${PREREQS[@]}"
    fi
else
    echo -e "${GREEN}[OK] All system prerequisites detected.${NC}"
fi


# 2.5 Check for Build Essentials (for native modules like better-sqlite3)
echo -e "\n${YELLOW}Step 2: Checking for build tools...${NC}"
if ! command -v make >/dev/null 2>&1; then
    echo -e "${YELLOW}[!] Build tools (make/gcc) not detected.${NC}"
    if prompt_yes_no "Install build-essential? (Highly recommended for database performance)" "y"; then
        $SUDO apt-get update && $SUDO apt-get install -y build-essential
    fi
fi

# 3. Check for Node.js
echo -e "\n${YELLOW}Step 3: Checking for Node.js...${NC}"
if command -v node >/dev/null 2>&1; then
    NODE_VER=$(node -v)
    echo -e "${GREEN}[OK] Node.js $NODE_VER detected.${NC}"
else
    echo -e "${RED}[!] Node.js not detected.${NC}"
    if prompt_yes_no "Install Node.js 22?" "y"; then
        if [ -n "$SUDO" ]; then
            curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO -E bash -
        else
            curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
        fi

        $SUDO apt-get install -y nodejs
    else
        echo "Installation aborted."
        exit 1
    fi
fi

# 4. Install Dependencies & Build
echo -e "\n${YELLOW}Step 4: Installing dependencies and building project...${NC}"

if [ -d "server/dist" ] && [ -d "client/dist" ] && [ ! -f ".rebuilding" ]; then
    echo -e "${GREEN}[OK] Pre-compiled release detected! Skipping long build process.${NC}"
    echo "Installing server production dependencies..."
    cd server && npm install --omit=dev
else
    echo "Source code detected. Building project from scratch (this may take several minutes)..."
    echo "Installing server dependencies..."
    cd server && npm install
    echo "Building server..."
    npm run build

    echo "Installing client dependencies..."
    cd ../client && npm install
    echo "Building client..."
    npm run build
    cd ..
fi

# Clean up re-run flag
rm -f .rebuilding

# 4.5 Restore from backup file
if [ -n "$RESTORE_FILE" ]; then
    echo -e "\n${YELLOW}Step 3.5: Restoring from backup file...${NC}"
    if [ -f "$RESTORE_FILE" ]; then
        echo "Extracting $RESTORE_FILE to temporary directory..."
        $SUDO mkdir -p /tmp/snapmgr_restore
        $SUDO tar -xzf "$RESTORE_FILE" -C /tmp/snapmgr_restore
        
        if [ -d "/tmp/snapmgr_restore/data" ]; then
            echo "Restoring database data..."
            $SUDO mkdir -p "$INSTALL_BASE_DIR/data"
            $SUDO cp -rT /tmp/snapmgr_restore/data "$INSTALL_BASE_DIR/data"
            $SUDO chown -R $USER:$USER "$INSTALL_BASE_DIR/data"
            echo -e "${GREEN}[OK] Database Data restored.${NC}"
        fi
        
        if [ -f "/tmp/snapmgr_restore/snapserver.conf" ]; then
            echo "Restoring snapserver.conf..."
            $SUDO cp /tmp/snapmgr_restore/snapserver.conf /etc/snapserver.conf
            $SUDO chown snapserver:snapserver /etc/snapserver.conf
            echo -e "${GREEN}[OK] snapserver.conf restored.${NC}"
        fi
        
        $SUDO rm -rf /tmp/snapmgr_restore
    else
        echo -e "${RED}[!] Backup file not found: $RESTORE_FILE${NC}"
    fi
fi

# 5. Configurable Port and Environment File
echo -e "\n${YELLOW}▶ Step 5: Web Interface Configuration...${NC}"

# If port wasn't provided by argument, ask or use default 3000
if [ -z "$APP_PORT" ]; then
    if [ "$AUTO_CONFIRM" = true ]; then
        APP_PORT=3000
        echo -e "Web interface port [Auto-confirmed: $APP_PORT]"
    else
        read -p "Enter the port for the Snapcast Manager web interface [3000]: " USER_PORT
        APP_PORT=${USER_PORT:-3000}
    fi
fi

echo -e "${GREEN}[OK] Interface will be available on port $APP_PORT.${NC}"

# Write the .env file
$SUDO bash -c "cat <<EOF > $INSTALL_BASE_DIR/server/.env
PORT=$APP_PORT
SNAPCAST_MODE=${APP_MODE:-both}
NODE_ENV=production
EOF"

# 6. Systemd Service setup (Task 16: dedicated 'snapmanager' user, sudoers.d,
# systemd sandboxing, and an idempotent migration path for pre-Task-16
# installs that were still running the whole service as $(whoami) -- often
# root). See SECURITY.md's "Privilege model" section and
# .superpowers/sdd/task-16-report.md for the full design and its explicitly
# documented residual risk/real-hardware validation checklist.
echo -e "\n${YELLOW}▶ Step 6: Setting up as a systemd service...${NC}"
if prompt_yes_no "Do you want to install Snapcast Manager as a systemd service?" "y"; then
    INSTALL_DIR="$INSTALL_BASE_DIR"
    UNIT_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
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

    echo -e "${CYAN}Applying privilege-hardening: dedicated '${SNAPMANAGER_USER}' user, sudoers.d, systemd sandboxing (Task 16)...${NC}"

    # --- 6a. Dedicated system user (idempotent: skipped entirely if it already exists) ---
    if ! getent group audio >/dev/null 2>&1; then
        echo "Creating 'audio' group (not present on this host)..."
        $SUDO groupadd audio
    fi
    if ! id -u "$SNAPMANAGER_USER" >/dev/null 2>&1; then
        echo "Creating dedicated system user '$SNAPMANAGER_USER' (system account, no login shell, member of 'audio')..."
        if ! $SUDO useradd --system --no-create-home --shell /usr/sbin/nologin --groups audio "$SNAPMANAGER_USER"; then
            echo -e "${RED}[!] Failed to create the '$SNAPMANAGER_USER' user.${NC}"
            echo "Aborting BEFORE touching the systemd unit or restarting the service -- whatever"
            echo "configuration was already running (if any) has NOT been modified. Fix whatever"
            echo "useradd reported above and re-run this installer."
            exit 1
        fi
        echo -e "${GREEN}[OK] User '$SNAPMANAGER_USER' created.${NC}"
    else
        echo -e "${GREEN}[OK] User '$SNAPMANAGER_USER' already exists.${NC}"
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
        echo "Setting ownership of $INSTALL_BASE_DIR to $SNAPMANAGER_USER:$SNAPMANAGER_USER (this can take a moment)..."
        $SUDO chown -R "$SNAPMANAGER_USER:$SNAPMANAGER_USER" "$INSTALL_BASE_DIR"
    else
        echo -e "${GREEN}[OK] $INSTALL_BASE_DIR already owned by $SNAPMANAGER_USER -- skipping recursive chown.${NC}"
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
            echo -e "${GREEN}[OK] sudoers.d rule installed ($SUDOERS_DEST).${NC}"
        else
            echo -e "${RED}[!] The sudoers file failed 'visudo -c' validation -- NOT installing it.${NC}"
            echo "The service will still be started as '$SNAPMANAGER_USER', but privileged actions"
            echo "(installing packages, controlling snapserver/snapclient/mpd, etc.) will fail with"
            echo "'sudo: a password is required' until this is fixed. This is very likely an"
            echo "installer/packaging bug rather than a host problem -- please report it, then"
            echo "re-run this installer once fixed."
        fi
        rm -f "$TMP_SUDOERS"
    else
        echo -e "${YELLOW}[!] $SUDOERS_SRC not found in this release -- skipping sudoers.d installation.${NC}"
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
            echo -e "${YELLOW}Detected a pre-existing unit without User=$SNAPMANAGER_USER set (this is a pre-Task-16 install, or one whose User= differs) -- migrating.${NC}"
        fi
        if [ "$EXISTING_UNIT_CONTENT" = "$NEW_UNIT_CONTENT" ]; then
            UNIT_CHANGED=false
        else
            UNIT_BACKUP=$(mktemp)
            $SUDO cp "$UNIT_FILE" "$UNIT_BACKUP"
        fi
    fi

    if [ "$UNIT_CHANGED" = false ]; then
        echo -e "${GREEN}[OK] systemd unit already up to date (User=$SNAPMANAGER_USER, hardening directives present) -- no changes, no restart needed.${NC}"
        $SUDO systemctl daemon-reload
        $SUDO systemctl enable "$SERVICE_NAME" 2>/dev/null || true
    else
        echo "$NEW_UNIT_CONTENT" | $SUDO tee "$UNIT_FILE" >/dev/null
        $SUDO systemctl daemon-reload
        $SUDO systemctl enable "$SERVICE_NAME"

        RESTART_OK=false
        if $SUDO systemctl restart "$SERVICE_NAME"; then
            # `systemctl restart` returning 0 only means the start request
            # was accepted, not that the process stayed up -- give it a
            # moment then verify it's actually active before declaring
            # success (Type=simple + Restart=always would otherwise mask a
            # persistent crash-loop, e.g. from a ReadWritePaths omission,
            # as a "successful" restart here).
            sleep 2
            if $SUDO systemctl is-active --quiet "$SERVICE_NAME"; then
                RESTART_OK=true
            fi
        fi

        if [ "$RESTART_OK" = true ]; then
            echo -e "${GREEN}[OK] Service installed and started as user '$SNAPMANAGER_USER'.${NC}"
            [ -n "$UNIT_BACKUP" ] && rm -f "$UNIT_BACKUP"
        else
            echo -e "${RED}[!] Service failed to start (or stay running) with the new hardened configuration.${NC}"
            echo "Checking logs..."
            $SUDO journalctl -u "$SERVICE_NAME" -n 50 --no-pager
            if [ -n "$UNIT_BACKUP" ]; then
                echo -e "${YELLOW}Rolling back to the previous unit file so the service is not left down...${NC}"
                $SUDO cp "$UNIT_BACKUP" "$UNIT_FILE"
                $SUDO systemctl daemon-reload
                if $SUDO systemctl restart "$SERVICE_NAME"; then
                    echo -e "${YELLOW}[!] Rolled back successfully -- the service is running again under its PREVIOUS configuration.${NC}"
                    echo "The privilege-hardening migration did NOT complete. Investigate the error above"
                    echo "(commonly: a missing ReadWritePaths entry, or an unusual node/systemd path) and"
                    echo "re-run this installer -- it is safe to re-run."
                    rm -f "$UNIT_BACKUP" 2>/dev/null || true
                else
                    echo -e "${RED}[!!!] Rollback ALSO failed to start the service. Manual intervention required.${NC}"
                    echo "The previous unit file's content was saved at: $UNIT_BACKUP (left in place, NOT deleted)."
                fi
                exit 1
            else
                echo -e "${RED}[!] No previous unit file existed to roll back to (this was a fresh install). Exiting.${NC}"
                exit 1
            fi
        fi
    fi
fi

# Detect Local IP
LOCAL_IP=$(hostname -I | awk '{print $1}')
if [ -z "$LOCAL_IP" ]; then
    LOCAL_IP="<your-server-ip>"
fi

echo -e "\n${GREEN}${BOLD}🎉 === Installation Complete! === 🎉${NC}"
echo -e "\n${CYAN}Snapcast Manager is now running.${NC}"
echo -e "You can access the manager via the configured port:\n"
echo -e "    ${BOLD}👉 http://${LOCAL_IP}:${APP_PORT} 👈${NC}\n"
echo -e "If this is your first time, the Initial Setup Wizard will greet you."
echo -e "Made with ❤️ by NaturalDevCR.\n"
