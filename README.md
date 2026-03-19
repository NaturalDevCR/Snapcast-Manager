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

- 🕸️ **Interactive Audio Matrix**: A stunning drag-and-drop interface to route Virtual Sources to Output Zones with real-time visual "cable" animations.
- 🔊 **Full Snapclient Management**: Install and run multiple `snapclient` instances on the same machine, each tied to a specific ALSA audio output.
- 📦 **UI-Driven Package Manager**: Install, update, or uninstall `snapserver` and `snapclient` directly from the web interface. No terminal required!
- 🎛️ **Visual Config Editor**: Never edit `snapserver.conf` manually again. Toggle all standard Snapcast properties with visual switches. Defaults are pre-populated!
- 🔌 **Audio Source Management**: Easily add, edit, or remove pipes, tcp streams, alsa inputs, meta streams, and airplay sources.
- 🛡️ **Secure Admin Access**: Setup Wizard and JWT-based authentication to keep your configuration completely safe.
- 📸 **Snapshots (Backups)**: Create instantly restorable backups of your instances, system state, and configurations.
- 🌓 **Premium Dark/Light UI**: Carefully crafted user experience using Vue 3 and Tailwind CSS, optimized for both desktop and mobile.

---

<img width="400" height="auto" alt="image" src="https://github.com/user-attachments/assets/a9fe0eef-cd9c-41f9-9c63-e64309a55699" />

<img width="400" height="auto" alt="image" src="https://github.com/user-attachments/assets/30ba0850-7181-44bc-b201-e74adbb5c7ec" />

<img width="400" height="auto" alt="image" src="https://github.com/user-attachments/assets/df9b71d8-af84-4726-82a8-563ee4f43ba1" />

<img width="400" height="auto" alt="image" src="https://github.com/user-attachments/assets/186525ea-6fda-4242-a6a8-40a8f3202a35" />

<img width="400" height="auto" alt="image" src="https://github.com/user-attachments/assets/56507eb1-51e4-4af5-80c2-0911e74c0dd6" />

<img width="400" height="auto" alt="image" src="https://github.com/user-attachments/assets/90928d89-339d-4ac4-a91a-4938f907f408" />




## 🚀 Quick Installation (Recommended)

Our standalone installer is lightweight and focuses on setting up the manager safely. Once the manager is running, you can manage the rest of your Snapcast infrastructure from the UI.

### Prerequisites
- Operating System: Linux (Debian, Ubuntu, Raspberry Pi OS).
- Root or sudo privileges.

### Run the Installer

Copy and paste the following command into your terminal:

```bash
curl -sL https://raw.githubusercontent.com/NaturalDevCR/Snapcast-Manager/main/scripts/install.sh | bash
```

> **Note:** To skip all interactive prompts and use default settings, add `-y`:
> `curl -sL https://raw.githubusercontent.com/NaturalDevCR/Snapcast-Manager/main/scripts/install.sh | bash -s -- -y`

### What the script does:
1. Explains the installation process and requests user consent.
2. Detects your hardware architecture and OS.
3. Installs **Node.js 22** and essential tools (`ffmpeg`, `curl`, etc.) if missing.
4. Downloads and installs the latest **Snapcast Manager** service.
5. Provides an easy **Uninstall** option if you ever need to remove it.

Once finished, just open your browser:
**`http://<YOUR-SERVER-IP>:3000`**

---

## 🛠 Local Development

To contribute or test new features locally:

1. **Clone & Install Dependencies**
   *Minimum Node.js v22 is recommended.*
   ```bash
   git clone https://github.com/NaturalDevCR/Snapcast-Manager.git
   cd Snapcast-Manager
   
   # Install Backend
   cd server && npm install
   
   # Install Frontend
   cd ../client && npm install
   ```

2. **Start Development Servers**
   - **Backend**: `cd server && npm run dev` (Port 3000)
   - **Frontend**: `cd client && npm run dev` (Port 5173, proxies to 3000)

---

## 📦 Automated Releases

This project utilizes **GitHub Actions**. Every release is automatically packaged into an optimized `.zip` artifact containing:
- Compiled TypeScript backend.
- Minified and optimized Vue 3 + Vite frontend assets.

This ensures that installation on low-resource devices like the Raspberry Pi Zero is *insanely fast*, as no local compilation is required.

---

## ❤️ Support & Acknowledgements

Snapcast Manager is built to manage the incredible **[Snapcast](https://github.com/snapcast/snapcast)** project by badaix. 

If you find this project useful, please consider supporting its development!

[![Donate via PayPal](https://www.paypalobjects.com/en_US/DK/i/btn/btn_donateCC_LG.gif)](https://www.paypal.com/paypalme/NaturalCloud)

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
