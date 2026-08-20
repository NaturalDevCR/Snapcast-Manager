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
        if ! command -v wget >/dev/null 2>&1 || ! command -v unzip >/dev/null 2>&1; then
            echo -e "${YELLOW}Step 0: Checking for essential tools...${NC}"
            if prompt_yes_no "Missing wget or unzip. Install them?" "y"; then
                $SUDO apt-get update
                $SUDO apt-get install -y wget unzip
            else
                echo "Cannot proceed without wget and unzip. Installation aborted."
                exit 1
            fi
        fi
        
        echo "Downloading pre-built release $VERSION..."

        $SUDO rm -rf "$INSTALL_BASE_DIR"
        $SUDO mkdir -p "$INSTALL_BASE_DIR"
        
        # Fetch the download URL for any attached ZIP files in the release
        API_URL="https://api.github.com/repos/NaturalDevCR/Snapcast-Manager/releases/tags/${VERSION}"
        ASSETS=$(curl -sL "$API_URL" | grep "browser_download_url" || true)
        REPO_ZIP_URL=$(echo "$ASSETS" | grep ".zip" | head -n 1 | cut -d '"' -f 4 || true)
        
        $SUDO wget -qO /tmp/snapmanager.zip "$REPO_ZIP_URL" || {
            echo -e "${RED}[!] Pre-built asset $VERSION not found. Falling back to tagged source code...${NC}"
            REPO_ZIP_URL="https://github.com/NaturalDevCR/Snapcast-Manager/archive/refs/tags/${VERSION}.zip"
            $SUDO wget -qO /tmp/snapmanager.zip "$REPO_ZIP_URL"
        }
        
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
    for p in /etc/snapserver.conf /etc/snapserver.conf.base /etc/default/snapclient; do
        if [ ! -e "$p" ]; then
            $SUDO touch "$p"
        fi
        $SUDO chown "$SNAPMANAGER_USER:$SNAPMANAGER_USER" "$p"
    done
    for d in /etc/snapserver.conf.d /etc/snapcast-manager; do
        $SUDO mkdir -p "$d"
        $SUDO chown -R "$SNAPMANAGER_USER:$SNAPMANAGER_USER" "$d"
    done

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
    NEW_UNIT_CONTENT=$(cat <<EOF
[Unit]
Description=Snapcast Manager Service
After=network.target snapserver.service

[Service]
Type=simple
User=$SNAPMANAGER_USER
WorkingDirectory=$INSTALL_DIR/server
ExecStart=$(command -v node) dist/index.js
Restart=always
EnvironmentFile=$INSTALL_DIR/server/.env
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
ReadWritePaths=$INSTALL_BASE_DIR/data $INSTALL_BASE_DIR/server/snapshots /etc/snapserver.conf /etc/snapserver.conf.base /etc/snapserver.conf.d /etc/snapcast-manager /run/snapcast-manager /var/lib/snapcast-manager/scripts /var/backups/snapmanager /etc/mpd.conf /var/lib/mpd /etc/systemd/system /etc/default/snapclient /etc/snapclient-manager /var/lib/snapserver /etc/apt/keyrings /etc/apt/sources.list.d /usr/share/snapserver/snap-ctrl

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
