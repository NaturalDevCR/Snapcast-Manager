# Snapcast Manager

Web interface to manage and configure your Snapcast server (Snapserver) and its clients (Snapclient).

## Features

- Snapcast client management.
- Network and server scanning and configuration (for clients and administrators).
- Automated installer as a `systemd` service on your Debian/Ubuntu based server.

## 🚀 Quick Installation (Recommended)

If you are installing on a Raspberry Pi or any Linux server (Ubuntu/Debian), the easiest method is to download and run the installation script.

### Prerequisites:

- Operating System: Linux (Debian, Ubuntu, Raspberry Pi OS).
- (Optional) Node.js 20 will be installed automatically if not detected.
- (Optional) Snapcast components will be installed automatically if the installer does not detect them.

### Installation Steps:

**Option 1: One-line Remote Installation (Easiest)**
You can install everything directly by running this single command:

```bash
curl -sL https://raw.githubusercontent.com/NaturalDevCR/Snapcast-Manager/main/scripts/install.sh | bash
```

*Note: If you want to skip all prompts and use defaults, add `-s -- -y` to the bash command:*
```bash
curl -sL https://raw.githubusercontent.com/NaturalDevCR/Snapcast-Manager/main/scripts/install.sh | bash -s -- -y
```

**Option 2: Manual Clone**

1. Clone the repository or download the source code:

   ```bash
   git clone https://github.com/NaturalDevCR/Snapcast-Manager.git
   cd Snapcast-Manager
   ```

2. Run the interactive installation script:

   ```bash
   bash scripts/install.sh
   ```

3. The script will do the following:
   - Check if `snapserver` and `snapclient` are installed and ask if you want to install them.
   - Install Node.js v20 dependencies (if necessary).
   - Install Server (Backend) and Client (Vue/Vite Frontend) dependencies.
   - Automatically build the frontend and backend.
   - Configure and enable the web server to start automatically on boot using **systemd** under the service name `snapmanager`.

4. Done! Access your web manager from the browser:
   ```
   http://<YOUR-SERVER-IP>:3000
   ```
   > Here you can configure your Snapserver and start the setup wizard.

---

## 🛠 Local Development & Execution

If you want to modify the code or contribute:

1. **Install core dependencies:**
   You need [Node.js](https://nodejs.org/) v20 or later.

   ```bash
   # In the root folder
   cd server && npm install
   cd ../client && npm install
   ```

2. **Start the Backend Development Server:**

   ```bash
   cd server
   npm run dev
   ```

3. **Start the Frontend Development Server:**
   ```bash
   cd client
   npm run dev
   ```

The backend server will serve the API on port `3000`, and Vite will typically serve the frontend on port `5173`. Calls to `/api` in the frontend are automatically proxied according to the `vite.config.ts` setup.

---

## 📦 About Releases

This project includes an automated **GitHub Actions** workflow, which is triggered with every version _tag_ `push` (e.g., `v1.0.0`). This action builds both the TypeScript backend and the Vue+Vite frontend, and attaches a packaged `.zip` ready to be downloaded and run with the `install.sh` script, avoiding the need for long compilation times on small boards like the Raspberry Pi.
