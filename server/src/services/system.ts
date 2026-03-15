import { exec } from 'child_process';
import util from 'util';
import { configService } from './config';

const execAsync = util.promisify(exec);

export type PackageName = 'snapserver' | 'ffmpeg' | 'shairport-sync' | 'snap-ctrl' | 'node';

export class SystemService {
  private distroCodename: string | null = null;
  private releaseCache: Record<string, { timestamp: number, data: any }> = {};
  private readonly CACHE_TTL = 60 * 60 * 1000; // 1 hour
  
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

  async updatePackage(pkg: PackageName, clean: boolean = false): Promise<string> {
    if (pkg === 'snap-ctrl') {
      return this.installSnapCtrl();
    }
    
    if (pkg === 'snapserver') {
      return this.updateSnapserverFromGitHub(clean);
    }

    return this.runCommand(`sudo apt-get update && sudo apt-get install -y --only-upgrade ${pkg}`);
  }

  private async getDistroCodename(): Promise<string> {
    if (this.distroCodename) return this.distroCodename;

    try {
      // Try lsb_release first
      const output = await this.runCommand('lsb_release -cs 2>/dev/null');
      this.distroCodename = output.trim();
      if (this.distroCodename) return this.distroCodename;
    } catch (e) {}

    try {
      // Fallback to /etc/os-release
      const output = await this.runCommand('grep VERSION_CODENAME /etc/os-release | cut -d= -f2');
      this.distroCodename = output.trim().replace(/"/g, '');
      if (this.distroCodename) return this.distroCodename;
    } catch (e) {}

    // Ultimate fallback for many debian-based systems if detection fails
    return 'bookworm';
  }

  private async updateSnapserverFromGitHub(clean: boolean = false): Promise<string> {
    const release = await this.getLatestGitHubRelease('badaix', 'snapcast');
    const arch = await this.runCommand('dpkg --print-architecture');
    const archTrimmed = arch.trim();
    const codename = await this.getDistroCodename();
    
    // Find the deb file for the current architecture and distro
    // Example: snapserver_0.35.0-1_amd64_bookworm.deb
    const asset = release.assets.find((a: any) => 
      a.name.startsWith('snapserver') && 
      a.name.endsWith('.deb') && 
      !a.name.includes('pipewire') && // Prefer standard version for now
      a.name.includes(archTrimmed) &&
      (a.name.includes(codename) || (codename === 'bookworm' && !a.name.includes('bullseye') && !a.name.includes('trixie'))) // Heuristic if codename match is literal
    );

    if (!asset) {
      // Fallback: search just by arch if codename specific not found
      const fallbackAsset = release.assets.find((a: any) => 
        a.name.startsWith('snapserver') && a.name.endsWith('.deb') && a.name.includes(archTrimmed)
      );
      
      if (!fallbackAsset) {
        throw new Error(`Could not find a .deb asset for architecture ${archTrimmed} (Distro: ${codename}) in Snapcast release ${release.tag_name}`);
      }
      return this.executeDebUpdate(fallbackAsset.browser_download_url, fallbackAsset.name, clean);
    }
 
    return this.executeDebUpdate(asset.browser_download_url, asset.name, clean);
  }
 
  private async executeDebUpdate(downloadUrl: string, fileName: string, clean: boolean = false): Promise<string> {
    const debFile = `/tmp/${fileName}`;
    console.log(`Downloading Snapserver from ${downloadUrl}... (Clean: ${clean})`);
     
    let cleanCmd = '';
    if (clean) {
      cleanCmd = `
        sudo systemctl stop snapserver || true && \
        sudo dpkg --purge snapserver || true && \
        sudo rm -rf /etc/snapserver.conf /etc/snapserver.conf.base /etc/snapserver.conf.d /var/lib/snapserver && \
      `;
    }

    return this.runCommand(`
      ${cleanCmd}
      sudo apt-get update && \
      wget -qO ${debFile} "${downloadUrl}" && \
      sudo dpkg -i ${debFile} || sudo apt-get install -f -y && \
      rm -f ${debFile} && \
      sudo mkdir -p /var/lib/snapserver && \
      sudo chown -R snapserver:snapserver /var/lib/snapserver && \
      sudo usermod -d /var/lib/snapserver snapserver 2>/dev/null || true && \
      sudo systemctl daemon-reload && \
      sudo systemctl restart snapserver
    `);
  }

  async updateNodeJs(version: string = '20'): Promise<string> {
    console.log(`Updating Node.js to version ${version}...`);
    // Using NodeSource setup script for version specified
    return this.runCommand(`
      curl -fsSL https://deb.nodesource.com/setup_${version}.x | sudo -E bash - && \
      sudo apt-get install -y nodejs
    `);
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
        case 'node':
          cmd = 'node -v';
          break;
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
      if (pkg === 'snap-ctrl') {
        const release = await this.getLatestGitHubRelease('NaturalDevCR', 'snap-ctrl');
        return release.tag_name;
      }

      if (pkg === 'snapserver') {
        const release = await this.getLatestGitHubRelease('badaix', 'snapcast');
        return release.tag_name;
      }

      if (pkg === 'node') {
        // Simple way to get latest LTS version or just assume we follow nodesource 20.x
        return 'v20.x (Latest)'; 
      }
      
      // Use apt-cache policy to get the candidate version for others
      const output = await this.runCommand(`apt-cache policy ${pkg} | grep Candidate | awk '{print $2}'`);
      const version = output.trim();
      if (!version || version === '(none)') return 'unknown';
      return version;
    } catch (error) {
      console.error(`Error checking latest version for ${pkg}:`, error);
      return 'unknown';
    }
  }

