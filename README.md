# 🎧 Snapcast Manager

<div align="center">
  <img src="https://github.com/user-attachments/assets/086e14f6-6758-4c12-90d9-f31af71524dd" alt="Logo" width="120">
  
  **A beautiful, modern, and powerful Web Interface to manage, configure, and monitor your Snapcast infrastructure.**

  [![GitHub release (latest by date)](https://img.shields.io/github/v/release/NaturalDevCR/Snapcast-Manager?style=flat-square)](https://github.com/NaturalDevCR/Snapcast-Manager/releases/latest)
  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
  [![Donate](https://img.shields.io/badge/Donate-PayPal-blue.svg?style=flat-square&logo=paypal)](https://www.paypal.com/paypalme/NaturalCloud)
</div>

---

## ✨ Features

Snapcast Manager turns your raw Debian/Ubuntu server or Raspberry Pi into a premium, easy-to-manage multi-room audio hub. 

- 📊 **Real-Time Live Dashboard**: Monitor active audio streams, connected clients, server health, and daemon status instantly via JSON-RPC.
- 🎛️ **Visual Config Editor**: Never edit `snapserver.conf` manually again. Toggle all standard Snapcast properties with visual switches. Defaults are pre-populated!
- 🔌 **Audio Source Management**: Easily add, edit, or remove pipes, tcp streams, alsa inputs, meta streams, and airplay sources.
- 📦 **1-Click Package Manager**: Install, fix, or update `snapserver`, `ffmpeg`, `shairport-sync`, and `Node.js` directly from the web interface.
- 🛡️ **Secure Admin Access**: Setup Wizard and JWT-based authentication to keep your configuration completely safe.
- 📸 **Snapshots (Backups)**: Create instantly restorable backups of your instances, system state, and configurations.
- 🌓 **Premium Dark/Light UI**: Carefully crafted user experience using Vue 3 and Tailwind CSS.
- 📱 **Integrated Player**: One-click install of `snap-ctrl` to provide your users with a sleek material-design volume/zone controller.

---

<img width="500" height="auto" alt="image" src="https://github.com/user-attachments/assets/a9fe0eef-cd9c-41f9-9c63-e64309a55699" />

<img width="500" height="auto" alt="image" src="https://github.com/user-attachments/assets/30ba0850-7181-44bc-b201-e74adbb5c7ec" />

<img width="500" height="auto" alt="image" src="https://github.com/user-attachments/assets/df9b71d8-af84-4726-82a8-563ee4f43ba1" />

<img width="500" height="auto" alt="image" src="https://github.com/user-attachments/assets/186525ea-6fda-4242-a6a8-40a8f3202a35" />

<img width="500" height="auto" alt="image" src="https://github.com/user-attachments/assets/9b2ceb53-68cd-4fc1-9fed-aec10217591d" />

<img width="500" height="auto" alt="image" src="https://github.com/user-attachments/assets/90928d89-339d-4ac4-a91a-4938f907f408" />




## 🚀 Quick Installation (Recommended)

If you are installing on a Raspberry Pi or any Debian/Ubuntu-based Linux server, the absolute easiest method is our one-line automated installer.

### Prerequisites
- Operating System: Linux (Debian, Ubuntu, Raspberry Pi OS).
- *(Snapcast and Node.js will be installed automatically if not detected).*

### Run the Installer

You can install the manager and all its dependencies directly by running this single command in your terminal:

```bash
curl -sL https://raw.githubusercontent.com/NaturalDevCR/Snapcast-Manager/main/scripts/install.sh | bash
```

> **Note:** To skip all interactive prompts and use default settings, add `-s -- -y`:
> `curl -sL https://raw.githubusercontent.com/NaturalDevCR/Snapcast-Manager/main/scripts/install.sh | bash -s -- -y`

### What the script does:
1. Detects your hardware architecture and OS.
2. Prompts to install the latest **Snapserver** tailored for your distribution.
3. Installs **Node.js LTS** if missing.
4. Downloads the pre-compiled, optimized latest release of **Snapcast Manager**.
5. Sets up the application as an auto-starting `systemd` background service (`snapmanager`).

Once finished, just open your browser:
**`http://<YOUR-SERVER-IP>:3000`**

---

## 🛠 Local Development & Execution

Want to modify the code, test new features, or contribute to Snapcast Manager?

1. **Clone & Install Dependencies**
   *Minimum Node.js v20 is required.*
   ```bash
   git clone https://github.com/NaturalDevCR/Snapcast-Manager.git
   cd Snapcast-Manager
   
   # Install Backend
   cd server && npm install
   
   # Install Frontend
   cd ../client && npm install
   ```

2. **Start the Backend server**
   ```bash
   cd server
   npm run dev
   # Runs on port 3000
   ```

3. **Start the Frontend Vue/Vite server**
   ```bash
   cd client
   npm run dev
   # Runs on port 5173 (proxies API requests to 3000 automatically)
   ```

---

## 📦 About Automated Releases

This project utilizes an automated **GitHub Actions** CI/CD workflow. Whenever a new version tag (e.g., `v0.1.26`) is pushed, the workflow automatically:
1. Compiles the TypeScript backend.
2. Builds and minifies the Vue 3 + Vite frontend.
3. Packages everything into an optimized `.zip` artifact.

The `install.sh` script downloads this pre-built artifact, allowing you to install the manager *insanely fast* on small boards like Raspberry Pi without forcing them to compile the code locally.

---

## ❤️ Support & Acknowledgements

Snapcast Manager is built to manage the incredible **[Snapcast](https://github.com/snapcast/snapcast)** project by badaix. A huge thank you to the original creators for building such a robust multi-room audio system.

If you find this manager UI useful, it would mean the world to me if you considered supporting its continued development!

[![Donate via PayPal](https://www.paypalobjects.com/en_US/DK/i/btn/btn_donateCC_LG.gif)](https://www.paypal.com/paypalme/NaturalCloud)

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
