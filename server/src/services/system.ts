import { exec } from 'child_process';
import util from 'util';
import { configService } from './config';
import { snapclientInstanceService } from './snapclientInstances';
import { backupService, BackupComponent } from './backup';
import { jobService } from './jobs';

const execAsync = util.promisify(exec);

// Builds (e.g. shairport-sync) produce far more than the 1 MB default maxBuffer
const EXEC_OPTS = { maxBuffer: 50 * 1024 * 1024 };

export type PackageName = 'snapserver' | 'snapclient' | 'ffmpeg' | 'shairport-sync' | 'snap-ctrl' | 'node' | 'mpd';

function normalizeVersion(raw: string | undefined | null): string {
  if (!raw) return 'unknown';
  const trimmed = raw.trim().replace(/^["']|["']$/g, '');
  const m = trimmed.match(/v?(\d+\.\d+\.\d+(?:[-+][\w.]+)?)/i);
  if (!m) return 'unknown';
  return `v${m[1]}`;
}

/**
 * Maps an /etc/os-release (ID, VERSION_ID) to the myMPD openSUSE Build Service
 * (OBS) repository directory. Returns null for distros myMPD doesn't publish for.
 * Debian/Raspbian use the major version; Ubuntu uses the full VERSION_ID.
 * Raspberry Pi OS reports ID=debian, which maps to Debian_<major> (armhf/arm64
 * builds live there).
 */
export function mympdObsRepoDir(id: string, versionId: string): string | null {
  const norm = (id || '').trim().toLowerCase();
  const version = (versionId || '').trim();
  const major = version.split('.')[0];
  if (!major) return null;
  if (norm === 'debian') return `Debian_${major}`;
  if (norm === 'raspbian') return `Raspbian_${major}`;
  if (norm === 'ubuntu') return `xUbuntu_${version}`;
  return null;
}

export class SystemService {
  private distroCodename: string | null = null;
  private releaseCache: Record<string, { timestamp: number, data: any }> = {};
  private readonly CACHE_TTL = 60 * 60 * 1000; // 1 hour

  // Installed packages and versions only change through install/update actions,
  // so cache them and let the dashboard poll cheaply (statuses stay live).
  private pkgCache: { timestamp: number; installed: any; versions: any; available: any } | null = null;
  private readonly PKG_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  invalidatePackageCache(): void {
    this.pkgCache = null;
  }

  /** Returns 'sudo ' when not root, or '' when already root (e.g. on bare Debian). */
  private get SUDO(): string {
    return (process as any).getuid?.() === 0 ? '' : 'sudo ';
  }

  private async runCommand(command: string): Promise<string> {
    try {
      console.log(`Executing: ${command}`);
      jobService.log(`$ ${command.trim().split('\n')[0]}`);
      const { stdout, stderr } = await execAsync(command, EXEC_OPTS);
      if (stderr) console.warn(`StdErr: ${stderr}`);
      const tail = stdout.trim().split('\n').slice(-10);
      for (const line of tail) jobService.log(line);
      return stdout;
    } catch (error) {
      console.error(`Error executing ${command}:`, error);
      jobService.log(`ERROR: ${(error as any)?.message || error}`);
      throw error;
    }
  }

  private async safeBackup(component: BackupComponent): Promise<string> {
    try {
      const result = await backupService.createPreUpdateBackup(component);
      if (result.path) {
        console.log(`[system] Pre-${component} backup: ${result.path}`);
        return result.path;
      }
      console.log(`[system] No files to back up for ${component}`);
      return '';
    } catch (err: any) {
      console.error(`[system] Backup before ${component} failed:`, err.message || err);
      return '';
    }
  }

  async installPackage(pkg: string): Promise<string> {
    this.invalidatePackageCache();
    await this.safeBackup(this.mapToComponent(pkg));
    if (pkg === 'shairport-sync') {
      return this.installShairportSync();
    }
    if (pkg === 'snapclient') {
      return this.updateSnapclientFromGitHub(false);
    }
    if (pkg === 'snapserver') {
      return this.updateSnapserverFromGitHub(false);
    }
    if (pkg === 'mpd') {
      return this.installMpd();
    }
    return this.runCommand(`${this.SUDO}apt-get update && ${this.SUDO}apt-get install -y ${pkg}`);
  }

  private mapToComponent(pkg: string): BackupComponent {
    if (pkg === 'snapserver' || pkg === 'snapclient' || pkg === 'snap-ctrl') return pkg;
    if (pkg === 'shairport-sync' || pkg === 'mpd' || pkg === 'ffmpeg' || pkg === 'node') return pkg;
    return 'general';
  }

  private async installMpd(): Promise<string> {
    const cmd = `
      ${this.SUDO}apt-get update && \
      ${this.SUDO}apt-get install -y mpd && \
      ${this.SUDO}systemctl stop mpd.socket 2>/dev/null || true && \
      ${this.SUDO}systemctl disable mpd.socket 2>/dev/null || true && \
      ${this.SUDO}systemctl unmask mpd.service 2>/dev/null || true && \
      ${this.SUDO}systemctl enable mpd.service && \
      ${this.SUDO}systemctl restart mpd.service && \
      echo "MPD installed and started successfully."
    `;
    return this.runCommand(cmd);
  }

  async updatePackage(pkg: PackageName, clean: boolean = false): Promise<string> {
    this.invalidatePackageCache();
    if (pkg !== 'snap-ctrl') {
      await this.safeBackup(this.mapToComponent(pkg));
    }
    if (pkg === 'snap-ctrl') {
      return this.installSnapCtrl();
    }

    if (pkg === 'shairport-sync') {
      return this.installShairportSync();
    }

    if (pkg === 'snapserver') {
      return this.updateSnapserverFromGitHub(clean);
    }

    if (pkg === 'snapclient') {
      return this.updateSnapclientFromGitHub(clean);
    }

    return this.runCommand(`${this.SUDO}apt-get update && ${this.SUDO}apt-get install -y --only-upgrade ${pkg}`);
  }

  async uninstallPackage(pkg: string): Promise<string> {
    this.invalidatePackageCache();
    await this.safeBackup(this.mapToComponent(pkg));
    if (pkg === 'snapclient') {
      const cmd = `
        ${this.SUDO}systemctl stop snapclient 2>/dev/null || true && \
        ${this.SUDO}systemctl disable snapclient 2>/dev/null || true && \
        ${this.SUDO}dpkg --purge snapclient && \
        echo "snapclient removed successfully."
      `;
      return this.runCommand(cmd);
    }
    if (pkg === 'shairport-sync') {
      const cmd = `
        echo "Stopping and disabling services..." && \
        ${this.SUDO}systemctl stop shairport-sync 2>/dev/null || true && \
        ${this.SUDO}systemctl disable shairport-sync 2>/dev/null || true && \
        ${this.SUDO}systemctl stop nqptp 2>/dev/null || true && \
        ${this.SUDO}systemctl disable nqptp 2>/dev/null || true && \
        echo "Removing binaries and service files..." && \
        ${this.SUDO}rm -f /usr/local/bin/shairport-sync /usr/local/bin/nqptp && \
        ${this.SUDO}rm -f /etc/systemd/system/shairport-sync.service /etc/systemd/system/nqptp.service && \
        ${this.SUDO}systemctl daemon-reload && \
        echo "Shairport-sync and nqptp removed successfully."
      `;
      return this.runCommand(cmd);
    }
    if (pkg === 'mpd') {
      const cmd = `
        ${this.SUDO}systemctl stop mpd.socket 2>/dev/null || true && \
        ${this.SUDO}systemctl disable mpd.socket 2>/dev/null || true && \
        ${this.SUDO}systemctl stop mpd.service 2>/dev/null || true && \
        ${this.SUDO}systemctl disable mpd.service 2>/dev/null || true && \
        ${this.SUDO}apt-get remove --purge -y mpd && \
        echo "MPD removed successfully."
      `;
      return this.runCommand(cmd);
    }
    return this.runCommand(`${this.SUDO}apt-get remove --purge -y ${pkg}`);
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

  private async updateSnapclientFromGitHub(clean: boolean = false): Promise<string> {
    const release = await this.getLatestGitHubRelease('badaix', 'snapcast');
    const arch = await this.runCommand('dpkg --print-architecture');
    const archTrimmed = arch.trim();
    const codename = await this.getDistroCodename();

    const asset = release.assets.find((a: any) =>
      a.name.startsWith('snapclient') &&
      a.name.endsWith('.deb') &&
      !a.name.includes('pipewire') &&
      a.name.includes(archTrimmed) &&
      (a.name.includes(codename) || (codename === 'bookworm' && !a.name.includes('bullseye') && !a.name.includes('trixie')))
    );

    if (!asset) {
      const fallbackAsset = release.assets.find((a: any) =>
        a.name.startsWith('snapclient') && a.name.endsWith('.deb') && a.name.includes(archTrimmed)
      );
      if (!fallbackAsset) {
        throw new Error(`Could not find a snapclient .deb asset for architecture ${archTrimmed} (Distro: ${codename}) in Snapcast release ${release.tag_name}`);
      }
      const result = await this.executeDebUpdate(fallbackAsset.browser_download_url, fallbackAsset.name, clean, 'snapclient');
      await this.postSnapclientInstall();
      return result;
    }

    const result = await this.executeDebUpdate(asset.browser_download_url, asset.name, clean, 'snapclient');
    await this.postSnapclientInstall();
    return result;
  }

  private async postSnapclientInstall(): Promise<void> {
    // Stop and disable the default package service — we manage our own instances
    await this.runCommand(`${this.SUDO}systemctl stop snapclient 2>/dev/null || true`).catch(() => {});
    await this.runCommand(`${this.SUDO}systemctl disable snapclient 2>/dev/null || true`).catch(() => {});
    // Disable the default package service; we manage per-instance services ourselves
    await snapclientInstanceService.postInstallSetup();
  }

  private async executeDebUpdate(downloadUrl: string, fileName: string, clean: boolean = false, pkg: 'snapserver' | 'snapclient' = 'snapserver'): Promise<string> {
    const debFile = `/tmp/${fileName}`;
    console.log(`Downloading ${pkg} from ${downloadUrl}... (Clean: ${clean})`);

    let cleanCmd = '';
    if (clean) {
      if (pkg === 'snapclient') {
        cleanCmd = `
          ${this.SUDO}systemctl stop snapclient || true && \
          ${this.SUDO}dpkg --purge snapclient || true && \
          ${this.SUDO}rm -f /etc/default/snapclient && \
        `;
      } else {
        cleanCmd = `
          ${this.SUDO}systemctl stop snapserver || true && \
          ${this.SUDO}dpkg --purge snapserver || true && \
          ${this.SUDO}rm -rf /etc/snapserver.conf /etc/snapserver.conf.base /etc/snapserver.conf.d /var/lib/snapserver && \
        `;
      }
    }

    const postInstallCmd = pkg === 'snapclient'
      ? `${this.SUDO}systemctl daemon-reload && ${this.SUDO}systemctl restart snapclient`
      : `${this.SUDO}mkdir -p /var/lib/snapserver && \
      ${this.SUDO}chown -R snapserver:snapserver /var/lib/snapserver && \
      ${this.SUDO}usermod -d /var/lib/snapserver snapserver 2>/dev/null || true && \
      ${this.SUDO}systemctl daemon-reload && \
      ${this.SUDO}systemctl restart snapserver`;

    const dpkgFlags = '--force-confdef --force-confold';

    return this.runCommand(`
      ${cleanCmd}
      ${this.SUDO}apt-get update && \
      wget -qO ${debFile} "${downloadUrl}" && \
      (${this.SUDO}dpkg -i ${dpkgFlags} ${debFile} 2>&1 || ${this.SUDO}DEBIAN_FRONTEND=noninteractive apt-get install -f -y -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold") && \
      rm -f ${debFile} && \
      ${postInstallCmd}
    `);
  }

  async updateNodeJs(version: string = '22'): Promise<string> {
    if (!/^\d{1,2}$/.test(version)) {
      throw new Error('Invalid Node.js major version');
    }
    this.invalidatePackageCache();
    console.log(`Updating Node.js to version ${version}...`);
    const pipeCmd = this.SUDO ? 'sudo -E bash -' : 'bash -';
    return this.runCommand(`
      curl -fsSL https://deb.nodesource.com/setup_${version}.x | ${pipeCmd} && \
      ${this.SUDO}apt-get install -y nodejs
    `);
  }


  async isInstalled(pkg: string): Promise<boolean> {
    try {
      if (pkg === 'snap-ctrl') {
          // Check if directory exists and is not empty
          await execAsync('[ -d "/usr/share/snapserver/snap-ctrl" ] && [ "$(ls -A /usr/share/snapserver/snap-ctrl)" ]');
          return true;
      }
      if (pkg === 'shairport-sync') {
          try {
              await execAsync('[ -f /usr/local/bin/shairport-sync ] || command -v shairport-sync');
              return true;
          } catch (e) {
              return false;
          }
      }
      if (pkg === 'node') {
          await execAsync('node -v');
          return true;
      }
      await execAsync(`dpkg -s ${pkg}`);
      return true;
    } catch (error) {
      return false;
    }
  }

  async getServiceStatus(service: 'snapserver' | 'snapclient' | 'shairport-sync' | 'mpd'): Promise<string> {
    try {
      const { stdout } = await execAsync(`systemctl is-active ${service}`);
      return stdout.trim();
    } catch (error: any) {
       // systemctl is-active returns non-zero when inactive/failed
       if (error.stdout) return error.stdout.trim();
       return 'inactive';
    }
  }

  async getServiceLogs(service: 'snapserver' | 'snapclient' | 'shairport-sync' | 'snapmanager' | 'librespot' | 'mpd'): Promise<string> {
    try {
        const cmd = `${this.SUDO}journalctl -u ${service} -n 100 --no-pager`;
        const output = await this.runCommand(cmd);
        return output;
    } catch (error: any) {
        console.error(`[getServiceLogs] Failed for ${service}:`, error.message || error);
        // Attempt without sudo as a fallback
        try {
            const output = await this.runCommand(`journalctl -u ${service} -n 100 --no-pager`);
            return output;
        } catch (fallbackError: any) {
            return `Failed to retrieve logs:\\n${error.message || error}\\nFallback error:\\n${fallbackError.message || fallbackError}`;
        }
    }
  }

  async getPackageVersion(pkg: PackageName): Promise<string> {
    try {
      let cmd = '';
      switch (pkg) {
        case 'snapserver':
          cmd = 'snapserver --version 2>&1 | head -n 1';
          break;
        case 'snapclient':
          cmd = 'snapclient --version 2>&1 | head -n 1';
          break;
        case 'ffmpeg':
          cmd = 'ffmpeg -version 2>&1 | head -n 1';
          break;
        case 'shairport-sync':
          cmd = 'if [ -f /usr/local/bin/shairport-sync ]; then /usr/local/bin/shairport-sync -V 2>&1 | head -n 1; else shairport-sync -V 2>&1 | head -n 1; fi';
          break;
        case 'snap-ctrl':
          try {
              // Preferred: the release tag we record at install time (current
              // releases are pre-built dist zips with no package.json).
              const { stdout: marker } = await execAsync('cat /usr/share/snapserver/snap-ctrl/.snap-ctrl-version 2>/dev/null || true');
              if (marker.trim()) return normalizeVersion(marker);
              // Fallback for older installs that shipped a package.json.
              const { stdout } = await execAsync('cat /usr/share/snapserver/snap-ctrl/package.json 2>/dev/null | grep -m1 \'"version"\' || true');
              const match = stdout.match(/"version"\s*:\s*"([^"]+)"/);
              return normalizeVersion(match?.[1]);
          } catch (e) {
              return 'unknown';
          }
        case 'node':
          cmd = 'node -v';
          break;
        case 'mpd':
          cmd = 'mpd --version 2>&1 | head -n 1';
          break;
      }
      const { stdout } = await execAsync(cmd);
      // Clean up version string (e.g. "snapserver v0.26.0" -> "v0.26.0")
      const firstLine = stdout.split('\n')[0].trim();
      const match = firstLine.match(/v?\d+\.\d+\.\d+/);
      return match ? match[0] : firstLine;
    } catch (error) {
      return 'unknown';
    }
  }

  async getLatestAvailableVersion(pkg: PackageName): Promise<string> {
    try {
      if (pkg === 'snap-ctrl') {
        const release = await this.getLatestGitHubRelease('NaturalDevCR', 'snap-ctrl');
        return normalizeVersion(release.tag_name);
      }

      if (pkg === 'snapserver' || pkg === 'snapclient') {
        const release = await this.getLatestGitHubRelease('badaix', 'snapcast');
        return release.tag_name;
      }

      if (pkg === 'shairport-sync') {
        const release = await this.getLatestGitHubRelease('mikebrady', 'shairport-sync');
        return release.tag_name;
      }

      if (pkg === 'node') {
        // We follow the nodesource LTS line used by the installer
        return 'v22.x (Latest)';
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
    const packages: PackageName[] = ['snapserver', 'snapclient', 'ffmpeg', 'shairport-sync', 'snap-ctrl', 'node', 'mpd'];
    const services = ['snapserver', 'snapclient', 'shairport-sync', 'mpd'] as const;

    const statusPromise = Promise.all(
      services.map(svc => this.getServiceStatus(svc).then(res => ({ svc, val: res })))
    );

    let pkgData = this.pkgCache && Date.now() - this.pkgCache.timestamp < this.PKG_CACHE_TTL
      ? this.pkgCache
      : null;

    if (!pkgData) {
      const [installedResults, versionResults, availableResults] = await Promise.all([
        Promise.all(packages.map(pkg => this.isInstalled(pkg).then(res => ({ pkg, val: res })))),
        Promise.all(packages.map(pkg => this.getPackageVersion(pkg).then(res => ({ pkg, val: res })))),
        Promise.all(packages.map(pkg => this.getLatestAvailableVersion(pkg).then(res => ({ pkg, val: res })))),
      ]);
      pkgData = {
        timestamp: Date.now(),
        installed: Object.fromEntries(installedResults.map(r => [r.pkg, r.val])),
        versions: Object.fromEntries(versionResults.map(r => [r.pkg, r.val])),
        available: Object.fromEntries(availableResults.map(r => [r.pkg, r.val])),
      };
      this.pkgCache = pkgData;
    }

    const statusResults = await statusPromise;

    return {
      installed: pkgData.installed,
      versions: pkgData.versions,
      available: pkgData.available,
      statuses: Object.fromEntries(statusResults.map(r => [r.svc, r.val]))
    };
  }

  async restartService(service: 'snapserver' | 'snapclient' | 'shairport-sync' | 'librespot' | 'mpd'): Promise<string> {
      return this.runCommand(`${this.SUDO}systemctl restart ${service}`);
  }

  async startService(service: 'snapserver' | 'snapclient' | 'shairport-sync' | 'librespot' | 'mpd'): Promise<string> {
      return this.runCommand(`${this.SUDO}systemctl start ${service}`);
  }

  async stopService(service: 'snapserver' | 'snapclient' | 'shairport-sync' | 'librespot' | 'mpd'): Promise<string> {
      return this.runCommand(`${this.SUDO}systemctl stop ${service}`);
  }

  async enableService(service: 'snapserver' | 'snapclient' | 'shairport-sync' | 'librespot' | 'mpd'): Promise<string> {
      return this.runCommand(`${this.SUDO}systemctl enable ${service}`);
  }

  async disableService(service: 'snapserver' | 'snapclient' | 'shairport-sync' | 'librespot' | 'mpd'): Promise<string> {
      return this.runCommand(`${this.SUDO}systemctl disable ${service}`);
  }

  async installShairportSync(): Promise<string> {
      console.log('Installing shairport-sync and nqptp from source... (AirPlay 2)');
      const cmd = `
        echo "Installing build dependencies..." && \
        ${this.SUDO}apt-get update && \
        (${this.SUDO}apt-get install -y --no-install-recommends systemd-dev 2>/dev/null || true) && \
        ${this.SUDO}apt-get install -y --no-install-recommends build-essential git autoconf automake libtool \
          libpopt-dev libconfig-dev libasound2-dev avahi-daemon libavahi-client-dev \
          libssl-dev libsoxr-dev libplist-dev libsodium-dev uuid-dev libgcrypt-dev xxd \
          libplist-utils libavutil-dev libavcodec-dev libavformat-dev && \
        echo "Cleaning up absolute legacy installations..." && \
        ${this.SUDO}apt-get remove --purge -y shairport-sync 2>/dev/null || true && \
        ${this.SUDO}systemctl stop shairport-sync 2>/dev/null || true && \
        ${this.SUDO}systemctl disable shairport-sync 2>/dev/null || true && \
        ${this.SUDO}systemctl stop nqptp 2>/dev/null || true && \
        ${this.SUDO}systemctl disable nqptp 2>/dev/null || true && \
        ${this.SUDO}rm -f /usr/local/bin/shairport-sync /usr/bin/shairport-sync /usr/local/bin/nqptp /usr/bin/nqptp && \
        ${this.SUDO}rm -f /etc/systemd/system/shairport-sync.service /etc/systemd/system/nqptp.service && \
        ${this.SUDO}rm -f /lib/systemd/system/shairport-sync.service /lib/systemd/system/nqptp.service && \

        echo "Building and installing nqptp..." && \
        rm -rf /tmp/nqptp-build && \
        git clone https://github.com/mikebrady/nqptp.git /tmp/nqptp-build && \
        cd /tmp/nqptp-build && \
        autoreconf -fvi && \
        ./configure --with-systemd-startup && \
        make -j$(nproc) && \
        ${this.SUDO}make install && \
        ${this.SUDO}systemctl daemon-reload && \
        ${this.SUDO}systemctl enable nqptp && \
        ${this.SUDO}systemctl restart nqptp && \

        echo "Building and installing shairport-sync..." && \
        rm -rf /tmp/shairport-sync-build && \
        git clone https://github.com/mikebrady/shairport-sync.git /tmp/shairport-sync-build && \
        cd /tmp/shairport-sync-build && \
        autoreconf -fvi && \
        ./configure --sysconfdir=/etc --with-alsa --with-soxr --with-avahi --with-ssl=openssl --with-systemd-startup --with-airplay-2 --with-metadata && \
        make -j$(nproc) && \
        ${this.SUDO}make install && \

        echo "Setting up systemd service and user access..." && \
        if ! getent group "shairport-sync" >/dev/null 2>&1; then \
          ${this.SUDO}groupadd -r shairport-sync || true; \
        fi && \
        if ! id "shairport-sync" >/dev/null 2>&1; then \
          ${this.SUDO}useradd -r -M -g shairport-sync -s /usr/sbin/nologin -G audio shairport-sync || true; \
        fi && \

        ${this.SUDO}systemctl daemon-reload && \
        ${this.SUDO}systemctl enable shairport-sync && \
        ${this.SUDO}systemctl restart shairport-sync && \
        echo "Shairport-sync and nqptp installed successfully."
      `;
      return this.runCommand(cmd);
  }

  async installSnapCtrl(): Promise<string> {
      this.invalidatePackageCache();
      await this.safeBackup('snap-ctrl');
      const repo = 'NaturalDevCR/snap-ctrl';
      const apiUrl = `https://api.github.com/repos/${repo}/releases/latest`;
      const installPath = '/usr/share/snapserver/snap-ctrl';
      const docRootPath = '/usr/share/snapserver/snap-ctrl/dist';

      console.log(`Installing snap-ctrl from ${apiUrl}...`);

      // snap-ctrl releases ship pre-built frontend zips (dist.zip / dist-ha.zip),
      // each containing a top-level dist/ folder and NO package.json. We pick the
      // standalone dist.zip, locate the built dist/index.html, install it to
      // installPath/dist (which is the doc_root), and record the release tag in a
      // marker file so the version can be reported afterwards.
      const cmd = `
        set -e
        EXTRACT_DIR=/tmp/snap-ctrl-extract
        rm -rf /tmp/snap-ctrl-download $EXTRACT_DIR && \
        mkdir -p /tmp/snap-ctrl-download $EXTRACT_DIR && \
        cd /tmp/snap-ctrl-download && \
        API_JSON=$(curl -sL -H 'Accept: application/vnd.github+json' ${apiUrl}) && \
        DOWNLOAD_URL=$(printf '%s' "$API_JSON" | python3 -c "import json,sys;d=json.load(sys.stdin);z=[a for a in d.get('assets',[]) if a.get('name','').lower().endswith('.zip')];exact=[a['browser_download_url'] for a in z if a.get('name','').lower()=='dist.zip'];noha=[a['browser_download_url'] for a in z if 'ha' not in a.get('name','').lower()];print(exact[0] if exact else (noha[0] if noha else (z[0]['browser_download_url'] if z else '')))") && \
        TAG=$(printf '%s' "$API_JSON" | python3 -c "import json,sys;print(json.load(sys.stdin).get('tag_name',''))") && \
        if [ -z "$DOWNLOAD_URL" ]; then
            echo "No release .zip asset found, falling back to zipball_url";
            DOWNLOAD_URL=$(printf '%s' "$API_JSON" | python3 -c "import json,sys;d=json.load(sys.stdin); print(d.get('zipball_url',''))");
        fi && \
        if [ -z "$DOWNLOAD_URL" ]; then echo "Error: Could not find download URL" && exit 1; fi && \
        echo "Downloading snap-ctrl $TAG: $DOWNLOAD_URL" && \
        wget --no-check-certificate -qO snap-ctrl.zip "$DOWNLOAD_URL" && \
        unzip -qo snap-ctrl.zip -d $EXTRACT_DIR && \
        INDEX=$(find $EXTRACT_DIR -type f -name index.html -path '*/dist/*' -print -quit) && \
        if [ -z "$INDEX" ]; then INDEX=$(find $EXTRACT_DIR -type f -name index.html -print -quit); fi && \
        if [ -z "$INDEX" ]; then echo "Error: no built index.html found in snap-ctrl archive" && exit 1; fi && \
        DIST_DIR=$(dirname "$INDEX") && \
        echo "Found built interface at: $DIST_DIR" && \
        ${this.SUDO}mkdir -p ${installPath} && \
        ${this.SUDO}rm -rf ${installPath}/* ${installPath}/.[!.]* 2>/dev/null || true && \
        ${this.SUDO}mkdir -p ${docRootPath} && \
        ${this.SUDO}cp -rT "$DIST_DIR" ${docRootPath} && \
        printf '%s' "$TAG" | ${this.SUDO}tee ${installPath}/.snap-ctrl-version >/dev/null && \
        rm -rf /tmp/snap-ctrl-download $EXTRACT_DIR
      `;

      const result = await this.runCommand(cmd);

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