  private async getLatestGitHubRelease(owner: string, repo: string): Promise<any> {
    const cacheKey = `${owner}/${repo}`;
    const now = Date.now();
    if (this.releaseCache[cacheKey] && now - this.releaseCache[cacheKey].timestamp < this.CACHE_TTL) {
      return this.releaseCache[cacheKey].data;
    }

    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
    const output = await this.runCommand(`curl -sL ${apiUrl}`);
    const release = JSON.parse(output);
    if (!release.tag_name) {
      throw new Error(`Invalid response from GitHub API for ${owner}/${repo}`);
    }
    
    this.releaseCache[cacheKey] = { timestamp: now, data: release };
    return release;
  }

  async getDashboardMetrics(): Promise<any> {
    const packages: PackageName[] = ['snapserver', 'ffmpeg', 'shairport-sync', 'snap-ctrl', 'node'];
    const services = ['snapserver', 'shairport-sync'] as const;
    
    const installedPromises = packages.map(pkg => this.isInstalled(pkg).then(res => ({ pkg, val: res })));
    const versionPromises = packages.map(pkg => this.getPackageVersion(pkg).then(res => ({ pkg, val: res })));
    const availablePromises = packages.map(pkg => this.getLatestAvailableVersion(pkg).then(res => ({ pkg, val: res })));
    const statusPromises = services.map(svc => this.getServiceStatus(svc).then(res => ({ svc, val: res })));

    const [installedResults, versionResults, availableResults, statusResults] = await Promise.all([
      Promise.all(installedPromises),
      Promise.all(versionPromises),
      Promise.all(availablePromises),
      Promise.all(statusPromises)
    ]);

    return {
      installed: Object.fromEntries(installedResults.map(r => [r.pkg, r.val])),
      versions: Object.fromEntries(versionResults.map(r => [r.pkg, r.val])),
      available: Object.fromEntries(availableResults.map(r => [r.pkg, r.val])),
      statuses: Object.fromEntries(statusResults.map(r => [r.svc, r.val]))
    };
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
      const docRootPath = '/usr/share/snapserver/snap-ctrl/dist';
      
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
          await configService.setSnapserverDocRoot(docRootPath);
          await this.restartService('snapserver');
      } catch (err) {
          console.error('Failed to update snapserver config for snap-ctrl:', err);
      }
      
      return result;
  }
}

export const systemService = new SystemService();
