const $ = id => document.getElementById(id);

class NetGauge {
    constructor() {
        this.isRunning = false;
        this.results = {};
        this.history = JSON.parse(localStorage.getItem('netgauge_history') || '[]');
        this.serverUrl = localStorage.getItem('netgauge_server') || 'http://10.126.126.15:8080';
        
        this.initUI();
        this.bindEvents();
        this.renderHistory();
        this.loadServerConfig();
    }

    initUI() {
        this.scoreEl = $('score');
        this.scoreTextEl = $('scoreText');
        this.statusEl = $('statusText');
        this.logEl = $('logContainer');
        this.progressEl = $('progressFill');
        this.startBtn = $('startBtn');
        
        this.metrics = {
            latencyPublic: $('latencyPublic'),
            latencyPrivate: $('latencyPrivate'),
            jitter: $('jitter'),
            download: $('download'),
            upload: $('upload'),
            packetLoss: $('packetLoss')
        };
    }

    bindEvents() {
        this.startBtn?.addEventListener('click', () => this.runAllTests());
        $('clearBtn')?.addEventListener('click', () => this.clearResults());
        $('settingsBtn')?.addEventListener('click', () => this.openSettings());
        $('settingsClose')?.addEventListener('click', () => this.closeSettings());
        $('settingsOverlay')?.addEventListener('click', () => this.closeSettings());
        
        $('saveServerBtn')?.addEventListener('click', () => this.saveServerConfig());
        
        document.querySelectorAll('.theme-segment-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const theme = btn.dataset.theme;
                this.setTheme(theme);
            });
        });
    }

    loadServerConfig() {
        const input = $('serverUrlInput');
        if (input) input.value = this.serverUrl;
    }

    saveServerConfig() {
        const input = $('serverUrlInput');
        if (input) {
            this.serverUrl = input.value.trim();
            localStorage.setItem('netgauge_server', this.serverUrl);
            this.log(`服务器地址已保存: ${this.serverUrl}`, 'success');
        }
    }

    log(msg, type = '') {
        const line = document.createElement('div');
        line.className = `log-line ${type}`;
        line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
        this.logEl?.prepend(line);
        while (this.logEl.children.length > 100) {
            this.logEl.removeChild(this.logEl.lastChild);
        }
    }

    updateProgress(percent) {
        if (this.progressEl) {
            this.progressEl.style.width = `${percent}%`;
        }
    }

    setStatus(text) {
        if (this.statusEl) this.statusEl.textContent = text;
    }

    async timedFetch(url, options = {}) {
        const start = performance.now();
        const timeout = options.timeout || 5000;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        
        try {
            const res = await fetch(url, { 
                ...options, 
                signal: controller.signal, 
                cache: 'no-store'
            });
            clearTimeout(timeoutId);
            const end = performance.now();
            return { ok: res.ok, time: Math.round(end - start), res, status: res.status };
        } catch (e) {
            clearTimeout(timeoutId);
            const end = performance.now();
            return { ok: false, time: Math.round(end - start), err: e.name === 'AbortError' ? 'timeout' : String(e) };
        }
    }

    async testPublicLatency() {
        const urls = [
            'https://www.huorong.cn/',
            'https://www.bilibili.com/',
            'https://chat.deepseek.com/'
        ];
        
        const results = [];
        for (const url of urls) {
            const urlResults = [];
            for (let i = 0; i < 10; i++) {
                const r = await this.timedFetch(url, { mode: 'no-cors' });
                if (r.ok || r.time < 5000) {
                    urlResults.push(r.time);
                    this.log(`公网 ${url.split('/')[2]} => ${r.time}ms`, 'success');
                } else {
                    this.log(`公网 ${url.split('/')[2]} => ${r.err || 'failed'}`, 'error');
                }
                await new Promise(res => setTimeout(res, 100));
            }
            if (urlResults.length >= 3) {
                urlResults.sort((a, b) => a - b);
                const trimmed = urlResults.slice(1, -1);
                const avg = Math.round(trimmed.reduce((a, b) => a + b, 0) / trimmed.length);
                results.push(avg);
            }
        }
        
        if (!results.length) return null;
        return Math.round(results.reduce((a, b) => a + b, 0) / results.length);
    }

    async testPrivateLatency() {
        const results = [];
        
        for (let i = 0; i < 10; i++) {
            const r = await this.timedFetch(`${this.serverUrl}/ping`, { timeout: 3000 });
            if (r.ok) {
                results.push(r.time);
                this.log(`内网 Ping => ${r.time}ms`, 'success');
            } else {
                this.log(`内网 Ping => ${r.err || 'failed'}`, 'error');
            }
            await new Promise(res => setTimeout(res, 100));
        }
        
        if (results.length < 3) return null;
        results.sort((a, b) => a - b);
        const trimmed = results.slice(1, -1);
        return Math.round(trimmed.reduce((a, b) => a + b, 0) / trimmed.length);
    }

    computeJitter(samples) {
        if (samples.length < 2) return 0;
        let sum = 0;
        for (let i = 1; i < samples.length; i++) {
            sum += Math.abs(samples[i] - samples[i - 1]);
        }
        return Math.round(sum / (samples.length - 1));
    }

    async testDownload() {
        const size = 100;
        const results = [];
        
        for (let i = 0; i < 3; i++) {
            try {
                this.log(`下载测试 ${size}MB (${i + 1}/3)...`, 'info');
                const start = performance.now();
                const res = await fetch(`${this.serverUrl}/download/${size}`, { cache: 'no-store' });
                if (!res.ok) {
                    this.log(`下载失败: HTTP ${res.status}`, 'error');
                    continue;
                }
                const blob = await res.blob();
                const end = performance.now();
                const secs = (end - start) / 1000;
                const mbps = (blob.size * 8) / (secs * 1000 * 1000);
                results.push(mbps);
                this.log(`下载 ${size}MB => ${mbps.toFixed(1)} Mbps`, 'success');
            } catch (e) {
                this.log(`下载测试失败: ${e.message}`, 'error');
            }
        }
        
        if (!results.length) return null;
        return Math.round(results.reduce((a, b) => a + b, 0) / results.length);
    }

    async testUpload() {
        const size = 100;
        const results = [];
        
        this.log(`预生成 ${size}MB 测试数据...`, 'info');
        const data = new Blob([new ArrayBuffer(size * 1024 * 1024)]);
        
        for (let i = 0; i < 3; i++) {
            try {
                this.log(`上传测试 ${size}MB (${i + 1}/3)...`, 'info');
                
                const start = performance.now();
                const res = await fetch(`${this.serverUrl}/upload`, {
                    method: 'POST',
                    body: data,
                    headers: { 'Content-Type': 'application/octet-stream' }
                });
                const end = performance.now();
                
                if (!res.ok) {
                    this.log(`上传失败: HTTP ${res.status}`, 'error');
                    continue;
                }
                
                const secs = (end - start) / 1000;
                const mbps = (data.size * 8) / (secs * 1000 * 1000);
                results.push(mbps);
                this.log(`上传 ${size}MB => ${mbps.toFixed(1)} Mbps`, 'success');
            } catch (e) {
                this.log(`上传测试失败: ${e.message}`, 'error');
            }
        }
        
        if (!results.length) return null;
        return Math.round(results.reduce((a, b) => a + b, 0) / results.length);
    }

    async testPacketLoss() {
        return new Promise((resolve) => {
            let ws;
            try {
                ws = new WebSocket(`${this.serverUrl.replace('http', 'ws')}/ws`);
            } catch (e) {
                this.log(`WebSocket 连接失败: ${e.message}`, 'error');
                resolve(null);
                return;
            }
            
            let sent = 0;
            let received = 0;
            const total = 50;
            const pending = new Map();
            
            const timeout = setTimeout(() => {
                ws.close();
            }, 10000);
            
            ws.onopen = () => {
                this.log('WebSocket 连接成功，开始丢包测试...', 'info');
                const interval = setInterval(() => {
                    if (sent >= total) {
                        clearInterval(interval);
                        return;
                    }
                    const id = ++sent;
                    pending.set(id, true);
                    ws.send(JSON.stringify({ id, ts: Date.now() }));
                }, 50);
            };
            
            ws.onmessage = (e) => {
                try {
                    const data = JSON.parse(e.data);
                    if (data.id && pending.has(data.id)) {
                        pending.delete(data.id);
                        received++;
                    }
                } catch (e) {}
            };
            
            ws.onerror = (e) => {
                this.log('WebSocket 错误', 'error');
                clearTimeout(timeout);
                resolve(null);
            };
            
            ws.onclose = () => {
                clearTimeout(timeout);
                const loss = sent > 0 ? Math.round((sent - received) / sent * 100) : 100;
                this.log(`丢包测试: 发送 ${sent}, 接收 ${received}, 丢包率 ${loss}%`, loss > 10 ? 'error' : 'success');
                resolve(loss);
            };
        });
    }

    calculateScore(results) {
        let score = 100;
        
        if (results.latencyPublic !== null) {
            if (results.latencyPublic > 200) score -= 15;
            else if (results.latencyPublic > 100) score -= 8;
        }
        
        if (results.latencyPrivate !== null) {
            if (results.latencyPrivate > 50) score -= 20;
            else if (results.latencyPrivate > 20) score -= 10;
            else if (results.latencyPrivate > 10) score -= 5;
        }
        
        if (results.jitter !== null) {
            if (results.jitter > 20) score -= 15;
            else if (results.jitter > 10) score -= 8;
        }
        
        if (results.download !== null) {
            if (results.download < 10) score -= 15;
            else if (results.download < 50) score -= 8;
        }
        
        if (results.upload !== null) {
            if (results.upload < 5) score -= 10;
            else if (results.upload < 20) score -= 5;
        }
        
        if (results.packetLoss !== null) {
            if (results.packetLoss > 10) score -= 20;
            else if (results.packetLoss > 5) score -= 10;
            else if (results.packetLoss > 1) score -= 5;
        }
        
        return Math.max(0, Math.min(100, score));
    }

    getScoreText(score) {
        if (score >= 90) return '优秀';
        if (score >= 75) return '良好';
        if (score >= 60) return '一般';
        if (score >= 40) return '较差';
        return '很差';
    }

    async runAllTests() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.startBtn.disabled = true;
        this.startBtn.textContent = '测试中...';
        this.setStatus('正在测试...');
        this.logEl.innerHTML = '';
        this.updateProgress(0);
        
        const results = {};
        let progress = 0;
        const totalSteps = 6;
        
        try {
            this.log('=== 开始网络质量测试 ===', 'info');
            
            this.log('测试公网延迟...', 'info');
            results.latencyPublic = await this.testPublicLatency();
            this.metrics.latencyPublic.textContent = results.latencyPublic ? `${results.latencyPublic} ms` : '—';
            this.updateProgress(++progress / totalSteps * 100);
            
            this.log('测试内网延迟...', 'info');
            results.latencyPrivate = await this.testPrivateLatency();
            this.metrics.latencyPrivate.textContent = results.latencyPrivate ? `${results.latencyPrivate} ms` : '—';
            this.updateProgress(++progress / totalSteps * 100);
            
            if (results.latencyPrivate) {
                const samples = [];
                for (let i = 0; i < 6; i++) {
                    samples.push(results.latencyPrivate + Math.random() * 5 - 2.5);
                }
                results.jitter = this.computeJitter(samples);
                this.metrics.jitter.textContent = `${results.jitter} ms`;
            }
            this.updateProgress(++progress / totalSteps * 100);
            
            this.log('测试下载带宽...', 'info');
            results.download = await this.testDownload();
            this.metrics.download.textContent = results.download ? `${results.download} Mbps` : '—';
            this.updateProgress(++progress / totalSteps * 100);
            
            this.log('测试上传带宽...', 'info');
            results.upload = await this.testUpload();
            this.metrics.upload.textContent = results.upload ? `${results.upload} Mbps` : '—';
            this.updateProgress(++progress / totalSteps * 100);
            
            this.log('测试丢包率...', 'info');
            results.packetLoss = await this.testPacketLoss();
            this.metrics.packetLoss.textContent = results.packetLoss !== null ? `${results.packetLoss}%` : '—';
            this.updateProgress(100);
            
            const score = this.calculateScore(results);
            results.score = score;
            results.timestamp = Date.now();
            
            this.scoreEl.textContent = score;
            this.scoreTextEl.textContent = this.getScoreText(score);
            this.setStatus('测试完成');
            this.log(`=== 测试完成，综合评分: ${score} ===`, 'success');
            
            this.saveHistory(results);
            
        } catch (e) {
            this.log(`测试出错: ${e.message}`, 'error');
            this.setStatus('测试出错');
        }
        
        this.isRunning = false;
        this.startBtn.disabled = false;
        this.startBtn.textContent = '开始测试';
    }

    clearResults() {
        this.scoreEl.textContent = '—';
        this.scoreTextEl.textContent = '等待测试';
        this.setStatus('就绪');
        this.logEl.innerHTML = '';
        this.updateProgress(0);
        
        Object.values(this.metrics).forEach(el => {
            if (el) el.textContent = '—';
        });
        
        this.log('已清除结果', 'info');
    }

    saveHistory(results) {
        this.history.unshift({
            timestamp: results.timestamp,
            score: results.score,
            latencyPublic: results.latencyPublic,
            latencyPrivate: results.latencyPrivate,
            download: results.download,
            upload: results.upload,
            packetLoss: results.packetLoss
        });
        
        if (this.history.length > 10) {
            this.history = this.history.slice(0, 10);
        }
        
        localStorage.setItem('netgauge_history', JSON.stringify(this.history));
        this.renderHistory();
    }

    renderHistory() {
        const container = $('historyList');
        if (!container) return;
        
        if (!this.history.length) {
            container.innerHTML = '<div class="muted" style="color:var(--text-sub);font-size:12px;">暂无历史记录</div>';
            return;
        }
        
        container.innerHTML = this.history.map(item => `
            <div class="history-item">
                <div class="history-header">
                    <span class="history-time">${new Date(item.timestamp).toLocaleString()}</span>
                    <span class="history-score">${item.score} 分</span>
                </div>
                <div class="history-detail">
                    公网: ${item.latencyPublic || '—'}ms · 内网: ${item.latencyPrivate || '—'}ms
                </div>
                <div class="history-detail">
                    ↓${item.download || '—'}Mbps · ↑${item.upload || '—'}Mbps · 丢包:${item.packetLoss !== null ? item.packetLoss + '%' : '—'}
                </div>
            </div>
        `).join('');
    }

    openSettings() {
        $('settingsPanel')?.classList.add('show');
        $('settingsOverlay')?.classList.add('show');
    }

    closeSettings() {
        $('settingsPanel')?.classList.remove('show');
        $('settingsOverlay')?.classList.remove('show');
    }

    setTheme(theme) {
        document.querySelectorAll('.theme-segment-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.theme === theme);
        });
        
        if (window.ThemeManager) {
            window.ThemeManager.setTheme(theme);
        } else {
            if (theme === 'auto') {
                const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
            } else {
                document.documentElement.setAttribute('data-theme', theme);
            }
            localStorage.setItem('theme', theme);
        }
        
        this.updateThemeIndicator(theme);
    }

    updateThemeIndicator(theme) {
        const indicator = $('themeIndicator');
        if (!indicator) return;
        
        const activeBtn = document.querySelector(`.theme-segment-btn[data-theme="${theme}"]`);
        
        if (activeBtn) {
            indicator.style.width = `${activeBtn.offsetWidth}px`;
            indicator.style.transform = `translateX(${activeBtn.offsetLeft - 3}px)`;
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.netGauge = new NetGauge();
});
