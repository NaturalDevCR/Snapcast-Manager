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
    read -p "Snapcast components not found. Do you want to install them now? (y/n): " INSTALL_SNAP
    if [[ "$INSTALL_SNAP" == "y"* ]]; then
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
    read -p "Install Node.js 20? (y/n): " INSTALL_NODE
    if [[ "$INSTALL_NODE" == "y"* ]]; then
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
echo "Installing client dependencies..."
cd ../client && npm install
echo "Building client..."
npm run build

# 5. Systemd Service setup
echo -e "\n${YELLOW}Step 4: Setting up as a systemd service...${NC}"
read -p "Do you want to install Snapcast Manager as a systemd service? (y/n): " INSTALL_SERVICE
if [[ "$INSTALL_SERVICE" == "y"* ]]; then
    USER_NAME=$(whoami)
    INSTALL_DIR=$(pwd | xargs dirname)
    
    cat <<EOF | sudo tee /etc/systemd/system/snapmanager.service
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
    sudo systemctl enable snapmanager
    sudo systemctl start snapmanager
    echo -e "${GREEN}[OK] Service installed and started.${NC}"
fi

echo -e "\n${GREEN}=== Installation Complete! ===${NC}"
echo "You can now access the manager via the configured port (default 3000)."
echo "Go to http://<your-server-ip>:3000 to start the Initial Setup Wizard."
