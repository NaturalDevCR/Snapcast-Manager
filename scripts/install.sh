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
BOLD='\033[1m'
NC='\033[0m' # No Color

VERSION="v0.1.33"

echo -e "${GREEN}${BOLD}=== Snapcast Manager Installer ($VERSION) ===${NC}"
echo -e "This script will help you set up Snapcast Manager.\n"

# Application Configuration
APP_DIR="/opt/snapcast-manager"
REPO_URL="https://github.com/NaturalDevCR/Snapcast-Manager.git"
NODE_VERSION="20"
VERSION="v0.1.34"

# Colors for output
GREEN='\033[0;32m'
INSTALL_BASE_DIR="/opt/snapcast-manager"
SERVICE_NAME="snapmanager"

# Parse arguments
AUTO_CONFIRM=false
RESTORE_FILE=""
APP_PORT=""

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
        *)
            shift
            ;;
    esac
done

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

# 0. Check if we need to download the source
if [[ ! -d "server" ]] || [[ ! -d "client" ]]; then
    # Remote install flow
    echo -e "\n${YELLOW}Project files not found in current directory.${NC}"
    echo "It looks like you are running this script remotely."
    
    # Check if already installed
    if [ -d "$INSTALL_BASE_DIR" ]; then
        echo -e "${YELLOW}Snapcast Manager is already installed at $INSTALL_BASE_DIR.${NC}"
        if prompt_yes_no "Do you want to RE-INSTALL and OVERWRITE the existing installation?" "y"; then
            echo "Stopping existing service..."
            sudo systemctl stop $SERVICE_NAME 2>/dev/null || true
            sudo systemctl disable $SERVICE_NAME 2>/dev/null || true
            
            echo "Checking for database data in $INSTALL_BASE_DIR/data..."
            if [ -d "$INSTALL_BASE_DIR/data" ]; then
                # Check if there are actually files inside
                if [ "$(ls -A $INSTALL_BASE_DIR/data)" ]; then
                    echo -e "${YELLOW}Detected existing database files. Backing up...${NC}"
                    sudo rm -rf /tmp/snapmgr_data_backup
                    sudo cp -r "$INSTALL_BASE_DIR/data" /tmp/snapmgr_data_backup
                    if [ -d "/tmp/snapmgr_data_backup" ]; then
                        echo -e "${GREEN}[OK] Database backed up to /tmp/snapmgr_data_backup${NC}"
                    else
                        echo -e "${RED}[!] Failed to create backup! Proceeding without backup.${NC}"
                    fi
                else
                    echo "Data directory is empty, skipping backup."
                fi
            else
                echo "No data directory found at $INSTALL_BASE_DIR/data."
            fi
            
            if [ -f "/etc/snapserver.conf" ]; then
                echo -e "${YELLOW}Detected existing snapserver.conf. Backing up...${NC}"
                sudo cp /etc/snapserver.conf /tmp/snapserver_conf_backup
            fi
            
            echo "Removing existing files..."
            sudo rm -rf "$INSTALL_BASE_DIR"
        else
            echo "Installation aborted."
            exit 0
        fi
    fi

    if prompt_yes_no "Do you want to download and install to $INSTALL_BASE_DIR?" "y"; then
        echo "Updating package list and ensuring wget and unzip are installed..."
        sudo apt-get update >/dev/null 2>&1
        sudo apt-get install -y wget unzip >/dev/null 2>&1
        
        echo "Downloading pre-built release $VERSION..."
        sudo rm -rf "$INSTALL_BASE_DIR"
        sudo mkdir -p "$INSTALL_BASE_DIR"
        sudo wget -qO /tmp/snapmanager.zip "$REPO_ZIP_URL" || {
            echo -e "${RED}[!] Release $VERSION not found. Falling back to source code...${NC}"
            REPO_ZIP_URL="https://github.com/NaturalDevCR/Snapcast-Manager/archive/refs/heads/main.zip"
            sudo wget -qO /tmp/snapmanager.zip "$REPO_ZIP_URL"
        }
        
        echo "Extracting source..."
        TEMP_EXTRACT="/tmp/snapmgr_extract"
        sudo rm -rf "$TEMP_EXTRACT"
        sudo mkdir -p "$TEMP_EXTRACT"
        sudo unzip -qo /tmp/snapmanager.zip -d "$TEMP_EXTRACT"
        
        # Move contents to INSTALL_BASE_DIR. Note: source zip has a root folder, release zip does not.
        if [ -d $TEMP_EXTRACT/Snapcast-Manager-* ]; then
            ROOT_FOLDER=$(ls -d $TEMP_EXTRACT/Snapcast-Manager-*)
            sudo cp -r $ROOT_FOLDER/. "$INSTALL_BASE_DIR/"
            # Create flag to force rebuild since this is source code
            sudo touch "$INSTALL_BASE_DIR/.rebuilding"
        else
            sudo cp -r $TEMP_EXTRACT/. "$INSTALL_BASE_DIR/"
        fi
        
        sudo rm -rf "$TEMP_EXTRACT"
        sudo rm -f /tmp/snapmanager.zip

        # (Flag handled above)

        # Restore database if backup exists
        if [ -d "/tmp/snapmgr_data_backup" ] || [ -f "/tmp/snapserver_conf_backup" ]; then
            echo -e "${YELLOW}Existing database or configuration found.${NC}"
            if prompt_yes_no "Do you want to restore your existing authentication and settings?" "y"; then
                if [ -d "/tmp/snapmgr_data_backup" ]; then
                    echo "Restoring database data..."
                    sudo mkdir -p "$INSTALL_BASE_DIR/data"
                    sudo cp -rT /tmp/snapmgr_data_backup "$INSTALL_BASE_DIR/data"
                    echo -e "${GREEN}[OK] Database Data restored.${NC}"
                fi
                if [ -f "/tmp/snapserver_conf_backup" ]; then
                    echo "Restoring snapserver.conf..."
                    sudo cp /tmp/snapserver_conf_backup /etc/snapserver.conf
                    echo -e "${GREEN}[OK] snapserver.conf restored.${NC}"
                fi
            fi
            sudo rm -rf /tmp/snapmgr_data_backup
            sudo rm -f /tmp/snapserver_conf_backup
        fi
        
        sudo chown -R $USER:$USER "$INSTALL_BASE_DIR"
        
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

