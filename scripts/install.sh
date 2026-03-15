#!/bin/bash

# Snapcast Manager - Installer Script
# Designed for Debian/Ubuntu headless servers

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

VERSION="v0.1.6"

echo -e "${GREEN}=== Snapcast Manager Installer ($VERSION) ===${NC}"
echo "This script will help you set up Snapcast Manager on your Linux server."

REPO_ZIP_URL="https://github.com/NaturalDevCR/Snapcast-Manager/archive/refs/heads/main.zip"
INSTALL_BASE_DIR="/opt/snapcast-manager"
SERVICE_NAME="snapmanager"

# Parse arguments
AUTO_CONFIRM=false
for arg in "$@"; do
    case $arg in
        -y|--yes)
            AUTO_CONFIRM=true
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
        
        echo "Downloading latest source from main branch..."
        sudo rm -rf "$INSTALL_BASE_DIR"
        sudo mkdir -p "$INSTALL_BASE_DIR"
        sudo wget -qO /tmp/snapmanager.zip "$REPO_ZIP_URL"
        
        echo "Extracting source..."
        TEMP_EXTRACT="/tmp/snapmgr_extract"
        sudo rm -rf "$TEMP_EXTRACT"
        sudo mkdir -p "$TEMP_EXTRACT"
        sudo unzip -qo /tmp/snapmanager.zip -d "$TEMP_EXTRACT"
        
        # Move contents from the root folder (Snapcast-Manager-main) to INSTALL_BASE_DIR
        ROOT_FOLDER=$(ls -d $TEMP_EXTRACT/Snapcast-Manager-*)
        sudo cp -r $ROOT_FOLDER/. "$INSTALL_BASE_DIR/"
        
        sudo rm -rf "$TEMP_EXTRACT"
        sudo rm -f /tmp/snapmanager.zip

        # Create flag to force rebuild
        sudo touch "$INSTALL_BASE_DIR/.rebuilding"

        # Restore database if backup exists
        if [ -d "/tmp/snapmgr_data_backup" ]; then
            echo -e "${YELLOW}Existing database found.${NC}"
            if prompt_yes_no "Do you want to restore your existing authentication and settings?" "y"; then
                echo "Restoring database data..."
                sudo mkdir -p "$INSTALL_BASE_DIR/data"
                sudo cp -rT /tmp/snapmgr_data_backup "$INSTALL_BASE_DIR/data"
                echo -e "${GREEN}[OK] Data restored.${NC}"
            fi
            sudo rm -rf /tmp/snapmgr_data_backup
        fi
        
        sudo chown -R $USER:$USER "$INSTALL_BASE_DIR"
        
        echo -e "${GREEN}Resuming installation from $INSTALL_BASE_DIR...${NC}"
        cd "$INSTALL_BASE_DIR"
        # Re-run the script from the new location so relative paths work
        # Pass -y if it was used initially
        if [ "$AUTO_CONFIRM" = true ]; then
            exec bash scripts/install.sh -y
        else
            exec bash scripts/install.sh
        fi
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
SNAPSERVER_INSTALLED=false

if command -v snapserver >/dev/null 2>&1; then
    echo -e "${GREEN}[OK] snapserver detected.${NC}"
    SNAPSERVER_INSTALLED=true
else
    echo -e "${YELLOW}[!] snapserver NOT detected.${NC}"
fi

if [ "$SNAPSERVER_INSTALLED" = false ]; then
    if prompt_yes_no "Snapserver not found. Do you want to install it now?" "y"; then
        echo "Installing Snapserver and FFmpeg..."
        sudo apt-get update && sudo apt-get install -y snapserver ffmpeg
    fi
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
echo "Installing server dependencies..."
cd server && npm install

if [ ! -d "dist" ] || [ -f "../.rebuilding" ]; then
    echo "Building server..."
    npm run build
fi

# Always rebuild client if DIST doesn't exist or if we want to ensure latest UI
if [ ! -d "../client/dist" ] || [ -f "../.rebuilding" ]; then
    echo "Installing client dependencies..."
    cd ../client && npm install
    echo "Building client..."
    npm run build
    cd ..
else
    echo "Client already built, skipping build step."
    cd ..
fi

# Clean up re-run flag
rm -f .rebuilding

# 5. Systemd Service setup
echo -e "\n${YELLOW}Step 4: Setting up as a systemd service...${NC}"
if prompt_yes_no "Do you want to install Snapcast Manager as a systemd service?" "y"; then
    USER_NAME=$(whoami)
    INSTALL_DIR=$(pwd)
    
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

echo -e "\n${GREEN}=== Installation Complete! ===${NC}"
echo "You can now access the manager via the configured port (default 3000)."
echo "Go to http://<your-server-ip>:3000 to start the Initial Setup Wizard."
