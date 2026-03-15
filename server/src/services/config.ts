import fs from 'fs/promises';
import path from 'path';

import { SnapConfigParser, SnapServerConfig } from '../utils/snapConfigParser';

// Default location on Debian
const SNAPSERVER_CONFIG_PATH = '/etc/snapserver.conf';

export class ConfigService {
  
  async readServerConfig(): Promise<string> {
    try {
      await fs.access(SNAPSERVER_CONFIG_PATH);
      return await fs.readFile(SNAPSERVER_CONFIG_PATH, 'utf-8');
    } catch (error) {
     console.warn(`Could not read ${SNAPSERVER_CONFIG_PATH}, returning empty.`);
     return '';
    }
  }

  async readServerConfigParsed(): Promise<SnapServerConfig> {
    const raw = await this.readServerConfig();
    return SnapConfigParser.parse(raw);
  }

  async writeServerConfigParsed(config: SnapServerConfig): Promise<void> {
    const raw = SnapConfigParser.stringify(config);
    await this.writeServerConfig(raw);
  }

  async writeServerConfig(content: string): Promise<void> {
     await fs.writeFile(SNAPSERVER_CONFIG_PATH, content, 'utf-8');
  }

  async setSnapserverDocRoot(docRootPath: string): Promise<void> {
    const config = await this.readServerConfigParsed();
    if (!config.http) config.http = {};
    config.http.doc_root = docRootPath;
    await this.writeServerConfigParsed(config);
  }
}

export const configService = new ConfigService();
