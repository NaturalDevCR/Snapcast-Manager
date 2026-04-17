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

VERSION="v0.1.14"
APP_VERSION="$VERSION"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'
INSTALL_BASE_DIR="/opt/snapcast-manager"
SERVICE_NAME="snapmanager"
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
        $SUDO systemctl daemon-reload
        
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

# 6. Systemd Service setup
echo -e "\n${YELLOW}▶ Step 6: Setting up as a systemd service...${NC}"
if prompt_yes_no "Do you want to install Snapcast Manager as a systemd service?" "y"; then
    USER_NAME=$(whoami)
    INSTALL_DIR="$INSTALL_BASE_DIR"
    
    cat <<EOF | $SUDO tee /etc/systemd/system/${SERVICE_NAME}.service
[Unit]
Description=Snapcast Manager Service
After=network.target snapserver.service

[Service]
Type=simple
User=$USER_NAME
WorkingDirectory=$INSTALL_DIR/server
ExecStart=$(command -v node) dist/index.js
Restart=always
EnvironmentFile=$INSTALL_DIR/server/.env

[Install]
WantedBy=multi-user.target
EOF

    $SUDO systemctl daemon-reload
    $SUDO systemctl enable $SERVICE_NAME
    if $SUDO systemctl restart $SERVICE_NAME; then
        echo -e "${GREEN}[OK] Service installed and started.${NC}"
    else
        echo -e "${RED}[!] Service failed to start.${NC}"
        echo "Checking logs..."
        $SUDO journalctl -u $SERVICE_NAME -n 50 --no-pager
        exit 1
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
