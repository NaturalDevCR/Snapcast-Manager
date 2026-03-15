#!/bin/bash

# Snapcast Manager - Installer Script
# Designed for Debian/Ubuntu headless servers

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Snapcast Manager Installer ===${NC}"
echo "This script will help you set up Snapcast Manager on your Linux server."

REPO_URL="https://github.com/NaturalDevCR/Snapcast-Manager.git"
INSTALL_BASE_DIR="/opt/snapcast-manager"
SERVICE_NAME="snapmanager"

# Helper to automatically answer "yes" if piped/non-interactive
prompt_yes_no() {
    local prompt="$1"
    local default="$2"
    if [ ! -t 0 ]; then
        echo -e "${prompt} [Auto-answered: ${default}]"
        [[ "$default" == "y" ]]
        return
    fi
    local ans
    read -p "$prompt (y/n): " ans
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
        
        echo "Downloading latest release..."
        sudo rm -rf "$INSTALL_BASE_DIR"
        sudo mkdir -p "$INSTALL_BASE_DIR"
        sudo wget -qO /tmp/snapmanager.zip "https://github.com/NaturalDevCR/Snapcast-Manager/releases/latest/download/snapcast-manager-release.zip"
        
        echo "Extracting release..."
        sudo unzip -qo /tmp/snapmanager.zip -d "$INSTALL_BASE_DIR"
        sudo rm -f /tmp/snapmanager.zip
        sudo chown -R $USER:$USER "$INSTALL_BASE_DIR"
        
        echo -e "${GREEN}Resuming installation from $INSTALL_BASE_DIR...${NC}"
        cd "$INSTALL_BASE_DIR"
        # Re-run the script from the new location so relative paths work
        exec bash scripts/install.sh
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
SNAPCLIENT_INSTALLED=false

if command -v snapserver >/dev/null 2>&1; then
    echo -e "${GREEN}[OK] snapserver detected.${NC}"
    SNAPSERVER_INSTALLED=true
else
    echo -e "${YELLOW}[!] snapserver NOT detected.${NC}"
fi

if command -v snapclient >/dev/null 2>&1; then
    echo -e "${GREEN}[OK] snapclient detected.${NC}"
    SNAPCLIENT_INSTALLED=true
else
    echo -e "${YELLOW}[!] snapclient NOT detected.${NC}"
fi

if [ "$SNAPSERVER_INSTALLED" = false ] && [ "$SNAPCLIENT_INSTALLED" = false ]; then
    if prompt_yes_no "Snapcast components not found. Do you want to install them now?" "y"; then
        echo "Installing Snapcast..."
        sudo apt-get update && sudo apt-get install -y snapserver snapclient
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

if [ ! -d "dist" ]; then
    echo "Building server..."
    npm run build
fi

if [ ! -d "../client/dist" ]; then
    echo "Installing client dependencies..."
    cd ../client && npm install
    echo "Building client..."
    npm run build
    cd ..
else
    echo "Client already built, skipping build step."
    cd ..
fi

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
ExecStart=$(command -v npm) run start
Restart=always

[Install]
WantedBy=multi-user.target
EOF

    sudo systemctl daemon-reload
    sudo systemctl enable $SERVICE_NAME
    sudo systemctl restart $SERVICE_NAME
    echo -e "${GREEN}[OK] Service installed and started.${NC}"
fi

echo -e "\n${GREEN}=== Installation Complete! ===${NC}"
echo "You can now access the manager via the configured port (default 3000)."
echo "Go to http://<your-server-ip>:3000 to start the Initial Setup Wizard."
