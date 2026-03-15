import ini from 'ini';

export interface SnapServerConfig {
  [section: string]: {
    [key: string]: string | string[] | boolean | number;
  };
}

export class SnapConfigParser {
  
  static parse(content: string): SnapServerConfig {
    // Custom parsing to handle duplicate keys (specifically 'source' in [stream])
    const lines = content.split('\n');
    const config: SnapServerConfig = {};
    let currentSection = '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#')) continue;

      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        currentSection = trimmed.slice(1, -1);
        config[currentSection] = config[currentSection] || {};
      } else if (currentSection && trimmed.includes('=')) {
        const separatorIndex = trimmed.indexOf('=');
        const key = trimmed.slice(0, separatorIndex).trim();
        let value: string | boolean | number = trimmed.slice(separatorIndex + 1).trim();

        // Convert common types
        if (value === 'true') value = true;
        else if (value === 'false') value = false;
        else if (!isNaN(Number(value)) && value !== '') value = Number(value);

        if (config[currentSection][key] !== undefined) {
           // If key exists, convert to array or push to array
           if (Array.isArray(config[currentSection][key])) {
             (config[currentSection][key] as any[]).push(value);
           } else {
             config[currentSection][key] = [config[currentSection][key] as any, value];
           }
        } else {
          config[currentSection][key] = value;
        }
      }
    }
    return config;
  }

  static stringify(config: SnapServerConfig): string {
    let content = '';
    
    for (const [section, props] of Object.entries(config)) {
      content += `[${section}]\n`;
      
      if (section === 'stream') {
        // Stream section: output non-source properties first, then sources with name comments
        for (const [key, value] of Object.entries(props)) {
          if (key === 'source') continue; // Handle sources after
          if (Array.isArray(value)) {
            for (const item of value) {
              content += `${key} = ${item}\n`;
            }
          } else {
            content += `${key} = ${value}\n`;
          }
        }
        
        // Now output sources with name comments
        const sources = props.source;
        if (sources !== undefined) {
          const sourceList = Array.isArray(sources) ? sources : [sources];
          for (const src of sourceList) {
            const srcStr = String(src);
            const nameMatch = srcStr.match(/[?&]name=([^&]+)/);
            const sourceName = nameMatch ? decodeURIComponent(nameMatch[1]!) : '';
            if (sourceName) {
              content += `# ${sourceName}\n`;
            }
            content += `source = ${srcStr}\n`;
          }
        }
      } else {
        // Standard section handling
        for (const [key, value] of Object.entries(props)) {
          if (Array.isArray(value)) {
            for (const item of value) {
              content += `${key} = ${item}\n`;
            }
          } else {
            content += `${key} = ${value}\n`;
          }
        }
      }
      content += '\n';
    }
    return content;
  }
}