# 2. Check for Snapcast
echo -e "\n${YELLOW}Step 1: Checking for Snapcast...${NC}"

install_latest_snapserver() {
    echo "Fetching latest Snapserver from GitHub..."
    local arch=$(dpkg --print-architecture)
    local codename=$(lsb_release -cs 2>/dev/null || grep VERSION_CODENAME /etc/os-release | cut -d= -f2 | sed 's/"//g')
    [ -z "$codename" ] && codename="bookworm"
    
    local api_url="https://api.github.com/repos/snapcast/snapcast/releases/latest"
    local assets=$(curl -sL "$api_url" | grep "browser_download_url")
    
    # Try to find exact match: arch + codename, excluding pipewire
    local download_url=$(echo "$assets" | grep "$arch" | grep "$codename" | grep ".deb" | grep -v "pipewire" | head -n 1 | cut -d '"' -f 4)
    
    # Fallback to arch only if codename match fails
    if [ -z "$download_url" ]; then
        echo "No exact distro match found, falling back to architecture match..."
        download_url=$(echo "$assets" | grep "$arch" | grep ".deb" | grep -v "pipewire" | head -n 1 | cut -d '"' -f 4)
    fi

    if [ -z "$download_url" ]; then
        echo -e "${RED}[!] Could not find a suitable Snapserver release on GitHub. Falling back to apt.${NC}"
        sudo apt-get install -y snapserver
        return
    fi

    local deb_file="/tmp/snapserver_latest.deb"
    echo "Downloading: $(basename "$download_url")"
    sudo wget -qO "$deb_file" "$download_url"
    sudo dpkg -i "$deb_file" || sudo apt-get install -f -y
    sudo rm -f "$deb_file"
    
    # CRITICAL: Fix permission/home directory issue
    echo "Applying system configuration fixes..."
    sudo mkdir -p /var/lib/snapserver
    sudo chown -R snapserver:snapserver /var/lib/snapserver
    # Ensure snapserver user has /var/lib/snapserver as HOME
    sudo usermod -d /var/lib/snapserver snapserver 2>/dev/null || true
    
    sudo systemctl daemon-reload
    sudo systemctl restart snapserver || echo -e "${YELLOW}[!] Warning: Snapserver failed to start. You may need to check logs.${NC}"
}

