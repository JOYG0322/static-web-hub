class JiBaJiBaPlayer {
    constructor() {
        this.pc = null;
        this.currentUrl = null;
        this.statsInterval = null;
        this.isFullscreen = false;
        this.fullscreenTimeout = null;

        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        this.maxReconnectDelay = 30000;
        this.reconnectTimer = null;
        this.isManualDisconnect = false;
        this.isConnected = false;

        this.video = document.getElementById('remoteVideo');
        this.statusEl = document.getElementById('status');
        this.fullscreenBtn = document.getElementById('fullscreenBtn');
        this.roomInput = document.getElementById('roomInput');
        this.presetContainer = document.getElementById('presetContainer');
        this.historyContainer = document.getElementById('historyContainer');
        this.serverSelect = document.getElementById('serverSelect');
        this.currentServer = this.serverSelect ? this.serverSelect.value : '10.126.126.15';

        this.presetChannels = [
            { name: '[直播] JOYG', img: '../assets/joyg.jpg', stream: 'JOYG' },
            { name: '[直播] CMHH', img: '../assets/cmhh.jpg', stream: 'CMHH' },
            { name: '[直播] Pure1ove', img: '../assets/pl.jpg', stream: 'PL' },
            { name: '[直播] DJ_Hero', img: '../assets/ljy.jpg', stream: 'LJY' },
            { name: '[直播] REDguard', img: '../assets/aaa.jpg', stream: 'AAA' }
        ];

        this._initTheme();
        this._bindUI();
        this._loadPresetChannels();
        this._loadHistory();
        this._checkStreamStatus();
        setInterval(() => this._checkStreamStatus(), 10000);
        this.updateStatus('就绪 - 点击频道或输入房间号开始播放');
    }

    _initTheme() {
        this.themeBtn = document.getElementById('themeBtn');
        this.themeDropdown = document.getElementById('themeDropdown');
        this.themeIcon = document.getElementById('themeIcon');
        
        this.currentTheme = window.ThemeManager ? window.ThemeManager.getTheme() : 'auto';
        this._updateThemeIcon();
        this._updateFavicon(this._getEffectiveTheme());
    }

    _getEffectiveTheme() {
        if (this.currentTheme === 'auto') {
            return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        return this.currentTheme;
    }

    setTheme(theme) {
        this.currentTheme = theme;
        if (window.ThemeManager) {
            window.ThemeManager.setTheme(theme);
        }
        this._updateThemeOptions();
        this._updateFavicon(this._getEffectiveTheme());
    }

    _updateFavicon(theme) {
        const favicon = document.getElementById('favicon');
        if (!favicon) return;
        
        const icons = {
            dark: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'><path fill='%23FFF' d='M96.7 270.3C49 360.7 10 435 10 435.3c0 .4 16.5.6 36.6.5l36.6-.3 50-94.5c27.5-52 51.5-97.4 53.4-101l3.5-6.5-.4 89.5-.4 89.5 15.8 11.8 15.8 11.7h192.4l15.8-11.7 15.8-11.8.1-147c0-88.9-.4-146.5-.9-146-.5.6-15.6 26.2-33.6 57l-32.6 55.9.1 58.8V350H257V106h-73.5z'/><path fill='maroon' d='M370.3 107.2c-.5.7-24.2 41.4-52.7 90.5l-51.7 89.1-.2 26.6-.2 26.6 21.7-.2 21.7-.3 67.4-116 67.4-116-15.6-.6c-29.6-1.2-56.8-1-57.8.3'/></svg>",
            light: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'><path d='M96.7 270.3C49 360.7 10 435 10 435.3c0 .4 16.5.6 36.6.5l36.6-.3 50-94.5c27.5-52 51.5-97.4 53.4-101l3.5-6.5-.4 89.5-.4 89.5 15.8 11.8 15.8 11.7h192.4l15.8-11.7 15.8-11.8.1-147c0-88.9-.4-146.5-.9-146-.5.6-15.6 26.2-33.6 57l-32.6 55.9.1 58.8V350H257V106h-73.5z'/><path fill='maroon' d='M370.3 107.2c-.5.7-24.2 41.4-52.7 90.5l-51.7 89.1-.2 26.6-.2 26.6 21.7-.2 21.7-.3 67.4-116 67.4-116-15.6-.6c-29.6-1.2-56.8-1-57.8.3'/></svg>"
        };
        
        const svg = icons[theme] || icons.dark;
        favicon.href = `data:image/svg+xml,${svg}`;
    }

    _updateThemeOptions() {
        this.themeDropdown.querySelectorAll('.theme-option').forEach(opt => {
            opt.classList.toggle('active', opt.dataset.theme === this.currentTheme);
        });
        this._updateThemeIcon();
    }

    _updateThemeIcon() {
        const themeSvg = document.getElementById('themeSvg');
        if (!themeSvg) return;
        
        const icons = {
            dark: '<path d="M13.2764 9.52325C12.5607 9.97755 11.7177 10.242 10.7812 10.242C8.11386 10.2419 5.95042 8.07997 5.9502 5.4129C5.9502 4.48129 6.21453 3.61072 6.67188 2.87286C4.30332 3.4658 2.54992 5.60846 2.5498 8.16094C2.5498 11.1712 4.99103 13.6102 8 13.6102C10.5383 13.6102 12.6709 11.8725 13.2764 9.52325ZM7.05078 5.4129C7.051 7.47225 8.72116 9.14231 10.7812 9.14239C11.9248 9.14239 12.887 8.63398 13.5781 7.8084C13.7266 7.63107 13.9701 7.56548 14.1875 7.64434C14.4049 7.7233 14.5497 7.9297 14.5498 8.16094C14.5498 11.7766 11.6161 14.7098 8 14.7098C4.38402 14.7098 1.4502 11.7792 1.4502 8.16094C1.45033 4.54323 4.3812 1.61016 8 1.61016C8.23027 1.61016 8.43585 1.75353 8.51562 1.96954C8.59536 2.18555 8.53241 2.4283 8.35742 2.57793C7.55573 3.26311 7.05078 4.27877 7.05078 5.4129Z"/>',
            light: '<path d="M11.3496 8C11.3496 6.14985 9.85015 4.65039 8 4.65039C6.14985 4.65039 4.65039 6.14985 4.65039 8C4.65039 9.85015 6.14985 11.3496 8 11.3496C9.85015 11.3496 11.3496 9.85015 11.3496 8ZM12.6504 8C12.6504 10.5681 10.5681 12.6504 8 12.6504C5.43188 12.6504 3.34961 10.5681 3.34961 8C3.34961 5.43188 5.43188 3.34961 8 3.34961C10.5681 3.34961 12.6504 5.43188 12.6504 8Z"/><path d="M8.65039 0.5V2.5H7.34961V0.5H8.65039Z"/><path d="M8.65039 13.5V15.5H7.34961V13.5H8.65039Z"/><path d="M3.15808 2.24035L4.57229 3.65456L3.6525 4.57435L2.23829 3.16014L3.15808 2.24035Z"/><path d="M12.3505 11.4327L13.7647 12.8469L12.8449 13.7667L11.4307 12.3525L12.3505 11.4327Z"/><path d="M2.24537 12.8469L3.65958 11.4327L4.57937 12.3525L3.16516 13.7667L2.24537 12.8469Z"/><path d="M11.4377 3.65455L12.852 2.24033L13.7718 3.16012L12.3575 4.57434L11.4377 3.65455Z"/><path d="M0.5 7.35461H2.5V8.6554H0.5L0.5 7.35461Z"/><path d="M13.5 7.35461H15.5V8.6554H13.5V7.35461Z"/>',
            auto: '<path d="M12.1665 13.5811V14.7803H3.66651V13.5811H12.1665Z"/><path d="M13.4453 7.02379C13.4453 6.04702 13.4452 5.3616 13.3887 4.83434C13.3333 4.31828 13.2302 4.02378 13.0723 3.80309C12.9446 3.62475 12.7877 3.46883 12.6094 3.34117C12.3887 3.18328 12.0942 3.08007 11.5781 3.02477C11.0508 2.96829 10.3655 2.96715 9.38867 2.96715H6.61035C5.63359 2.96715 4.94816 2.96827 4.4209 3.02477C3.90486 3.0801 3.61034 3.18321 3.38965 3.34117C3.21143 3.46878 3.05534 3.62487 2.92774 3.80309C2.76977 4.02377 2.66667 4.3183 2.61133 4.83434C2.55483 5.3616 2.55371 6.04702 2.55371 7.02379C2.55371 8.0006 2.55485 8.68596 2.61133 9.21324C2.66663 9.72936 2.76983 10.0238 2.92774 10.2445C3.0554 10.4228 3.21131 10.5797 3.38965 10.7074C3.61034 10.8654 3.90484 10.9685 4.4209 11.0238C4.94816 11.0803 5.63359 11.0804 6.61035 11.0804H9.38867C10.3654 11.0804 11.0508 11.0803 11.5781 11.0238C12.0941 10.9685 12.3887 10.8652 12.6094 10.7074C12.7877 10.5797 12.9446 10.4229 13.0723 10.2445C13.2301 10.0238 13.3334 9.72927 13.3887 9.21324C13.4452 8.68596 13.4453 8.00058 13.4453 7.02379ZM14.6455 7.02379C14.6455 7.97428 14.646 8.73509 14.5811 9.34117C14.5149 9.95828 14.3756 10.4858 14.0479 10.9437C13.8436 11.229 13.5938 11.4788 13.3086 11.683C12.8507 12.0108 12.3232 12.15 11.7061 12.2162C11.1 12.2811 10.3391 12.2806 9.38867 12.2806H6.61035C5.66018 12.2806 4.89991 12.2811 4.29395 12.2162C3.67684 12.15 3.14935 12.0108 2.69141 11.683C2.40613 11.4788 2.15639 11.229 1.95215 10.9437C1.62436 10.4858 1.4841 9.95828 1.41797 9.34117C1.35305 8.73511 1.35449 7.97424 1.35449 7.02379C1.35449 6.07366 1.35308 5.31333 1.41797 4.70738C1.4841 4.09028 1.62436 3.56279 1.95215 3.10485C2.15638 2.81956 2.40613 2.56982 2.69141 2.36559C3.14935 2.03779 3.67684 1.89753 4.29395 1.83141C4.8999 1.76652 5.66022 1.76793 6.61035 1.76793H9.38867C10.3391 1.76793 11.1 1.76649 11.7061 1.83141C12.3232 1.89753 12.8507 2.03779 13.3086 2.36559C13.5939 2.56982 13.8436 2.81957 14.0479 3.10485C14.3756 3.56279 14.5149 4.09028 14.5811 4.70738C14.646 5.31335 14.6455 6.07362 14.6455 7.02379Z"/>'
        };
        
        themeSvg.innerHTML = icons[this.currentTheme] || icons.auto;
    }

    toggleThemeDropdown() {
        this.themeDropdown.classList.toggle('show');
    }

    _bindUI() {
        document.getElementById('connectBtn').addEventListener('click', () => this.connectRoom());
        document.getElementById('refreshBtn').addEventListener('click', () => this.refresh());
        document.getElementById('disconnectBtn').addEventListener('click', () => this.disconnect());
        if (this.fullscreenBtn) this.fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());

        const reconnectConfigBtn = document.getElementById('reconnectConfigBtn');
        if (reconnectConfigBtn) reconnectConfigBtn.addEventListener('click', () => this.openReconnectModal());

        const clearHistoryBtn = document.getElementById('clearHistoryBtn');
        if (clearHistoryBtn) clearHistoryBtn.addEventListener('click', () => this.clearHistory());

        if (this.themeBtn) {
            this.themeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleThemeDropdown();
            });
        }

        if (this.themeDropdown) {
            this.themeDropdown.querySelectorAll('.theme-option').forEach(opt => {
                opt.addEventListener('click', () => {
                    this.setTheme(opt.dataset.theme);
                    this.themeDropdown.classList.remove('show');
                });
            });
            this._updateThemeOptions();
        }

        document.addEventListener('click', (e) => {
            if (this.themeDropdown && !e.target.closest('.theme-switcher')) {
                this.themeDropdown.classList.remove('show');
            }
        });

        if (this.serverSelect) {
            this.serverSelect.addEventListener('change', (e) => {
                this.currentServer = e.target.value;
                this._loadPresetChannels();
                this._checkStreamStatus();
                this.updateStatus(`已切换到服务器: ${this.currentServer}`);
            });
        }

        this.roomInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.connectRoom(); });

        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT') return;
            switch (e.key) {
                case 'f': case 'F':
                    if (!this.isFullscreen && (this.video.srcObject || this.video.src)) this.toggleFullscreen();
                    break;
                case 'Escape':
                    if (this.isFullscreen) this.toggleFullscreen();
                    break;
                case 's': case 'S':
                    this.refresh();
                    break;
                case 'd': case 'D':
                    this.disconnect();
                    break;
                case '1':
                    if (this.presetChannels[0]) this.connectStream(this._buildStreamUrl(this.presetChannels[0].stream));
                    break;
                case '2':
                    if (this.presetChannels[1]) this.connectStream(this._buildStreamUrl(this.presetChannels[1].stream));
                    break;
                case '3':
                    if (this.presetChannels[2]) this.connectStream(this._buildStreamUrl(this.presetChannels[2].stream));
                    break;
            }
        });
    }

    _loadPresetChannels() {
        this.presetContainer.innerHTML = '';
        this.presetChannels.forEach((ch, index) => {
            const url = this._buildStreamUrl(ch.stream);
            const btn = this._createChannelButton(ch.name, ch.img, url, false);
            btn.setAttribute('data-hotkey', index + 1);
            this.presetContainer.appendChild(btn);
        });
    }

    _buildStreamUrl(stream) {
        return `http://${this.currentServer}:1985/rtc/v1/whep/?app=live&stream=${stream}`;
    }

    _createChannelButton(name, img, url, manual = false) {
        const btn = document.createElement('button');
        btn.className = 'button_play' + (manual ? ' manual' : '');
        btn.type = 'button';
        btn.addEventListener('click', () => this.connectStream(url));
        btn.addEventListener('mousedown', () => btn.classList.add('pressed'));
        document.addEventListener('mouseup', () => btn.classList.remove('pressed'));
        btn.addEventListener('mouseleave', () => btn.classList.remove('pressed'));

        if (img) {
            const imgEl = document.createElement('img');
            imgEl.className = 'head_img';
            imgEl.src = img;
            imgEl.alt = '';
            btn.appendChild(imgEl);
        }

        const txt = document.createElement('div');
        txt.className = 'channel_text';
        txt.innerText = name;
        btn.appendChild(txt);

        const indicator = document.createElement('div');
        indicator.className = 'status-indicator';
        const streamName = this._extractStreamName(url);
        if (streamName) indicator.setAttribute('streamname', streamName);
        btn.appendChild(indicator);

        if (manual) {
            const urlDiv = document.createElement('div');
            urlDiv.className = 'url_text';
            urlDiv.innerText = url;
            btn.appendChild(urlDiv);

            const delBtn = document.createElement('button');
            delBtn.className = 'delete_btn';
            delBtn.type = 'button';
            delBtn.title = '删除记录';
            delBtn.innerText = '×';
            delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (btn.parentElement) btn.parentElement.removeChild(btn);
                this._saveHistory();
            });

            btn.appendChild(delBtn);
            this.historyContainer.appendChild(btn);
        }

        return btn;
    }

    generateUrl(room) {
        if (!room) return null;
        return this._buildStreamUrl(room);
    }

    connectRoom() {
        const room = this.roomInput.value.trim();
        if (!room) return;
        const url = this.generateUrl(room);
        if (!url) return;
        this.connectStream(url);
        this.addManualChannel(room, url);
    }

    addManualChannel(name, url) {
        const historyContainer = this.historyContainer;
        const maxHistory = 6;
        
        while (historyContainer.children.length >= maxHistory) {
            historyContainer.removeChild(historyContainer.lastChild);
        }
        
        this._createChannelButton(name, null, url, true);
        this._saveHistory();
    }

    _loadHistory() {
        try {
            const history = JSON.parse(localStorage.getItem('jibajiba_history') || '[]');
            history.forEach(item => {
                this._createChannelButton(item.name, null, item.url, true);
            });
        } catch (e) {
            console.error('加载历史记录失败:', e);
        }
    }

    _saveHistory() {
        try {
            const history = [];
            this.historyContainer.querySelectorAll('.button_play.manual').forEach(btn => {
                const name = btn.querySelector('.channel_text')?.innerText || '';
                const url = btn.querySelector('.url_text')?.innerText || '';
                if (name && url) {
                    history.push({ name, url });
                }
            });
            localStorage.setItem('jibajiba_history', JSON.stringify(history));
        } catch (e) {
            console.error('保存历史记录失败:', e);
        }
    }

    clearHistory() {
        this.historyContainer.innerHTML = '';
        localStorage.removeItem('jibajiba_history');
        this.updateStatus('历史记录已清空');
    }

    refresh() {
        if (this.currentUrl) this.connectStream(this.currentUrl);
    }

    disconnect() {
        this.isManualDisconnect = true;
        this.isConnected = false;
        
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;
        
        if (this.pc) {
            try { this.pc.close(); } catch (e) {}
            this.pc = null;
        }
        if (this.statsInterval) { clearInterval(this.statsInterval); this.statsInterval = null; }
        try {
            this.video.srcObject = null;
            this.video.src = '';
            this.video.load();
        } catch (e) {}
        this.updateStatus('已断开连接');
        window._lastBytes = 0;
        if (this.isFullscreen) this.toggleFullscreen();
    }

    async connectStream(url) {
        this.disconnect();
        this.isManualDisconnect = false;
        this.currentUrl = url;
        this.updateStatus('正在连接...');

        try {
            this.pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
            this.pc.addTransceiver('video', { direction: 'recvonly' });
            this.pc.addTransceiver('audio', { direction: 'recvonly' });

            this.pc.ontrack = (e) => {
                try { this.video.srcObject = e.streams[0]; } catch (err) {}
                this.updateStatus('连接成功 · 正在接收视频');
            };

            this.pc.oniceconnectionstatechange = () => {
                if (this.pc) {
                    const st = this.pc.iceConnectionState;
                    console.log(`ICE状态: ${st}`);
                    if (st === 'connected' || st === 'completed') {
                        this.isConnected = true;
                        this.reconnectAttempts = 0;
                        this.reconnectDelay = 1000;
                    } else if (st === 'failed') {
                        this.updateStatus('ICE连接失败，准备重连...');
                        this._attemptReconnect();
                    } else if (st === 'disconnected') {
                        this.updateStatus('ICE连接断开，等待恢复...');
                        this._waitForIceRecovery();
                    }
                }
            };

            const offer = await this.pc.createOffer();
            await this.pc.setLocalDescription(offer);

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/sdp' },
                body: offer.sdp
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const answer = await response.text();
            await this.pc.setRemoteDescription({ type: 'answer', sdp: answer });

            this._startStats();
        } catch (e) {
            console.error('连接失败', e);
            this.updateStatus(`连接失败: ${e.message}`);
            this.disconnect();
        }
    }

    _startStats() {
        if (this.statsInterval) clearInterval(this.statsInterval);
        this.statsInterval = setInterval(async () => {
            if (!this.pc || this.pc.connectionState !== 'connected') return;
            try {
                const stats = await this.pc.getStats();
                let fps = 0, bitrate = 0, rtt = 0, loss = 0;
                stats.forEach(r => {
                    if (r.type === 'inbound-rtp' && r.kind === 'video') {
                        if (r.framesPerSecond) fps = r.framesPerSecond;
                        if (r.bytesReceived && r.timestamp) {
                            if (window._lastBytes && window._lastTime) {
                                const dt = (r.timestamp - window._lastTime) / 1000;
                                bitrate = Math.round(((r.bytesReceived - window._lastBytes) * 8) / dt / 1000);
                            }
                            window._lastBytes = r.bytesReceived;
                            window._lastTime = r.timestamp;
                        }
                    }
                    if (r.type === 'candidate-pair' && r.state === 'succeeded') {
                        if (r.currentRoundTripTime) rtt = Math.round(r.currentRoundTripTime * 1000);
                    }
                    if (r.type === 'inbound-rtp' && r.kind === 'video' && r.packetsLost !== undefined) {
                        const lost = r.packetsLost || 0;
                        const total = (r.packetsReceived || 0) + lost;
                        if (total > 0) loss = Math.round((lost / total) * 100);
                    }
                });
                this.updateStatus(`WebRTC · ${bitrate}kbps · ${fps}fps · RTT:${rtt}ms · 丢包:${loss}%`);
            } catch (e) {}
        }, 1000);
    }

    _waitForIceRecovery() {
        if (this.isManualDisconnect) return;
        
        let checkCount = 0;
        const maxChecks = 10;
        
        const checkInterval = setInterval(() => {
            if (this.isManualDisconnect || !this.pc) {
                clearInterval(checkInterval);
                return;
            }
            
            const state = this.pc.iceConnectionState;
            if (state === 'connected' || state === 'completed') {
                clearInterval(checkInterval);
                this.updateStatus('ICE连接已恢复');
                return;
            }
            
            checkCount++;
            if (checkCount >= maxChecks || state === 'failed') {
                clearInterval(checkInterval);
                this.updateStatus('ICE恢复失败，准备重连...');
                this._attemptReconnect();
            }
        }, 500);
    }

    _attemptReconnect() {
        if (this.isManualDisconnect) {
            console.log('用户主动断开，不进行重连');
            return;
        }
        
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            this.updateStatus(`重连失败，已达最大重试次数(${this.maxReconnectAttempts})`);
            console.log('已达最大重连次数');
            return;
        }
        
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }
        
        this.reconnectAttempts++;
        const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), this.maxReconnectDelay);
        
        this.updateStatus(`第${this.reconnectAttempts}次重连，${Math.round(delay/1000)}秒后尝试...`);
        console.log(`第${this.reconnectAttempts}次重连，延迟${delay}ms`);
        
        this.reconnectTimer = setTimeout(async () => {
            if (this.isManualDisconnect) return;
            
            if (!this.currentUrl) {
                this.updateStatus('无法重连：没有有效的URL');
                return;
            }
            
            try {
                await this._doReconnect();
            } catch (e) {
                console.error('重连失败:', e);
                this._attemptReconnect();
            }
        }, delay);
    }

    async _doReconnect() {
        this._cleanupPeerConnection();
        
        this.pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        this.pc.addTransceiver('video', { direction: 'recvonly' });
        this.pc.addTransceiver('audio', { direction: 'recvonly' });

        this.pc.ontrack = (e) => {
            try { this.video.srcObject = e.streams[0]; } catch (err) {}
            this.updateStatus('重连成功 · 正在接收视频');
            this.reconnectAttempts = 0;
            this.reconnectDelay = 1000;
        };

        this.pc.oniceconnectionstatechange = () => {
            if (this.pc) {
                const st = this.pc.iceConnectionState;
                console.log(`重连ICE状态: ${st}`);
                if (st === 'connected' || st === 'completed') {
                    this.isConnected = true;
                    this.reconnectAttempts = 0;
                    this.reconnectDelay = 1000;
                } else if (st === 'failed') {
                    this.updateStatus('重连ICE失败，准备再次重连...');
                    this._attemptReconnect();
                } else if (st === 'disconnected') {
                    this.updateStatus('重连后ICE断开，等待恢复...');
                    this._waitForIceRecovery();
                }
            }
        };

        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);

        const response = await fetch(this.currentUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/sdp' },
            body: offer.sdp
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const answer = await response.text();
        await this.pc.setRemoteDescription({ type: 'answer', sdp: answer });

        this._startStats();
    }

    _cleanupPeerConnection() {
        if (this.pc) {
            try {
                this.pc.ontrack = null;
                this.pc.oniceconnectionstatechange = null;
                this.pc.close();
            } catch (e) {}
            this.pc = null;
        }
    }

    toggleFullscreen() {
        if (!this.isFullscreen) {
            const overlay = document.createElement('div');
            overlay.className = 'fullscreen-mode';
            overlay.id = 'fullscreenContainer';

            const controls = document.createElement('div');
            controls.className = 'fullscreen-controls';
            controls.innerHTML = `<button id="fsDisconnectBtn" type="button">断开</button><button id="fsExitBtn" type="button">退出全屏</button>`;

            const videoWrapper = document.createElement('div');
            videoWrapper.style.cssText = 'width:100%;height:100%;display:flex;justify-content:center;align-items:center;';
            
            this.video.style.display = '';
            this.video.style.width = '100%';
            this.video.style.height = '100%';
            this.video.style.objectFit = 'contain';
            videoWrapper.appendChild(this.video);
            
            overlay.appendChild(videoWrapper);
            overlay.appendChild(controls);
            document.body.appendChild(overlay);

            document.getElementById('fsDisconnectBtn').addEventListener('click', () => this.disconnect());
            document.getElementById('fsExitBtn').addEventListener('click', () => this.toggleFullscreen());

            if (this.fullscreenBtn) this.fullscreenBtn.textContent = '退出全屏';
            this.isFullscreen = true;

            this.fullscreenTimeout = setTimeout(() => controls.classList.add('hidden'), 1000);
            overlay.addEventListener('mousemove', () => {
                controls.classList.remove('hidden');
                clearTimeout(this.fullscreenTimeout);
                this.fullscreenTimeout = setTimeout(() => controls.classList.add('hidden'), 1200);
            });
            controls.addEventListener('mouseleave', () => {
                clearTimeout(this.fullscreenTimeout);
                this.fullscreenTimeout = setTimeout(() => controls.classList.add('hidden'), 1200);
            });
        } else {
            const overlay = document.getElementById('fullscreenContainer');
            if (overlay) {
                const videoWrapper = overlay.querySelector('div');
                if (videoWrapper && this.video.parentElement === videoWrapper) {
                    videoWrapper.removeChild(this.video);
                }
                document.body.removeChild(overlay);
            }
            if (this.fullscreenTimeout) { clearTimeout(this.fullscreenTimeout); this.fullscreenTimeout = null; }
            
            const videoContainer = document.querySelector('.videoContainer');
            if (videoContainer && this.video.parentElement !== videoContainer) {
                const statusEl = videoContainer.querySelector('.status');
                const controlsEl = videoContainer.querySelector('.controls');
                if (statusEl) {
                    videoContainer.insertBefore(this.video, statusEl);
                } else if (controlsEl) {
                    videoContainer.insertBefore(this.video, controlsEl);
                } else {
                    videoContainer.insertBefore(this.video, videoContainer.firstChild);
                }
            }
            this.video.style.width = '';
            this.video.style.height = '';
            this.video.style.objectFit = '';
            this.video.style.display = '';
            
            if (this.fullscreenBtn) this.fullscreenBtn.textContent = '网页全屏';
            this.isFullscreen = false;
        }
    }

    openReconnectModal() {
        const modal = document.getElementById('reconnectModal');
        const inputMaxAttempts = document.getElementById('inputMaxAttempts');
        const inputReconnectDelay = document.getElementById('inputReconnectDelay');
        const inputMaxDelay = document.getElementById('inputMaxDelay');

        inputMaxAttempts.value = this.maxReconnectAttempts;
        inputReconnectDelay.value = this.reconnectDelay;
        inputMaxDelay.value = this.maxReconnectDelay;

        modal.classList.add('active');
    }

    closeReconnectModal() {
        const modal = document.getElementById('reconnectModal');
        modal.classList.remove('active');
    }

    saveReconnectConfig() {
        const inputMaxAttempts = document.getElementById('inputMaxAttempts');
        const inputReconnectDelay = document.getElementById('inputReconnectDelay');
        const inputMaxDelay = document.getElementById('inputMaxDelay');

        this.maxReconnectAttempts = parseInt(inputMaxAttempts.value) || 5;
        this.reconnectDelay = parseInt(inputReconnectDelay.value) || 1000;
        this.maxReconnectDelay = parseInt(inputMaxDelay.value) || 30000;

        console.log(`重连配置已更新: 最大次数=${this.maxReconnectAttempts}, 初始延迟=${this.reconnectDelay}ms, 最大延迟=${this.maxReconnectDelay}ms`);
        this.closeReconnectModal();
    }

    _extractStreamName(url) {
        const match = url.match(/stream=([^&]+)/);
        return match ? match[1] : null;
    }

    async _checkStreamStatus() {
        try {
            const response = await fetch(`http://${this.currentServer}:1985/api/v1/streams/`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            
            if (data.code === 0 && data.streams) {
                this.streamStatus = {};
                data.streams.forEach(stream => {
                    this.streamStatus[stream.name] = {
                        active: stream.publish && stream.publish.active,
                        video: stream.video,
                        audio: stream.audio
                    };
                });
                
                this._updateChannelStatusIndicators();
            }
        } catch (error) {
            console.error('获取流状态失败:', error);
            this._setAllStatusUnknown();
        }
    }

    _updateChannelStatusIndicators() {
        const indicators = document.querySelectorAll('.status-indicator[streamname]');
        indicators.forEach(indicator => {
            const streamName = indicator.getAttribute('streamname');
            const status = this.streamStatus && this.streamStatus[streamName];
            
            if (status && status.active) {
                indicator.style.background = '#00aa00';
                indicator.style.boxShadow = '0 0 20px #00ff00';
            } else {
                indicator.style.background = '#ff0000';
                indicator.style.boxShadow = '0 0 20px #ff0000';
            }
        });
    }

    _setAllStatusUnknown() {
        const indicators = document.querySelectorAll('.status-indicator[streamname]');
        indicators.forEach(indicator => {
            indicator.style.background = '#ff0000';
            indicator.style.boxShadow = '0 0 50px #ff0000';
        });
    }

    updateStatus(text) { if (this.statusEl) this.statusEl.innerText = text; }
}

window.player = new JiBaJiBaPlayer();

document.getElementById('modalClose').addEventListener('click', () => window.player.closeReconnectModal());
document.getElementById('modalCancel').addEventListener('click', () => window.player.closeReconnectModal());
document.getElementById('modalSave').addEventListener('click', () => window.player.saveReconnectConfig());
document.getElementById('reconnectModal').addEventListener('click', (e) => {
    if (e.target.id === 'reconnectModal') window.player.closeReconnectModal();
});
