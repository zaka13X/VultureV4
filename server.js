const http = require('http');
const https = require('https');
const { URL } = require('url');
const WebSocket = require('ws');

const PORT = process.env.PORT || 10000;
const server = http.createServer((req, res) => {
    // Enable CORS for frontend flexibility
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // Fallback basic HTTP handler for initial payload serving
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Proxy Server Running. Connect via WebSockets.');
});

// Establish the WebSocket Server
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    ws.on('message', async (message) => {
        try {
            const packet = JSON.parse(message);
            
            // Handle standard HTTP requests over WebSocket tunnel
            if (packet.type === 'request') {
                handleTunneledRequest(ws, packet);
            }
        } catch (err) {
            ws.send(JSON.stringify({ type: 'error', message: err.message }));
        }
    });
});

async function handleTunneledRequest(ws, packet) {
    const { id, url, method, headers, body } = packet;
    
    try {
        const targetUrl = new URL(url);
        const options = {
            method: method || 'GET',
            headers: {
                ...headers,
                'Host': targetUrl.host,
                'Origin': targetUrl.origin,
                'Referer': targetUrl.origin + '/'
            }
        };

        const client = targetUrl.protocol === 'https:' ? https : http;
        
        const req = client.request(targetUrl, options, (res) => {
            let chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                const buffer = Buffer.concat(chunks);
                const contentType = res.headers['content-type'] || '';
                let dataPayload;

                // Handle text encoding conversion safely
                if (contentType.includes('text') || contentType.includes('json') || contentType.includes('javascript')) {
                    dataPayload = buffer.toString('utf-8');
                } else {
                    dataPayload = buffer.toString('base64'); // Send binaries as base64
                }

                ws.send(JSON.stringify({
                    type: 'response',
                    id: id,
                    status: res.statusCode,
                    headers: res.headers,
                    body: dataPayload,
                    isBase64: !(contentType.includes('text') || contentType.includes('json') || contentType.includes('javascript'))
                }));
            });
        });

        req.on('error', (err) => {
            ws.send(JSON.stringify({ type: 'response', id, status: 500, body: err.message }));
        });

        if (body) {
            req.write(typeof body === 'object' ? JSON.stringify(body) : body);
        }
        req.end();

    } catch (e) {
        ws.send(JSON.stringify({ type: 'response', id, status: 400, body: 'Invalid Target URL' }));
    }
}

server.listen(PORT, () => {
    console.log(`Proxy server listening on port ${PORT}`);
});
