import { exec } from 'child_process';
import util from 'util';
import { configService } from './config';

const execAsync = util.promisify(exec);

export type PackageName = 'snapserver' | 'ffmpeg' | 'shairport-sync' | 'snap-ctrl';

export class SystemService {
  
  private async runCommand(command: string): Promise<string> {
    try {
      console.log(`Executing: ${command}`);
      const { stdout, stderr } = await execAsync(command);
      if (stderr) console.warn(`StdErr: ${stderr}`);
      return stdout;
    } catch (error) {
      console.error(`Error executing ${command}:`, error);
      throw error;
    }
  }

  async installPackage(pkg: string): Promise<string> {
    return this.runCommand(`sudo apt-get update && sudo apt-get install -y ${pkg}`);
  }

  async updatePackage(pkg: string): Promise<string> {
    return this.runCommand(`sudo apt-get update && sudo apt-get install -y --only-upgrade ${pkg}`);
  }

  async uninstallPackage(pkg: string): Promise<string> {
    return this.runCommand(`sudo apt-get remove -y ${pkg}`);
  }

  async isInstalled(pkg: string): Promise<boolean> {
    try {
      if (pkg === 'snap-ctrl') {
          // Check if directory exists and is not empty
          await this.runCommand('[ -d "/usr/share/snapserver/snap-ctrl" ] && [ "$(ls -A /usr/share/snapserver/snap-ctrl)" ]');
          return true;
      }
      await this.runCommand(`dpkg -s ${pkg}`);
      return true;
    } catch (error) {
      return false;
    }
  }

  async getServiceStatus(service: 'snapserver' | 'shairport-sync'): Promise<string> {
    try {
      const output = await this.runCommand(`systemctl is-active ${service}`);
      return output.trim();
    } catch (error) {
       return 'inactive';
    }
  }

  async getServiceLogs(service: 'snapserver' | 'shairport-sync' | 'snapmanager'): Promise<string> {
    try {
        // journalctl -n 100 --no-pager
        const output = await this.runCommand(`sudo journalctl -u ${service} -n 100 --no-pager`);
        return output;
    } catch (error) {
        return 'Failed to retrieve logs';
    }
  }

  async getPackageVersion(pkg: PackageName): Promise<string> {
    try {
      let cmd = '';
      switch (pkg) {
        case 'snapserver':
          cmd = 'snapserver --version 2>&1 | head -n 1';
          break;
        case 'ffmpeg':
          cmd = 'ffmpeg -version 2>&1 | head -n 1';
          break;
        case 'shairport-sync':
          cmd = 'shairport-sync -V 2>&1 | head -n 1';
          break;
        case 'snap-ctrl':
          return 'v1.1.0'; 
      }
      const output = await this.runCommand(cmd);
      // Clean up version string (e.g. "snapserver v0.26.0" -> "v0.26.0")
      const firstLine = output.split('\n')[0].trim();
      const match = firstLine.match(/v?\d+\.\d+\.\d+/);
      return match ? match[0] : firstLine;
    } catch (error) {
       console.error(`Error getting version for ${pkg}:`, error);
      return 'unknown';
    }
  }

  async getLatestAvailableVersion(pkg: PackageName): Promise<string> {
    try {
      if (pkg === 'snap-ctrl') return 'v1.1.0'; // Hardcoded for now
      
      // Use apt-cache policy to get the candidate version
      const output = await this.runCommand(`apt-cache policy ${pkg} | grep Candidate | awk '{print $2}'`);
      const version = output.trim();
      if (!version || version === '(none)') return 'unknown';
      return version;
    } catch (error) {
      console.error(`Error checking latest version for ${pkg}:`, error);
      return 'unknown';
    }
  }
  
  async restartService(service: 'snapserver' | 'shairport-sync'): Promise<string> {
      return this.runCommand(`sudo systemctl restart ${service}`);
  }

  async startService(service: 'snapserver' | 'shairport-sync'): Promise<string> {
      return this.runCommand(`sudo systemctl start ${service}`);
  }

  async stopService(service: 'snapserver' | 'shairport-sync'): Promise<string> {
      return this.runCommand(`sudo systemctl stop ${service}`);
  }

  async enableService(service: 'snapserver' | 'shairport-sync'): Promise<string> {
      return this.runCommand(`sudo systemctl enable ${service}`);
  }

  async disableService(service: 'snapserver' | 'shairport-sync'): Promise<string> {
      return this.runCommand(`sudo systemctl disable ${service}`);
  }

  async installSnapCtrl(): Promise<string> {
      const repo = 'NaturalDevCR/snap-ctrl';
      const apiUrl = `https://api.github.com/repos/${repo}/releases/latest`;
      const installPath = '/usr/share/snapserver/snap-ctrl';
      
      console.log(`Installing snap-ctrl from ${apiUrl}...`);
      
      // Improved robust command using -L for redirects and better grep
      const cmd = `
        mkdir -p /tmp/snap-ctrl-download && \
        cd /tmp/snap-ctrl-download && \
        DOWNLOAD_URL=$(curl -sL ${apiUrl} | grep "browser_download_url" | grep "dist.zip" | head -n 1 | cut -d '"' -f 4) && \
        if [ -z "$DOWNLOAD_URL" ]; then 
            echo "Searching for any zip release...";
            DOWNLOAD_URL=$(curl -sL ${apiUrl} | grep "browser_download_url" | grep ".zip" | head -n 1 | cut -d '"' -f 4);
        fi && \
        if [ -z "$DOWNLOAD_URL" ]; then 
            echo "Fallback to zipball_url"; 
            DOWNLOAD_URL=$(curl -sL ${apiUrl} | grep "zipball_url" | head -n 1 | cut -d '"' -f 4); 
        fi && \
        if [ -z "$DOWNLOAD_URL" ]; then echo "Error: Could not find download URL" && exit 1; fi && \
        echo "Downloading: $DOWNLOAD_URL" && \
        wget --no-check-certificate -qO snap-ctrl.zip "$DOWNLOAD_URL" && \
        sudo mkdir -p ${installPath} && \
        sudo rm -rf ${installPath}/* && \
        sudo unzip -qo snap-ctrl.zip -d ${installPath} && \
        if [ -d "${installPath}/NaturalDevCR-snap-ctrl-"* ]; then
            echo "Flattening zipball directory..."
            sudo mv ${installPath}/NaturalDevCR-snap-ctrl-*/. ${installPath}/
            sudo rm -rf ${installPath}/NaturalDevCR-snap-ctrl-*
        fi && \
        rm -rf /tmp/snap-ctrl-download
      `;
      
      const result = await this.runCommand(cmd);
      
      // Update snapserver config to use this doc_root
      try {
          await configService.setSnapserverDocRoot(installPath);
          await this.restartService('snapserver');
      } catch (err) {
          console.error('Failed to update snapserver config for snap-ctrl:', err);
      }
      
      return result;
  }
}

export const systemService = new SystemService();
