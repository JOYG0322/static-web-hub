const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 9009;

const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    if (req.url === '/ping') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('pong');
        return;
    }

    const downloadMatch = req.url.match(/^\/download\/(\d+)$/);
    if (downloadMatch) {
        let sizeMB = parseInt(downloadMatch[1]);
        if (sizeMB > 100) sizeMB = 100;
        
        const size = sizeMB * 1024 * 1024;
        res.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Content-Length': size,
            'Cache-Control': 'no-store'
        });

        const chunk = Buffer.alloc(1024 * 1024, 0x41);
        for (let i = 0; i < sizeMB; i++) {
            res.write(chunk);
        }
        res.end();
        return;
    }

    if (req.url === '/upload' && req.method === 'POST') {
        let size = 0;
        req.on('data', chunk => {
            size += chunk.length;
        });
        req.on('end', () => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, size }));
        });
        return;
    }

    res.writeHead(404);
    res.end('Not Found');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            data.ts = Date.now();
            ws.send(JSON.stringify(data));
        } catch (e) {
            ws.send(message);
        }
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`NetGauge Server running on http://0.0.0.0:${PORT}`);
    console.log('Endpoints:');
    console.log('  GET  /ping         - Latency test');
    console.log('  GET  /download/N   - Download test (N=1-100 MB)');
    console.log('  POST /upload       - Upload test');
    console.log('  WS   /ws           - Packet loss test');
});
