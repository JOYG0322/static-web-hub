// ===============================
// 基础依赖
// ===============================
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const os = require('os');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);

// POST body 解析（用于上传带宽）
app.use(express.raw({ type: '*/*', limit: '200mb' }));

// ===============================
// 1. WebSocket Echo Server（丢包/延迟）
// ===============================
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
    ws.on('message', (msg) => {
        // 直接原样返回，实现 Echo
        ws.send(msg);
    });
});

// ===============================
// 2. 下载带宽测试文件（10MB）
// ===============================
const TEST_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const testBuffer = crypto.randomBytes(TEST_FILE_SIZE);

app.get('/download.bin', (req, res) => {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', TEST_FILE_SIZE);
    res.send(testBuffer);
});

// ===============================
// 3. 上传带宽测试
// ===============================
app.post('/upload', (req, res) => {
    // 丢弃上传数据即可
    const size = req.body.length;
    res.json({ received: size });
});

// ===============================
// 4. 获取服务器 IP（IPv4 + IPv6）
// ===============================
app.get('/ip', (req, res) => {
    const nets = os.networkInterfaces();
    const results = { ipv4: [], ipv6: [] };

    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (!net.internal) {
                if (net.family === 'IPv4') results.ipv4.push(net.address);
                if (net.family === 'IPv6') results.ipv6.push(net.address);
            }
        }
    }

    res.json(results);
});

// ===============================
// 5. 健康检查
// ===============================
app.get('/health', (req, res) => {
    res.json({ status: 'ok', time: Date.now() });
});

// ===============================
// 服务器启动
// ===============================
const PORT = 8080;

server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`WebSocket Echo: ws://localhost:${PORT}/ws`);
});
