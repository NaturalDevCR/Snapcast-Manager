import { exec } from 'child_process';
import util from 'util';

const execAsync = util.promisify(exec);

export type PackageName = 'snapserver' | 'ffmpeg' | 'shairport-sync';

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
          await this.runCommand('ls /usr/share/snapserver/snap-ctrl/index.html');
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
      
      const cmd = `
        mkdir -p /tmp/snap-ctrl-download && \
        cd /tmp/snap-ctrl-download && \
        DOWNLOAD_URL=$(curl -s ${apiUrl} | grep "browser_download_url" | grep "dist.zip" | cut -d '"' -f 4) && \
        if [ -z "$DOWNLOAD_URL" ]; then echo "Fallback to source zip"; DOWNLOAD_URL=$(curl -s ${apiUrl} | grep "zipball_url" | cut -d '"' -f 4); fi && \
        wget -qO snap-ctrl.zip "$DOWNLOAD_URL" && \
        sudo mkdir -p ${installPath} && \
        sudo unzip -qo snap-ctrl.zip -d ${installPath} && \
        rm -rf /tmp/snap-ctrl-download
      `;
      
      return this.runCommand(cmd);
  }
}

export const systemService = new SystemService();
