import net from 'net';

export class SnapcastRpcError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SnapcastRpcError';
    }
}

export const executeSnapcastRpc = <T = any>(
    method: string,
    params: any = {},
    port: number = 1705,
    host: string = '127.0.0.1'
): Promise<T> => {
    return new Promise((resolve, reject) => {
        const client = new net.Socket();
        const requestId = Date.now() + Math.floor(Math.random() * 1000);
        
        const payload = JSON.stringify({
            id: requestId,
            jsonrpc: '2.0',
            method,
            params
        }) + '\r\n';

        let buffer = '';

        const cleanup = () => {
            client.removeAllListeners();
            client.destroy();
        };

        client.connect(port, host, () => {
            client.write(payload);
        });

        client.on('data', (data) => {
            buffer += data.toString();
            
            // Snapcast separates JSON messages with \r\n
            let boundary = buffer.indexOf('\n');
            while (boundary !== -1) {
                const line = buffer.slice(0, boundary).trim();
                buffer = buffer.slice(boundary + 1);
                boundary = buffer.indexOf('\n');
                
                if (!line) continue;

                try {
                    const parsed = JSON.parse(line);
                    if (parsed.id === requestId) {
                        cleanup();
                        if (parsed.error) {
                            reject(new SnapcastRpcError(parsed.error.message || 'RPC Error'));
                        } else {
                            resolve(parsed.result as T);
                        }
                        return;
                    }
                } catch (err) {
                    console.warn('Failed to parse JSON-RPC response line:', line);
                }
            }
        });

        client.on('error', (err) => {
            cleanup();
            reject(new SnapcastRpcError(`Connection error to Snapserver RPC: ${err.message}`));
        });

        client.on('timeout', () => {
            cleanup();
            reject(new SnapcastRpcError('Connection timeout to Snapserver RPC'));
        });

        client.setTimeout(5000); // 5 second timeout
    });
};
