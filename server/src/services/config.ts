import fs from 'fs/promises';
import path from 'path';

import { SnapConfigParser, SnapServerConfig } from '../utils/snapConfigParser';

// Default location on Debian
const SNAPSERVER_CONFIG_PATH = '/etc/snapserver.conf';
const SNAPCLIENT_CONFIG_PATH = '/etc/default/snapclient';

export class ConfigService {
  
  async readServerConfig(): Promise<string> {
    try {
      // Check if file exists
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
    // In production, we might need sudo here via a child process helper if the node process doesn't have permissions
    // For now assuming we have permissions or this is a dev environment
     await fs.writeFile(SNAPSERVER_CONFIG_PATH, content, 'utf-8');
  }

  // Snapclient config in /etc/default/snapclient is usually KEY="Value" pairs
  async readClientConfig(): Promise<Record<string, string>> {
     try {
      await fs.access(SNAPCLIENT_CONFIG_PATH);
      const content = await fs.readFile(SNAPCLIENT_CONFIG_PATH, 'utf-8');
      const lines = content.split('\n');
      const config: Record<string, string> = {};
      
      lines.forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const [key, value] = trimmed.split('=');
          if (key && value) {
            // Remove quotes if present
            config[key] = value.replace(/^"(.*)"$/, '$1');
          }
        }
      });
      return config;
    } catch (error) {
      console.warn(`Could not read ${SNAPCLIENT_CONFIG_PATH}, returning empty.`);
      return {};
    }
  }

  async writeClientConfig(config: Record<string, string>): Promise<void> {
    const lines = Object.entries(config).map(([key, value]) => {
      return `${key}="${value}"`;
    });
    const content = lines.join('\n');
    await fs.writeFile(SNAPCLIENT_CONFIG_PATH, content, 'utf-8');
  }
}

export const configService = new ConfigService();
