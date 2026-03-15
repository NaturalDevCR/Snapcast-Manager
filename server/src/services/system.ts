import { exec } from 'child_process';
import util from 'util';

const execAsync = util.promisify(exec);

export type PackageName = 'snapserver' | 'snapclient' | 'ffmpeg';

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

  async installPackage(pkg: PackageName): Promise<string> {
    // In a real scenario, this might need sudo or be run as root
    // For now, we assume the process has permissions or we prefix with sudo
    // We also use -y to auto-accept
    return this.runCommand(`sudo apt-get install -y ${pkg}`);
  }

  async uninstallPackage(pkg: PackageName): Promise<string> {
    return this.runCommand(`sudo apt-get remove -y ${pkg}`);
  }

  async isInstalled(pkg: PackageName): Promise<boolean> {
    try {
      await this.runCommand(`dpkg -s ${pkg}`);
      return true;
    } catch (error) {
      return false;
    }
  }

  async getServiceStatus(service: 'snapserver' | 'snapclient'): Promise<string> {
    try {
      const output = await this.runCommand(`systemctl is-active ${service}`);
      return output.trim();
    } catch (error) {
       return 'inactive'; // or 'unknown'
    }
  }
  
  async restartService(service: 'snapserver' | 'snapclient'): Promise<string> {
      return this.runCommand(`sudo systemctl restart ${service}`);
  }

  async startService(service: 'snapserver' | 'snapclient'): Promise<string> {
      return this.runCommand(`sudo systemctl start ${service}`);
  }

  async stopService(service: 'snapserver' | 'snapclient'): Promise<string> {
      return this.runCommand(`sudo systemctl stop ${service}`);
  }

  async enableService(service: 'snapserver' | 'snapclient'): Promise<string> {
      return this.runCommand(`sudo systemctl enable ${service}`);
  }

  async disableService(service: 'snapserver' | 'snapclient'): Promise<string> {
      return this.runCommand(`sudo systemctl disable ${service}`);
  }
}

export const systemService = new SystemService();