SNAPSERVER_INSTALLED=false
if command -v snapserver >/dev/null 2>&1; then
    echo -e "${GREEN}[OK] snapserver detected.${NC}"
    SNAPSERVER_INSTALLED=true
fi

if [ "$SNAPSERVER_INSTALLED" = false ]; then
    if prompt_yes_no "Snapserver not found. Do you want to install it from GitHub (Recommended)?" "y"; then
        sudo apt-get update
        sudo apt-get install -y curl wget ffmpeg lsb-release
        install_latest_snapserver
    fi
else
    # Even if installed, we might want to ensure permissions are correct if running this script
    sudo mkdir -p /var/lib/snapserver
    sudo chown -R snapserver:snapserver /var/lib/snapserver
    sudo usermod -d /var/lib/snapserver snapserver 2>/dev/null || true
fi

# 2.5 Check for Build Essentials (for native modules like better-sqlite3)
echo -e "\n${YELLOW}Step 2.5: Checking for build tools...${NC}"
if ! command -v make >/dev/null 2>&1; then
    echo -e "${YELLOW}[!] Build tools (make/gcc) not detected.${NC}"
    if prompt_yes_no "Install build-essential? (Highly recommended for database performance)" "y"; then
        sudo apt-get update && sudo apt-get install -y build-essential
    fi
fi

# 3. Check for Node.js
echo -e "\n${YELLOW}Step 2: Checking for Node.js...${NC}"
if command -v node >/dev/null 2>&1; then
    NODE_VER=$(node -v)
    echo -e "${GREEN}[OK] Node.js $NODE_VER detected.${NC}"
else
    echo -e "${RED}[!] Node.js not detected.${NC}"
    if prompt_yes_no "Install Node.js 20?" "y"; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
        sudo apt-get install -y nodejs
    else
        echo "Installation aborted."
        exit 1
    fi
fi

# 4. Install Dependencies & Build
echo -e "\n${YELLOW}Step 3: Installing dependencies and building project...${NC}"

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
        sudo mkdir -p /tmp/snapmgr_restore
        sudo tar -xzf "$RESTORE_FILE" -C /tmp/snapmgr_restore
        
        if [ -d "/tmp/snapmgr_restore/data" ]; then
            echo "Restoring database data..."
            sudo mkdir -p "$INSTALL_BASE_DIR/data"
            sudo cp -rT /tmp/snapmgr_restore/data "$INSTALL_BASE_DIR/data"
            sudo chown -R $USER:$USER "$INSTALL_BASE_DIR/data"
            echo -e "${GREEN}[OK] Database Data restored.${NC}"
        fi
        
        if [ -f "/tmp/snapmgr_restore/snapserver.conf" ]; then
            echo "Restoring snapserver.conf..."
            sudo cp /tmp/snapmgr_restore/snapserver.conf /etc/snapserver.conf
            sudo chown snapserver:snapserver /etc/snapserver.conf
            echo -e "${GREEN}[OK] snapserver.conf restored.${NC}"
        fi
        
        sudo rm -rf /tmp/snapmgr_restore
    else
        echo -e "${RED}[!] Backup file not found: $RESTORE_FILE${NC}"
    fi
fi

# 5. Configurable Port and Environment File
echo -e "\n${YELLOW}▶ Step 4: Web Interface Configuration...${NC}"

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
sudo bash -c "cat <<EOF > $INSTALL_BASE_DIR/server/.env
PORT=$APP_PORT
EOF"

# 6. Systemd Service setup
echo -e "\n${YELLOW}▶ Step 5: Setting up as a systemd service...${NC}"
if prompt_yes_no "Do you want to install Snapcast Manager as a systemd service?" "y"; then
    USER_NAME=$(whoami)
    INSTALL_DIR="$INSTALL_BASE_DIR"
    
    cat <<EOF | sudo tee /etc/systemd/system/${SERVICE_NAME}.service
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

    sudo systemctl daemon-reload
    sudo systemctl enable $SERVICE_NAME
    if sudo systemctl restart $SERVICE_NAME; then
        echo -e "${GREEN}[OK] Service installed and started.${NC}"
    else
        echo -e "${RED}[!] Service failed to start.${NC}"
        echo "Checking logs..."
        sudo journalctl -u $SERVICE_NAME -n 50 --no-pager
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
