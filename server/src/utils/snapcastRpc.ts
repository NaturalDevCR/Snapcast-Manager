export class SnapcastRpcError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SnapcastRpcError';
    }
}

export const executeSnapcastRpc = async <T = any>(
    method: string,
    params: any = {},
    port: number = 1780,
    host: string = '127.0.0.1'
): Promise<T> => {
    const requestId = Date.now() + Math.floor(Math.random() * 1000);
    
    const payload = {
        id: requestId,
        jsonrpc: '2.0',
        method,
        params
    };

    try {
        const response = await fetch(`http://${host}:${port}/jsonrpc`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload),
            // Use AbortController for timeout
            signal: AbortSignal.timeout(5000)
        });

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }

        const data: any = await response.json();

        if (data.error) {
            throw new SnapcastRpcError(data.error.message || 'RPC Error');
        }

        return data.result as T;
    } catch (err: any) {
        if (err.name === 'TimeoutError') {
            throw new SnapcastRpcError('Connection timeout to Snapserver RPC over HTTP');
        }
        throw new SnapcastRpcError(`Connection error to Snapserver RPC: ${err.message}`);
    }
};
