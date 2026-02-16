class JiBaJiBaPlayer {
    constructor() {
        this.pc = null;
        this.currentUrl = null;
        this.statsInterval = null;
        this.isFullscreen = false;
        this.fullscreenTimeout = null;
        this.currentProto = 'whep';

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

        this.presetChannels = [
            { name: '[直播] JOYG', img: '../assets/joyg.jpg', url: 'http://10.126.126.15:1985/rtc/v1/whep/?app=live&stream=JOYG' },
            { name: '[直播] CMHH', img: '../assets/cmhh.jpg', url: 'http://10.126.126.15:1985/rtc/v1/whep/?app=live&stream=CMHH' },
            { name: '[直播] Pure1ove', img: '../assets/pl.jpg', url: 'http://10.126.126.15:1985/rtc/v1/whep/?app=live&stream=PL' },
            { name: '[直播] DJ_Hero', img: '../assets/ljy.jpg', url: 'http://10.126.126.15:1985/rtc/v1/whep/?app=live&stream=LJY' },
            { name: '[直播] REDguard', img: '../assets/aaa.jpg', url: 'http://10.126.126.15:1985/rtc/v1/whep/?app=live&stream=AAA' }
        ];

        this._bindUI();
        this._loadPresetChannels();
        this.updateStatus('就绪 - 点击频道或输入房间号开始播放');
    }

    _bindUI() {
        document.querySelectorAll('.protocol-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.protocol-btn').forEach(b => {
                    b.classList.remove('active');
                    b.setAttribute('aria-pressed', 'false');
                });
                btn.classList.add('active');
                btn.setAttribute('aria-pressed', 'true');
                this.currentProto = btn.dataset.proto;
            });
        });

        document.getElementById('connectBtn').addEventListener('click', () => this.connectRoom());
        document.getElementById('refreshBtn').addEventListener('click', () => this.refresh());
        document.getElementById('disconnectBtn').addEventListener('click', () => this.disconnect());
        if (this.fullscreenBtn) this.fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());

        const reconnectConfigBtn = document.getElementById('reconnectConfigBtn');
        if (reconnectConfigBtn) reconnectConfigBtn.addEventListener('click', () => this.openReconnectModal());

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
                    if (this.presetChannels[0]) this.connectStream(this.presetChannels[0].url, 'whep');
                    break;
                case '2':
                    if (this.presetChannels[1]) this.connectStream(this.presetChannels[1].url, 'whep');
                    break;
                case '3':
                    if (this.presetChannels[2]) this.connectStream(this.presetChannels[2].url, 'whep');
                    break;
            }
        });
    }

    _loadPresetChannels() {
        this.presetContainer.innerHTML = '';
        this.presetChannels.forEach((ch, index) => {
            const btn = this._createChannelButton(ch.name, ch.img, ch.url, false, 'whep');
            btn.setAttribute('data-hotkey', index + 1);
            this.presetContainer.appendChild(btn);
        });
    }

    _createChannelButton(name, img, url, manual = false, proto = 'whep') {
        const btn = document.createElement('button');
        btn.className = 'button_play' + (manual ? ' manual' : '');
        btn.type = 'button';
        btn.addEventListener('click', () => this.connectStream(url, proto));
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

        if (manual) {
            const urlDiv = document.createElement('div');
            urlDiv.className = 'url_text';
            urlDiv.innerText = url;

            const delBtn = document.createElement('button');
            delBtn.className = 'delete_btn';
            delBtn.type = 'button';
            delBtn.title = '删除记录';
            delBtn.innerText = '×';
            delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (btn.parentElement) btn.parentElement.removeChild(btn);
                if (urlDiv.parentElement) urlDiv.parentElement.removeChild(urlDiv);
            });

            btn.appendChild(delBtn);
            this.historyContainer.appendChild(btn);
            this.historyContainer.appendChild(urlDiv);
        }

        return btn;
    }

    generateUrl(room) {
        if (!room) return null;
        switch (this.currentProto) {
            case 'whep':
                return `http://10.126.126.15:1985/rtc/v1/whep/?app=live&stream=${room}`;
            case 'hls':
                return `http://localhost:8080/live/${room}.m3u8`;
            default:
                return null;
        }
    }

    connectRoom() {
        const room = this.roomInput.value.trim();
        if (!room) return;
        const url = this.generateUrl(room);
        if (!url) return;
        this.connectStream(url, this.currentProto);
        this.addManualChannel(room, url, this.currentProto);
    }

    addManualChannel(name, url, proto) {
        this._createChannelButton(name, null, url, true, proto);
    }

    refresh() {
        if (this.currentUrl) this.connectStream(this.currentUrl, this.currentProto);
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

    async connectStream(url, proto) {
        this.disconnect();
        this.isManualDisconnect = false;
        this.currentUrl = url;
        this.currentProto = proto;
        this.updateStatus('正在连接...');

        if (proto === 'hls') {
            try {
                this.video.src = url;
                this.video.load();
                await this.video.play();
                this.updateStatus('HLS连接成功 · 正在播放');
                this._startHLSStats();
            } catch (e) {
                console.error('HLS连接失败', e);
                this.updateStatus(`HLS连接失败: ${e.message}`);
            }
            return;
        }

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

    _startHLSStats() {
        if (this.statsInterval) clearInterval(this.statsInterval);
        this.statsInterval = setInterval(() => {
            if (this.video.readyState > 0) {
                const buffered = this.video.buffered;
                let bufferedTime = 0;
                if (buffered.length > 0) {
                    bufferedTime = buffered.end(buffered.length - 1) - this.video.currentTime;
                }
                this.updateStatus(`HLS播放中 · 缓冲: ${bufferedTime.toFixed(1)}秒`);
            }
        }, 2000);
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

    updateStatus(text) { if (this.statusEl) this.statusEl.innerText = text; }
}

window.player = new JiBaJiBaPlayer();

document.getElementById('modalClose').addEventListener('click', () => window.player.closeReconnectModal());
document.getElementById('modalCancel').addEventListener('click', () => window.player.closeReconnectModal());
document.getElementById('modalSave').addEventListener('click', () => window.player.saveReconnectConfig());
document.getElementById('reconnectModal').addEventListener('click', (e) => {
    if (e.target.id === 'reconnectModal') window.player.closeReconnectModal();
});
