import net from 'net';

export class MpdService {
  private host: string;
  private port: number;

  constructor(host = '127.0.0.1', port = 6600) {
    this.host = host;
    this.port = port;
  }

  /**
   * Envía un comando a MPD y retorna la respuesta procesada.
   */
  private sendCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const client = net.createConnection({ host: this.host, port: this.port }, () => {
        client.write(`${command}\n`);
      });

      let responseData = '';

      client.on('data', (data) => {
        responseData += data.toString();
        
        // Verifica si la respuesta ha terminado
        if (responseData.includes('OK\n') || responseData.includes('ACK')) {
          client.end();
        }
      });

      client.on('end', () => {
        resolve(responseData.trim());
      });

      client.on('error', (err) => {
        reject(new Error(`Failed to connect to MPD: ${err.message}`));
      });
      
      // Timeout guard
      setTimeout(() => {
          client.end();
          reject(new Error('MPD connection timed out'));
      }, 3000);
    });
  }

  /**
   * Parsea la respuesta en formato Key: Value de MPD a un objeto JSON.
   */
  private parseResponse(response: string): Record<string, string> {
    const result: Record<string, string> = {};
    const lines = response.split('\n');

    for (const line of lines) {
      if (line === 'OK' || line.startsWith('ACK')) continue;
      const index = line.indexOf(': ');
      if (index !== -1) {
        const key = line.substring(0, index).trim().toLowerCase();
        const value = line.substring(index + 2).trim();
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Obtiene el estado actual de MPD y la canción en reproducción.
   */
  async getStatus(): Promise<any> {
    try {
      // Pedimos status y después currentsong
      // Con sendCommand podríamos enviar varios comandos si los agrupamos con command_list?
      // Es más seguro enviar uno a uno o usar command_list_begin / command_list_end
      
      const statusRaw = await this.sendCommand('status');
      const currentSongRaw = await this.sendCommand('currentsong');
      
      const status = this.parseResponse(statusRaw);
      const currentSong = this.parseResponse(currentSongRaw);

      if (statusRaw.startsWith('ACK')) {
          throw new Error(`MPD Error: ${statusRaw}`);
      }

      return {
        state: status.state || 'unknown',
        volume: status.volume || '0',
        repeat: status.repeat === '1',
        random: status.random === '1',
        single: status.single === '1',
        consume: status.consume === '1',
        playlistLength: status.playlistlength || '0',
        songId: status.songid || null,
        elapsed: status.elapsed || '0',
        duration: status.duration || '0',
        currentSong: {
            title: currentSong.title || 'Unknown Title',
            artist: currentSong.artist || 'Unknown Artist',
            album: currentSong.album || '',
            file: currentSong.file || '',
            duration: currentSong.duration || '0'
        }
      };
    } catch (errMessage: any) {
        console.error('MpdService Error:', errMessage);
        return { state: 'offline', error: errMessage.message };
    }
  }

  /**
   * Controla la reproducción de MPD.
   */
  async control(action: 'play' | 'pause' | 'stop' | 'next' | 'previous'): Promise<string> {
    const okActions = ['play', 'pause', 'stop', 'next', 'previous'];
    if (!okActions.includes(action)) {
        throw new Error(`Invalid MPD action: ${action}`);
    }
    
    // Command can be play/pause/stop/next/previous
    const response = await this.sendCommand(action);
    if (response.startsWith('ACK')) {
        throw new Error(`MPD Error: ${response}`);
    }
    return response; // Debería ser 'OK'
  }
}

export const mpdService = new MpdService();
