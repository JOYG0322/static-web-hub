/**
 * 单条 WHEP 流的封装：负责一个 RTCPeerConnection 的完整生命周期，
 * 包含连接 / 断开 / 刷新 / 统计 / 音频可视化 / 自动重连 / ICE 恢复。
 * 主播放器持有两个实例（main / split），行为完全对称，无差异。
 */
class StreamSlot {
    constructor(player, key, maxReconnectConfig) {
        this.player = player;
        this.key = key; // 'main' | 'split'

        // 统一的 id 映射：主连接无后缀，分屏带 2 后缀
        const ids = key === 'main' ? {
            video: 'remoteVideo', status: 'status',
            qualityIndicator: 'qualityIndicator',
            audioStatus: 'audioStatus', audioJitter: 'audioJitter', audioSampleRate: 'audioSampleRate',
            audioBar: 'audioBar', audioBarFill: 'audioBarFill', audioWave: 'audioWave'
        } : {
            video: 'remoteVideo2', status: 'status2',
            qualityIndicator: 'qualityIndicator2',
            audioStatus: 'audioStatus2', audioJitter: 'audioJitter2', audioSampleRate: 'audioSampleRate2',
            audioBar: 'audioBar2', audioBarFill: 'audioBarFill2', audioWave: 'audioWave2'
        };

        this.dom = {
            video: document.getElementById(ids.video),
            statusEl: document.getElementById(ids.status),
            qualityIndicator: document.getElementById(ids.qualityIndicator),
            qualityText: document.getElementById(ids.qualityIndicator)?.querySelector('.quality-text'),
            audioStatus: document.getElementById(ids.audioStatus),
            audioJitter: document.getElementById(ids.audioJitter),
            audioSampleRate: document.getElementById(ids.audioSampleRate),
            audioBar: document.getElementById(ids.audioBar),
            audioBarFill: document.getElementById(ids.audioBarFill),
            audioWave: document.getElementById(ids.audioWave),
            audioWaveBars: document.getElementById(ids.audioWave)?.querySelectorAll('.wave-bar')
        };

        // 连接状态
        this.pc = null;
        this.currentUrl = null;
        this.isConnected = false;
        this.isManualDisconnect = false;

        // 定时器
        this.statsInterval = null;
        this.audioVisualInterval = null;
        this.iceRecoveryInterval = null;
        this.reconnectTimer = null;

        // 重连参数（由播放器统一配置，保持两路对称）
        this._applyReconnectConfig(maxReconnectConfig);
        this.reconnectAttempts = 0;
        this.reconnectDelay = maxReconnectConfig.reconnectDelay;

        // bitrate 计算的滑动状态（实例私有，替代旧的 window._lastBytes 全局）
        this._lastBytes = 0;
        this._lastTime = 0;

        // 上一次质量等级缓存，避免无谓的 class 抖动
        this._lastQuality = null;
        this.lastStats = {};

        this.resetStatusUI();
    }

    /** 从播放器同步重连配置（设置面板改动后调用） */
    _applyReconnectConfig(cfg) {
        this.maxReconnectAttempts = cfg.maxReconnectAttempts;
        this.reconnectDelayBase = cfg.reconnectDelay;
        this.maxReconnectDelay = cfg.maxReconnectDelay;
    }

    updateReconnectConfig(cfg) {
        this._applyReconnectConfig(cfg);
        this.reconnectDelay = Math.min(this.reconnectDelay, cfg.reconnectDelay);
    }

    /** ===================== 对外动作 ===================== */

    async connect(url, skipOnlineCheck = false) {
        // 连接前在线检测（与播放器配置一致）
        if (this.player.checkOnlineBeforeConnect && !skipOnlineCheck) {
            const streamName = this.player._extractStreamName(url);
            if (streamName && window.StreamStatusManager) {
                this.updateStatus('正在检测频道在线状态...');
                try {
                    const isOnline = await window.StreamStatusManager.checkSingleStatus(streamName);
                    if (!isOnline) {
                        this.updateStatus('频道离线，无法连接');
                        console.log(`[连接检测:${this.key}] 频道 ${streamName} 离线，取消连接`);
                        return false;
                    }
                    console.log(`[连接检测:${this.key}] 频道 ${streamName} 在线，继续连接`);
                } catch (e) {
                    console.log(`[连接检测:${this.key}] 检测失败，直接连接: ${e.message}`);
                }
            }
        }

        this.disconnect();
        this.isManualDisconnect = false;
        this.currentUrl = url;
        this.updateStatus('正在连接...');

        try {
            await this._setupPeerConnection();
            await this._negotiate(url);
            this._startStats();
            return true;
        } catch (e) {
            console.error(`[${this.key}] 连接失败`, e);
            this.updateStatus(`连接失败: ${e.message}`);
            this.disconnect();
            return false;
        }
    }

    refresh() {
        if (this.currentUrl) this.connect(this.currentUrl, true);
    }

    /**
     * 主动断开；clearSaved 仅对主连接有意义（清理"记住的频道"）。
     */
    disconnect({ clearSaved = false } = {}) {
        this.isManualDisconnect = true;
        this.isConnected = false;

        if (clearSaved) this.player._clearSavedChannel();

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.reconnectAttempts = 0;
        this.reconnectDelay = this.reconnectDelayBase;

        this._cleanupPeerConnection();
        this._clearTimers();

        if (this.dom.video) {
            try {
                this.dom.video.srcObject = null;
                this.dom.video.src = '';
                this.dom.video.load();
            } catch (e) {}
        }

        this.updateStatus('已断开连接');
        this.resetStatusUI();
    }

    /** ===================== 内部：PC 生命周期 ===================== */

    _setupPeerConnection() {
        this.pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        this.pc.addTransceiver('video', { direction: 'recvonly' });
        this.pc.addTransceiver('audio', { direction: 'recvonly' });

        this.pc.ontrack = (e) => {
            try { this.dom.video.srcObject = e.streams[0]; } catch (err) {}
            this.updateStatus('连接成功 · 正在接收视频');
        };

        this.pc.oniceconnectionstatechange = () => {
            if (!this.pc) return;
            const st = this.pc.iceConnectionState;
            console.log(`[${this.key}] ICE状态: ${st}`);
            if (st === 'connected' || st === 'completed') {
                this.isConnected = true;
                this.reconnectAttempts = 0;
                this.reconnectDelay = this.reconnectDelayBase;
                if (this.key === 'main') this.player._saveCurrentChannel();
            } else if (st === 'failed') {
                this.updateStatus('ICE连接失败，准备重连...');
                this._attemptReconnect();
            } else if (st === 'disconnected') {
                this.updateStatus('ICE连接断开，等待恢复...');
                this._waitForIceRecovery();
            }
        };
    }

    async _negotiate(url) {
        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);

        const response = await this._fetchWithTimeout(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/sdp' },
            body: offer.sdp
        }, 8000);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const answer = await response.text();
        await this.pc.setRemoteDescription({ type: 'answer', sdp: answer });
    }

    /**
     * 带超时的 fetch：SDP 协商服务器无响应时不会无限挂起，
     * 超时后抛 AbortError，由上层进重连/失败分支。
     */
    async _fetchWithTimeout(url, opts, timeoutMs) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            return await fetch(url, { ...opts, signal: controller.signal });
        } finally {
            clearTimeout(timer);
        }
    }

    _cleanupPeerConnection() {
        if (!this.pc) return;
        try {
            this.pc.ontrack = null;
            this.pc.oniceconnectionstatechange = null;
            this.pc.close();
        } catch (e) {}
        this.pc = null;
    }

    _clearTimers() {
        if (this.statsInterval) { clearInterval(this.statsInterval); this.statsInterval = null; }
        if (this.audioVisualInterval) { clearInterval(this.audioVisualInterval); this.audioVisualInterval = null; }
        if (this.iceRecoveryInterval) { clearInterval(this.iceRecoveryInterval); this.iceRecoveryInterval = null; }
        this._lastBytes = 0;
        this._lastTime = 0;
        this._lastQuality = null;
    }

    /** ===================== 内部：重连 / ICE 恢复 ===================== */

    _waitForIceRecovery() {
        if (this.isManualDisconnect) return;

        // 取消上一次恢复检测（避免并发）
        if (this.iceRecoveryInterval) clearInterval(this.iceRecoveryInterval);

        let checkCount = 0;
        const maxChecks = 10;

        this.iceRecoveryInterval = setInterval(() => {
            if (this.isManualDisconnect || !this.pc) {
                clearInterval(this.iceRecoveryInterval);
                this.iceRecoveryInterval = null;
                return;
            }

            const state = this.pc.iceConnectionState;
            if (state === 'connected' || state === 'completed') {
                clearInterval(this.iceRecoveryInterval);
                this.iceRecoveryInterval = null;
                this.updateStatus('ICE连接已恢复');
                return;
            }

            checkCount++;
            if (checkCount >= maxChecks || state === 'failed') {
                clearInterval(this.iceRecoveryInterval);
                this.iceRecoveryInterval = null;
                this.updateStatus('ICE恢复失败，准备重连...');
                this._attemptReconnect();
            }
        }, 500);
    }

    _attemptReconnect() {
        if (this.isManualDisconnect) {
            console.log(`[${this.key}] 用户主动断开，不进行重连`);
            return;
        }

        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            this.updateStatus(`重连失败，已达最大重试次数(${this.maxReconnectAttempts})`);
            console.log(`[${this.key}] 已达最大重连次数`);
            return;
        }

        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

        this.reconnectAttempts++;
        const delay = Math.min(
            this.reconnectDelayBase * Math.pow(2, this.reconnectAttempts - 1),
            this.maxReconnectDelay
        );

        this.updateStatus(`第${this.reconnectAttempts}次重连，${Math.round(delay / 1000)}秒后尝试...`);
        console.log(`[${this.key}] 第${this.reconnectAttempts}次重连，延迟${delay}ms`);

        this.reconnectTimer = setTimeout(async () => {
            this.reconnectTimer = null;
            if (this.isManualDisconnect) return;
            if (!this.currentUrl) {
                this.updateStatus('无法重连：没有有效的URL');
                return;
            }

            try {
                const ok = await this._doReconnect();
                if (!ok) this._attemptReconnect();
            } catch (e) {
                console.error(`[${this.key}] 重连失败:`, e);
                this._attemptReconnect();
            }
        }, delay);
    }

    async _doReconnect() {
        // 先彻底清理上一个（可能半成品的）PC，避免遗留多个未关闭的 RTCPeerConnection
        this._cleanupPeerConnection();
        this._clearTimers();

        this._setupPeerConnection();
        await this._negotiate(this.currentUrl);
        this._startStats();
        return true;
    }

    /** ===================== 内部：统计与可视化 =====================
     * 每 1s 一次 getStats 同时驱动：状态行 / 质量指示器 / 音频信息 / 音频可视化。
     * 取消了独立的 200ms 音频定时器，避免重复 getStats 调用。 */

    _startStats() {
        if (this.statsInterval) clearInterval(this.statsInterval);
        this.statsInterval = setInterval(async () => {
            if (!this.pc || this.pc.connectionState !== 'connected') return;
            try {
                const stats = await this.pc.getStats();
                let fps = 0, bitrate = 0, rtt = 0, loss = 0, jitter = 0, width = 0, height = 0, availableBitrate = 0;
                let audioLevel = 0, audioJitter = 0, audioSampleRate = 0;

                stats.forEach(r => {
                    if (r.type === 'inbound-rtp' && r.kind === 'video') {
                        if (r.framesPerSecond) fps = r.framesPerSecond;
                        if (r.bytesReceived && r.timestamp) {
                            if (this._lastBytes && this._lastTime) {
                                const dt = (r.timestamp - this._lastTime) / 1000;
                                if (dt > 0) bitrate = Math.round(((r.bytesReceived - this._lastBytes) * 8) / dt / 1000);
                            }
                            this._lastBytes = r.bytesReceived;
                            this._lastTime = r.timestamp;
                        }
                        if (r.jitter) jitter = Math.round(r.jitter * 1000);
                        if (r.frameWidth) width = r.frameWidth;
                        if (r.frameHeight) height = r.frameHeight;
                        if (r.packetsLost !== undefined) {
                            const lost = r.packetsLost || 0;
                            const total = (r.packetsReceived || 0) + lost;
                            if (total > 0) loss = Math.round((lost / total) * 100);
                        }
                    }
                    if (r.type === 'inbound-rtp' && r.kind === 'audio') {
                        if (r.audioLevel !== undefined) audioLevel = r.audioLevel;
                        if (r.jitter) audioJitter = Math.round(r.jitter * 1000);
                    }
                    if (r.type === 'codec' && r.kind === 'audio' && r.clockRate) {
                        audioSampleRate = r.clockRate;
                    }
                    if (r.type === 'candidate-pair' && r.state === 'succeeded') {
                        if (r.currentRoundTripTime) rtt = Math.round(r.currentRoundTripTime * 1000);
                        if (r.availableOutgoingBitrate) availableBitrate = Math.round(r.availableOutgoingBitrate / 1000);
                    }
                });

                const resolution = width && height ? `${width}x${height}` : '--';
                const jitterStr = jitter ? `${jitter}ms` : '--';
                const bitrateStr = availableBitrate ? `${availableBitrate}kbps` : '--';
                this.updateStatus(`${bitrate}kbps · ${fps}fps · ${resolution} · RTT:${rtt}ms · 抖动:${jitterStr} · 丢包:${loss}% · 带宽:${bitrateStr}`);
                this._updateQualityIndicator(rtt, loss);
                this._updateAudioInfo(audioJitter, audioSampleRate);
                // 顺带驱动音频可视化，避免再开 200ms 定时器多调一次 getStats
                this.updateAudioVisual(audioLevel);
                this.lastStats = { rtt: `${rtt}ms`, loss: `${loss}%`, bitrate: `${bitrate}kbps`, resolution, fps, jitter: jitterStr };
            } catch (e) {
                // getStats 异常极少见；保留可见日志便于排查突发问题
                console.warn(`[${this.key}] getStats 失败:`, e);
            }
        }, 1000);
    }

    _updateQualityIndicator(rtt, loss) {
        if (!this.dom.qualityIndicator || !this.dom.qualityText) return;

        let level;
        if (rtt > 1000 || loss > 50) level = 'poor';
        else if (rtt > 400 || loss > 30) level = 'medium';
        else level = 'good';

        if (this._lastQuality === level) return; // 无变化则不动 DOM
        this._lastQuality = level;

        const ind = this.dom.qualityIndicator;
        ind.classList.remove('quality-good', 'quality-medium', 'quality-poor');
        ind.classList.add(`quality-${level}`);
        const label = level === 'good' ? '连接质量优' : level === 'medium' ? '连接质量中' : '连接质量差';
        this.dom.qualityText.textContent = label;
    }

    _updateAudioInfo(jitter, sampleRate) {
        if (this.dom.audioJitter) {
            this.dom.audioJitter.textContent = `抖动: ${jitter ? jitter + 'ms' : '--'}`;
        }
        if (this.dom.audioSampleRate) {
            this.dom.audioSampleRate.textContent = `采样率: ${sampleRate ? (sampleRate / 1000) + 'kHz' : '--'}`;
        }
    }

    /** ===================== UI ===================== */

    updateStatus(text) {
        if (this.dom.statusEl) this.dom.statusEl.textContent = text;
        // 同步全屏悬浮框（仅主连接对应的全屏使用 lastStats，状态文本不强制）
    }

    resetStatusUI() {
        if (this.dom.qualityIndicator) {
            this.dom.qualityIndicator.classList.remove('quality-good', 'quality-medium', 'quality-poor');
        }
        if (this.dom.qualityText) this.dom.qualityText.textContent = '--';
        if (this.dom.audioStatus) this.dom.audioStatus.textContent = '音频: --';
        if (this.dom.audioJitter) this.dom.audioJitter.textContent = '抖动: --';
        if (this.dom.audioSampleRate) this.dom.audioSampleRate.textContent = '采样率: --';
        if (this.dom.audioBarFill) this.dom.audioBarFill.style.width = '0%';
        if (this.dom.audioWaveBars) {
            this.dom.audioWaveBars.forEach(bar => bar.style.height = '2px');
        }
        this._lastQuality = null;
    }

    /**
     * 由播放器的全局音频可视化定时器驱动；两路共用一个 200ms 节拍。
     */
    updateAudioVisual(level) {
        if (!this.dom.audioStatus) return;
        const statusText = level > 0.01 ? '正常' : (level > 0 ? '静音' : '--');
        this.dom.audioStatus.textContent = `音频: ${statusText}`;

        const mode = this.player.audioVisualMode;
        if (mode === 'none') return;

        const percentage = Math.min(100, Math.round(level * 100));

        if (mode === 'bar' && this.dom.audioBarFill) {
            this.dom.audioBarFill.style.width = percentage + '%';
        } else if (mode === 'wave' && this.dom.audioWaveBars) {
            // 用稳定相位而非 Math.random()：视觉反映真实音量、无随机闪烁
            this.dom.audioWaveBars.forEach((bar, i) => {
                const phase = (i / this.dom.audioWaveBars.length) * Math.PI;
                const factor = 0.55 + 0.45 * Math.sin(phase); // 各柱高度有节奏但确定性
                const height = Math.max(2, percentage * factor * 0.12);
                bar.style.height = height + 'px';
            });
        }
    }

    refreshAudioVisualDisplay() {
        const mode = this.player.audioVisualMode;
        if (this.dom.audioBar) this.dom.audioBar.style.display = mode === 'bar' ? 'block' : 'none';
        if (this.dom.audioWave) this.dom.audioWave.style.display = mode === 'wave' ? 'flex' : 'none';
        if (mode === 'wave' && this.dom.audioWaveBars) {
            this.dom.audioWaveBars.forEach(bar => bar.style.height = '2px');
        }
    }

    get isFullscreenHost() {
        return this.key === 'main';
    }

    get videoEl() {
        return this.dom.video;
    }
}

/**
 * 主播放器：持有两个 StreamSlot，做 UI 绑定与委托。
 * 不再为分屏写任何"2 后缀"的并行方法。
 */
class JiBaJiBaPlayer {
    constructor() {
        this.currentUrl = null;
        this.isFullscreen = false;
        this.fullscreenTimeout = null;

        // DOM 缓存对象 - 统一存储所有 DOM 引用
        this.dom = {};

        // 初始化 DOM 缓存（不含分屏相关字段，分屏 DOM 由 StreamSlot 自取）
        this._initDOMCache();

        this.currentServer = '10.126.126.10';
        this.checkOnlineBeforeConnect = localStorage.getItem('checkOnlineBeforeConnect') !== 'false';
        this.connectionTarget = 'main';
        this.audioVisualMode = localStorage.getItem('audioVisualMode') || 'none';

        this.presetChannels = [
            { name: '[直播] JOYG', img: '../assets/joyg.webp', stream: 'JOYG' },
            { name: '[直播] CMHH', img: '../assets/cmhh.webp', stream: 'CMHH' },
            { name: '[直播] Pure1ove', img: '../assets/pl.webp', stream: 'PL' },
            { name: '[直播] DJ_Hero', img: '../assets/ljy.webp', stream: 'LJY' },
            { name: '[直播] REDguard', img: '../assets/aaa.webp', stream: 'AAA' },
            { name: '[直播] KSK', img: '../assets/ksk.webp', stream: 'KSK' }
        ];

        this.rememberChannel = false;
        this.autoChannel = '';
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        this.maxReconnectDelay = 30000;

        this._loadRememberSettings();

        // 两个 slot 完全对称：都启用完整 stats / 重连 / ICE 恢复
        const reconnectConfig = {
            maxReconnectAttempts: this.maxReconnectAttempts,
            reconnectDelay: this.reconnectDelay,
            maxReconnectDelay: this.maxReconnectDelay
        };
        this.slots = {
            main: new StreamSlot(this, 'main', reconnectConfig),
            split: new StreamSlot(this, 'split', reconnectConfig)
        };

        this._initTheme();
        this._bindUI();
        this._loadPresetChannels();
        this._loadHistory();
        this._initStreamStatus();
        this._updateAudioVisualDisplay();
        this.updateStatus('就绪 - 点击频道或输入房间号开始播放');
    }

    /**
     * 初始化 DOM 缓存 - 集中管理所有非分屏的 DOM 元素引用
     */
    _initDOMCache() {
        // 控制按钮
        this.dom.connectBtn = document.getElementById('connectBtn');
        this.dom.refreshBtn = document.getElementById('refreshBtn');
        this.dom.disconnectBtn = document.getElementById('disconnectBtn');
        this.dom.splitScreenBtn = document.getElementById('splitScreenBtn');
        this.dom.closeSplitBtn = document.getElementById('closeSplitBtn');
        this.dom.refreshBtn2 = document.getElementById('refreshBtn2');
        this.dom.disconnectBtn2 = document.getElementById('disconnectBtn2');
        this.dom.fullscreenBtn = document.getElementById('fullscreenBtn');
        this.dom.roomInput = document.getElementById('roomInput');
        this.dom.presetContainer = document.getElementById('presetContainer');
        this.dom.historyContainer = document.getElementById('historyContainer');
        this.dom.clearHistoryBtn = document.getElementById('clearHistoryBtn');
        this.dom.refreshPresetBtn = document.getElementById('refreshPresetBtn');
        this.dom.refreshHistoryBtn = document.getElementById('refreshHistoryBtn');

        // 主题相关
        this.dom.favicon = document.getElementById('favicon');

        // 设置面板
        this.dom.settingsPanel = document.getElementById('settingsPanel');
        this.dom.settingsPanelOverlay = document.getElementById('settingsPanelOverlay');
        this.dom.settingsBtn = document.getElementById('settingsBtn');
        this.dom.settingsPanelClose = document.getElementById('settingsPanelClose');
        this.dom.settingsServerSelect = document.getElementById('settingsServerSelect');
        this.dom.settingsCheckOnline = document.getElementById('settingsCheckOnline');
        this.dom.settingsRememberChannel = document.getElementById('settingsRememberChannel');
        this.dom.settingsAutoChannel = document.getElementById('settingsAutoChannel');
        this.dom.settingsMaxAttempts = document.getElementById('settingsMaxAttempts');
        this.dom.settingsReconnectDelay = document.getElementById('settingsReconnectDelay');
        this.dom.settingsMaxDelay = document.getElementById('settingsMaxDelay');

        // 关于弹窗
        this.dom.aboutModal = document.getElementById('aboutModal');
        this.dom.aboutLink = document.getElementById('aboutLink');
        this.dom.aboutModalClose = document.getElementById('aboutModalClose');

        // 视频容器
        this.dom.videoContainer1 = document.getElementById('videoContainer1');
        this.dom.videoContainer2 = document.getElementById('videoContainer2');
        this.dom.videoWrapper = document.querySelector('.videoWrapper');

        // 目标选择按钮、分段控件
        this.dom.targetBtns = document.querySelectorAll('.target-btn');
        this.dom.themeSegmentItems = document.querySelectorAll('.theme-segment-item');
        this.dom.audioVisualSegmentItems = document.querySelectorAll('.audio-visual-segment-item');
    }

    /**
     * 获取主连接的 DOM 元素（兼容旧代码访问：video / statusEl 等）
     */
    get video() { return this.slots.main.dom.video; }
    get statusEl() { return this.slots.main.dom.statusEl; }

    /**
     * ===================== 委托：连接控制 =====================
     * 所有成对的操作塌缩成对目标 slot 的单次委托。
     */
    async connectStream(url, skipOnlineCheck = false) {
        return this.slots[this.connectionTarget].connect(url, skipOnlineCheck);
    }

    refresh()  { this.slots.main.refresh(); }
    refresh2() { this.slots.split.refresh(); }

    disconnect()  { this.slots.main.disconnect({ clearSaved: true }); }
    disconnect2() { this.slots.split.disconnect(); }

    // 提供给旧的全屏代码使用
    get pc() { return this.slots.main.pc; }
    get currentUrl2() { return this.slots.split.currentUrl; }
    _startStats() { /* 由 slot 内部自动启动，保留空实现以兼容 */ }

    /**
     * ===================== 频道按钮 =====================
     */
    _loadPresetChannels() {
        this.dom.presetContainer.innerHTML = '';
        this.presetChannels.forEach((ch, index) => {
            const url = this._buildStreamUrl(ch.stream);
            const btn = this._createChannelButton(ch.name, ch.img, url, false);
            btn.setAttribute('data-hotkey', index + 1);
            this.dom.presetContainer.appendChild(btn);
        });
        // 同步填充设置面板的"启动时自动开启"下拉，数据源与预设频道保持单一
        this._populateAutoChannelSelect();
    }

    _populateAutoChannelSelect() {
        const select = this.dom.settingsAutoChannel;
        if (!select) return;
        // 保留首个"无"占位项，清掉其余动态项
        const placeholder = select.querySelector('option[value=""]');
        select.innerHTML = '';
        if (placeholder) select.appendChild(placeholder);
        else {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = '无';
            select.appendChild(opt);
        }
        this.presetChannels.forEach(ch => {
            const opt = document.createElement('option');
            opt.value = ch.stream;
            opt.textContent = ch.name.replace(/^\[直播\]\s*/, '');
            select.appendChild(opt);
        });
    }

    _buildStreamUrl(stream) {
        return `http://${this.currentServer}:1985/rtc/v1/whep/?app=live&stream=${stream}`;
    }

    _extractStreamName(url) {
        if (!url) return null;
        const match = url.match(/stream=([^&]+)/);
        return match ? match[1] : null;
    }

    _createChannelButton(name, img, url, manual = false) {
        const btn = document.createElement('button');
        btn.className = 'button_play' + (manual ? ' manual' : '');
        btn.type = 'button';
        btn.addEventListener('click', () => this.connectStream(url));
        btn.addEventListener('mousedown', () => btn.classList.add('pressed'));
        btn.addEventListener('mouseup', () => btn.classList.remove('pressed'));
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
            this.dom.historyContainer.appendChild(btn);
        }

        return btn;
    }

    generateUrl(room) {
        if (!room) return null;
        return this._buildStreamUrl(room);
    }

    connectRoom() {
        const room = this.dom.roomInput.value.trim();
        if (!room) return;
        const url = this.generateUrl(room);
        if (!url) return;
        this.connectStream(url);
        this.addManualChannel(room, url);
    }

    addManualChannel(name, url) {
        const historyContainer = this.dom.historyContainer;
        const maxHistory = 8;

        // 历史按"最新在前"展示：满了先删最旧（firstChild）腾位，再把新条目 append 到末尾时
        // 我们其实是想保留最近的。这里保持原有 append 顺序但修掉删除方向 bug。
        // 由于历史是 append 顺序（从旧到新），满时删除 firstChild（最旧）即可。
        while (historyContainer.children.length >= maxHistory) {
            historyContainer.removeChild(historyContainer.firstChild);
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
            this.dom.historyContainer.querySelectorAll('.button_play.manual').forEach(btn => {
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

    /**
     * ===================== 设置 / 自动连接 =====================
     */
    _loadRememberSettings() {
        const savedSettings = localStorage.getItem('jiBaJiBa_settings');
        if (savedSettings) {
            try {
                const settings = JSON.parse(savedSettings);
                this.currentServer = settings.server || '10.126.126.10';
                this.rememberChannel = settings.rememberChannel || false;
                this.autoChannel = settings.autoChannel || '';
                this.maxReconnectAttempts = settings.maxReconnectAttempts || 5;
                this.reconnectDelay = settings.reconnectDelay || 1000;
                this.maxReconnectDelay = settings.maxReconnectDelay || 30000;
            } catch (e) {
                console.log('加载设置失败');
            }
        }

        // 防御历史的 "undefined" 字面量（旧版本可能写入过）
        const rememberEnabled = localStorage.getItem('jibajiba_remember') === 'true';
        const savedAutoChannel = localStorage.getItem('jibajiba_auto_channel') || '';
        const safeAutoChannel = savedAutoChannel === 'undefined' ? '' : savedAutoChannel;

        if (rememberEnabled) {
            const savedChannel = localStorage.getItem('jibajiba_last_channel');
            if (savedChannel) {
                const streamName = this._extractStreamName(savedChannel);
                this._tryAutoConnect(streamName, savedChannel, '记住的频道');
            }
        } else if (safeAutoChannel) {
            const url = this._buildStreamUrl(safeAutoChannel);
            this._tryAutoConnect(safeAutoChannel, url, '预设频道');
        }
    }

    async _tryAutoConnect(streamName, url, source) {
        this.updateStatus(`检测${source}在线状态...`);

        if (window.StreamStatusManager) {
            await window.StreamStatusManager.fetchStatus();
            const isOnline = window.StreamStatusManager.isOnline(streamName);

            if (isOnline) {
                console.log(`[${source}] ${streamName} 在线，开始连接`);
                this.connectStream(url);
            } else {
                console.log(`[${source}] ${streamName} 不在线，取消自动连接`);
                this.updateStatus(`${source} ${streamName} 不在线，取消自动连接`);
            }
        } else {
            console.error('[StreamStatus] 模块未加载');
            this.updateStatus('状态检测模块未加载');
        }
    }

    _saveCurrentChannel() {
        if (this.slots.main.currentUrl && this.rememberChannel) {
            localStorage.setItem('jibajiba_last_channel', this.slots.main.currentUrl);
        }
    }

    _clearSavedChannel() {
        localStorage.removeItem('jibajiba_last_channel');
    }

    clearHistory() {
        this.dom.historyContainer.innerHTML = '';
        localStorage.removeItem('jibajiba_history');
        this.updateStatus('历史记录已清空');
    }

    /**
     * ===================== 频道在线状态 =====================
     */
    async refreshPresetStatus() {
        if (!window.StreamStatusManager) return;
        await window.StreamStatusManager.fetchStatus();
        const status = window.StreamStatusManager.getAllStatus();
        this._updatePresetStatusIndicators(status);
    }

    async refreshHistoryStatus() {
        if (!window.StreamStatusManager) return;
        await window.StreamStatusManager.fetchStatus();
        const status = window.StreamStatusManager.getAllStatus();
        this._updateHistoryStatusIndicators(status);
    }

    _updatePresetStatusIndicators(status) {
        const indicators = this.dom.presetContainer?.querySelectorAll('.status-indicator[streamname]');
        if (!indicators) return;
        indicators.forEach(indicator => {
            const streamName = indicator.getAttribute('streamname');
            const streamStatus = status && status[streamName];
            this._setIndicatorStyle(indicator, streamStatus);
        });
    }

    _updateHistoryStatusIndicators(status) {
        const indicators = this.dom.historyContainer?.querySelectorAll('.status-indicator[streamname]');
        if (!indicators) return;
        indicators.forEach(indicator => {
            const streamName = indicator.getAttribute('streamname');
            const streamStatus = status && status[streamName];
            this._setIndicatorStyle(indicator, streamStatus);
        });
    }

    _setIndicatorStyle(indicator, streamStatus) {
        if (streamStatus && streamStatus.active) {
            indicator.style.background = '#00aa00';
            indicator.style.boxShadow = '0 0 20px #00ff00';
        } else {
            indicator.style.background = '#ff0000';
            indicator.style.boxShadow = '0 0 20px #ff0000';
        }
    }

    /**
     * ===================== 流状态轮询 =====================
     */
    _initStreamStatus() {
        if (window.StreamStatusManager) {
            window.StreamStatusManager.setServer(this.currentServer);
            window.StreamStatusManager.startPolling(10000);
            window.StreamStatusManager.onStatusChange((status) => {
                this._updateChannelStatusIndicators(status);
            });
        }
    }

    _updateChannelStatusIndicators(status) {
        const indicators = document.querySelectorAll('.status-indicator[streamname]');
        indicators.forEach(indicator => {
            const streamName = indicator.getAttribute('streamname');
            const streamStatus = status && status[streamName];
            this._setIndicatorStyle(indicator, streamStatus);
        });
    }

    /**
     * ===================== 音频可视化显示切换 =====================
     * 可视化的实时刷新已并入每路 slot 的 _startStats（1s 节拍）；
     * 不再有独立 200ms 音频定时器。
     */

    _updateAudioVisualDisplay() {
        this.slots.main.refreshAudioVisualDisplay();
        this.slots.split.refreshAudioVisualDisplay();
    }

    /**
     * ===================== 主题 =====================
     */
    _initTheme() {
        this.currentTheme = window.ThemeManager ? window.ThemeManager.getTheme() : 'auto';
        this._syncThemeSegment();
        this._updateFavicon(this._getEffectiveTheme());

        window.addEventListener('themechange', (e) => {
            this.currentTheme = e.detail.theme;
            this._syncThemeSegment();
            this._updateFavicon(this._getEffectiveTheme());
        });
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
    }

    _updateFavicon(theme) {
        const favicon = this.dom.favicon;
        if (!favicon) return;

        const icons = {
            dark: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'><path fill='%23FFF' d='M96.7 270.3C49 360.7 10 435 10 435.3c0 .4 16.5.6 36.6.5l36.6-.3 50-94.5c27.5-52 51.5-97.4 53.4-101l3.5-6.5-.4 89.5-.4 89.5 15.8 11.8 15.8 11.7h192.4l15.8-11.7 15.8-11.8.1-147c0-88.9-.4-146.5-.9-146-.5.6-15.6 26.2-33.6 57l-32.6 55.9.1 58.8V350H257V106h-73.5z'/><path fill='maroon' d='M370.3 107.2c-.5.7-24.2 41.4-52.7 90.5l-51.7 89.1-.2 26.6-.2 26.6 21.7-.2 21.7-.3 67.4-116 67.4-116-15.6-.6c-29.6-1.2-56.8-1-57.8.3'/></svg>",
            light: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'><path d='M96.7 270.3C49 360.7 10 435 10 435.3c0 .4 16.5.6 36.6.5l36.6-.3 50-94.5c27.5-52 51.5-97.4 53.4-101l3.5-6.5-.4 89.5-.4 89.5 15.8 11.8 15.8 11.7h192.4l15.8-11.7 15.8-11.8.1-147c0-88.9-.4-146.5-.9-146-.5.6-15.6 26.2-33.6 57l-32.6 55.9.1 58.8V350H257V106h-73.5z'/><path fill='maroon' d='M370.3 107.2c-.5.7-24.2 41.4-52.7 90.5l-51.7 89.1-.2 26.6-.2 26.6 21.7-.2 21.7-.3 67.4-116 67.4-116-15.6-.6c-29.6-1.2-56.8-1-57.8.3'/></svg>"
        };

        const svg = icons[theme] || icons.dark;
        favicon.href = `data:image/svg+xml,${svg}`;
    }

    _syncThemeSegment() {
        const items = this.dom.themeSegmentItems;
        if (!items || !items.length) return;
        items.forEach(item => {
            item.classList.toggle('active', item.dataset.theme === this.currentTheme);
        });
        const segment = document.querySelector('.theme-segment');
        if (segment) segment.dataset.selected = this.currentTheme;
    }

    /**
     * ===================== UI 绑定 =====================
     */
    _bindUI() {
        const {
            connectBtn, refreshBtn, disconnectBtn, fullscreenBtn,
            splitScreenBtn, closeSplitBtn, refreshBtn2, disconnectBtn2,
            settingsBtn, settingsPanelClose, settingsPanelOverlay,
            aboutLink, aboutModalClose, aboutModal,
            clearHistoryBtn, refreshPresetBtn, refreshHistoryBtn,
            roomInput, targetBtns
        } = this.dom;

        connectBtn?.addEventListener('click', () => this.connectRoom());
        refreshBtn?.addEventListener('click', () => this.refresh());
        disconnectBtn?.addEventListener('click', () => this.disconnect());
        fullscreenBtn?.addEventListener('click', () => this.toggleFullscreen());
        splitScreenBtn?.addEventListener('click', () => this.toggleSplitScreen());
        closeSplitBtn?.addEventListener('click', () => this.closeSplitScreen());
        refreshBtn2?.addEventListener('click', () => this.refresh2());
        disconnectBtn2?.addEventListener('click', () => this.disconnect2());
        settingsBtn?.addEventListener('click', () => this.openSettingsPanel());
        settingsPanelClose?.addEventListener('click', () => this.closeSettingsPanel());
        settingsPanelOverlay?.addEventListener('click', () => this.closeSettingsPanel());
        aboutLink?.addEventListener('click', () => this.openAboutModal());
        aboutModalClose?.addEventListener('click', () => this.closeAboutModal());
        aboutModal?.addEventListener('click', (e) => {
            if (e.target === aboutModal) this.closeAboutModal();
        });
        clearHistoryBtn?.addEventListener('click', () => this.clearHistory());
        refreshPresetBtn?.addEventListener('click', () => this.refreshPresetStatus());
        refreshHistoryBtn?.addEventListener('click', () => this.refreshHistoryStatus());

        if (targetBtns) {
            targetBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    targetBtns.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    this.connectionTarget = btn.dataset.target;
                });
            });
        }

        roomInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.connectRoom(); });

        // 设置面板内的分段控件只在打开时绑定一次
        // （_initThemeSegment / _initAudioVisualSegment 仍每次 openSettingsPanel 调用以同步当前值，
        //  但点击处理逻辑在 _bindSettingsSegments 中绑定一次）
        this._bindSettingsSegments();

        document.addEventListener('keydown', (e) => {
            // 输入控件聚焦时不响应全局快捷键，避免误触断开/刷新
            const tag = e.target.tagName;
            if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
            // 设置/关于弹窗打开时不响应
            if (this.dom.settingsPanel?.classList.contains('show')) return;
            if (this.dom.aboutModal?.classList.contains('show')) return;

            switch (e.key) {
                case 'f': case 'F':
                    if (!this.isFullscreen && (this.slots.main.videoEl?.srcObject || this.slots.main.videoEl?.src)) this.toggleFullscreen();
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

    _bindSettingsSegments() {
        // 主题分段
        const themeItems = this.dom.themeSegmentItems;
        const themeSegment = document.querySelector('.theme-segment');
        themeItems?.forEach(item => {
            item.onclick = () => {
                const theme = item.dataset.theme;
                themeItems.forEach(i => i.classList.remove('active'));
                item.classList.add('active');
                if (themeSegment) themeSegment.dataset.selected = theme;
                this.setTheme(theme);
            };
        });

        // 音频可视化分段
        const avItems = this.dom.audioVisualSegmentItems;
        const avSegment = document.querySelector('.audio-visual-segment');
        avItems?.forEach(item => {
            item.onclick = () => {
                const mode = item.dataset.visual;
                avItems.forEach(i => i.classList.remove('active'));
                item.classList.add('active');
                if (avSegment) avSegment.dataset.selected = mode;

                this.audioVisualMode = mode;
                localStorage.setItem('audioVisualMode', mode);
                this._updateAudioVisualDisplay();
            };
        });
    }

    /**
     * ===================== 分屏 =====================
     */
    toggleSplitScreen() {
        const { videoWrapper, videoContainer2, splitScreenBtn } = this.dom;

        if (videoContainer2 && videoContainer2.style.display === 'none') {
            videoContainer2.style.display = 'flex';
            videoWrapper?.classList.add('split-mode');
            if (splitScreenBtn) splitScreenBtn.textContent = '关闭分屏';
        } else {
            this.closeSplitScreen();
        }
    }

    closeSplitScreen() {
        const { videoWrapper, videoContainer2, splitScreenBtn } = this.dom;

        this.disconnect2();
        if (videoContainer2) videoContainer2.style.display = 'none';
        videoWrapper?.classList.remove('split-mode');
        if (splitScreenBtn) splitScreenBtn.textContent = '分屏';
    }

    /**
     * ===================== 全屏 =====================
     */
    toggleFullscreen() {
        if (!this.isFullscreen) {
            const overlay = document.createElement('div');
            overlay.className = 'fullscreen-mode';
            overlay.id = 'fullscreenContainer';

            const videoWrapper = document.createElement('div');
            videoWrapper.style.cssText = 'width:100%;height:100%;display:flex;justify-content:center;align-items:center;';

            const mainVideo = this.slots.main.videoEl;
            mainVideo.style.display = 'block';
            mainVideo.style.width = '100%';
            mainVideo.style.height = '100%';
            mainVideo.style.objectFit = 'contain';
            videoWrapper.appendChild(mainVideo);

            overlay.appendChild(videoWrapper);
            document.body.appendChild(overlay);

            // 参数显示悬浮框
            const statsBox = document.createElement('div');
            statsBox.className = 'fullscreen-stats';
            statsBox.id = 'fsStatsBox';
            statsBox.innerHTML = `
                <div class="fullscreen-stats-item">
                    <span class="fullscreen-stats-label">延迟:</span>
                    <span class="fullscreen-stats-value" id="fsLatency">-</span>
                </div>
                <div class="fullscreen-stats-item">
                    <span class="fullscreen-stats-label">丢包:</span>
                    <span class="fullscreen-stats-value" id="fsPacketLoss">-</span>
                </div>
                <div class="fullscreen-stats-item">
                    <span class="fullscreen-stats-label">带宽:</span>
                    <span class="fullscreen-stats-value" id="fsBandwidth">-</span>
                </div>
                <div class="fullscreen-stats-item">
                    <span class="fullscreen-stats-label">流状态:</span>
                    <span class="fullscreen-stats-value" id="fsStreamStatus">-</span>
                </div>
                <button class="fullscreen-stats-lock" id="fsStatsLock" type="button">🔓</button>
            `;
            overlay.appendChild(statsBox);

            const updateStats = () => {
                const latencyEl = document.getElementById('fsLatency');
                const packetLossEl = document.getElementById('fsPacketLoss');
                const bandwidthEl = document.getElementById('fsBandwidth');
                const streamStatusEl = document.getElementById('fsStreamStatus');
                const stats = this.slots.main.lastStats || {};

                if (latencyEl) latencyEl.textContent = stats.rtt || '-';
                if (packetLossEl) packetLossEl.textContent = stats.loss || '-';
                if (bandwidthEl) bandwidthEl.textContent = stats.bitrate || '-';
                if (streamStatusEl && window.StreamStatusManager) {
                    const status = window.StreamStatusManager.getAllStatus();
                    const onlineCount = Object.values(status).filter(s => s.active).length;
                    streamStatusEl.textContent = `${onlineCount}/${Object.keys(status).length}`;
                }
            };

            this.fsStatsInterval = setInterval(updateStats, 1000);
            updateStats();

            const lockBtn = document.getElementById('fsStatsLock');
            let isLocked = false;
            lockBtn.addEventListener('click', () => {
                isLocked = !isLocked;
                statsBox.classList.toggle('locked', isLocked);
                lockBtn.classList.toggle('locked', isLocked);
                lockBtn.textContent = isLocked ? '🔒' : '🔓';
            });

            overlay.addEventListener('mousemove', (e) => {
                if (isLocked) return;
                statsBox.classList.toggle('show', e.clientY < 50);
            });

            statsBox.addEventListener('mouseenter', () => statsBox.classList.add('show'));
            statsBox.addEventListener('mouseleave', () => {
                if (!isLocked) statsBox.classList.remove('show');
            });

            // 左侧控制面板
            const leftSidebar = document.createElement('div');
            leftSidebar.className = 'fullscreen-sidebar';
            leftSidebar.id = 'fsLeftSidebar';
            leftSidebar.innerHTML = `
                <button id="fsRefreshBtn" title="刷新" type="button"><span>🔄</span><span>刷新</span></button>
                <button id="fsDisconnectBtn" title="断开" type="button"><span>⏹️</span><span>断开</span></button>
                <button id="fsExitBtn" title="退出全屏" type="button"><span>✕</span><span>退出</span></button>
            `;
            overlay.appendChild(leftSidebar);

            const leftTrigger = document.createElement('div');
            leftTrigger.className = 'fullscreen-sidebar-trigger';
            leftTrigger.id = 'fsLeftTrigger';
            overlay.appendChild(leftTrigger);

            // 右侧预设频道面板
            const rightSidebar = document.createElement('div');
            rightSidebar.className = 'fullscreen-preset-sidebar';
            rightSidebar.id = 'fsRightSidebar';

            this.dom.presetContainer.querySelectorAll('.button_play').forEach(btn => {
                const clone = document.createElement('button');
                clone.className = 'fullscreen-preset-btn';
                clone.type = 'button';
                const img = btn.querySelector('.head_img');
                const name = btn.querySelector('.channel_text')?.innerText || '';
                const statusIndicator = btn.querySelector('.status-indicator');
                const streamName = statusIndicator?.getAttribute('streamname') || '';

                if (img) {
                    const cloneImg = document.createElement('img');
                    cloneImg.src = img.src;
                    cloneImg.alt = name;
                    clone.appendChild(cloneImg);
                }
                const textDiv = document.createElement('div');
                textDiv.className = 'fullscreen-preset-btn-text';
                textDiv.textContent = name;
                clone.appendChild(textDiv);

                const statusDiv = document.createElement('div');
                statusDiv.className = 'fullscreen-preset-btn-status';
                if (window.StreamStatusManager && streamName) {
                    const isOnline = window.StreamStatusManager.isOnline(streamName);
                    statusDiv.textContent = isOnline ? '在线' : '离线';
                    statusDiv.classList.toggle('offline', !isOnline);
                } else {
                    statusDiv.textContent = '检测中...';
                }
                clone.appendChild(statusDiv);

                clone.addEventListener('click', () => {
                    btn.click();
                    rightSidebar.classList.remove('show');
                });
                rightSidebar.appendChild(clone);
            });

            overlay.appendChild(rightSidebar);

            const rightTrigger = document.createElement('div');
            rightTrigger.className = 'fullscreen-preset-trigger';
            rightTrigger.id = 'fsRightTrigger';
            overlay.appendChild(rightTrigger);

            document.getElementById('fsRefreshBtn').addEventListener('click', () => {
                if (this.slots.main.pc && this.slots.main.pc.connectionState === 'connected') {
                    this.disconnect();
                    setTimeout(() => this.connectStream(this.slots.main.currentUrl), 500);
                }
            });
            document.getElementById('fsDisconnectBtn').addEventListener('click', () => this.disconnect());
            document.getElementById('fsExitBtn').addEventListener('click', () => {
                this.isManualDisconnect = true;
                this.toggleFullscreen();
                this.isManualDisconnect = false;
            });

            leftTrigger.addEventListener('mouseenter', () => leftSidebar.classList.add('show'));
            leftSidebar.addEventListener('mouseleave', () => leftSidebar.classList.remove('show'));

            rightTrigger.addEventListener('mouseenter', () => rightSidebar.classList.add('show'));
            rightSidebar.addEventListener('mouseleave', () => rightSidebar.classList.remove('show'));

            if (this.dom.fullscreenBtn) this.dom.fullscreenBtn.textContent = '退出全屏';
            this.isFullscreen = true;
        } else {
            const overlay = document.getElementById('fullscreenContainer');
            if (overlay) {
                const videoWrapper = overlay.querySelector('div');
                const mainVideo = this.slots.main.videoEl;
                if (videoWrapper && mainVideo.parentElement === videoWrapper) {
                    videoWrapper.removeChild(mainVideo);
                }
                document.body.removeChild(overlay);
            }

            if (this.fsStatsInterval) {
                clearInterval(this.fsStatsInterval);
                this.fsStatsInterval = null;
            }

            const videoContainer = this.dom.videoContainer1;
            if (videoContainer && mainVideo.parentElement !== videoContainer) {
                videoContainer.insertBefore(mainVideo, videoContainer.firstChild);
            }
            mainVideo.style.width = '';
            mainVideo.style.height = '';
            mainVideo.style.objectFit = '';
            mainVideo.style.display = '';

            if (this.dom.fullscreenBtn) this.dom.fullscreenBtn.textContent = '网页全屏';
            this.isFullscreen = false;
        }
    }

    /**
     * ===================== 设置面板 =====================
     */
    openSettingsPanel() {
        const {
            settingsPanel, settingsPanelOverlay, settingsServerSelect,
            settingsCheckOnline, settingsRememberChannel, settingsAutoChannel,
            settingsMaxAttempts, settingsReconnectDelay, settingsMaxDelay
        } = this.dom;

        if (settingsServerSelect) settingsServerSelect.value = this.currentServer || '10.126.126.10';
        if (settingsCheckOnline) settingsCheckOnline.checked = this.checkOnlineBeforeConnect;
        if (settingsRememberChannel) settingsRememberChannel.checked = this.rememberChannel || false;
        if (settingsAutoChannel) {
            settingsAutoChannel.value = this.autoChannel || '';
            settingsAutoChannel.disabled = this.rememberChannel || false;
        }
        if (settingsMaxAttempts) settingsMaxAttempts.value = this.maxReconnectAttempts;
        if (settingsReconnectDelay) settingsReconnectDelay.value = this.reconnectDelay;
        if (settingsMaxDelay) settingsMaxDelay.value = this.maxReconnectDelay;

        // 同步分段控件当前选中态（点击处理已在 _bindSettingsSegments 绑一次）
        this._syncThemeSegment();
        this._syncAudioVisualSegment();

        if (settingsRememberChannel && settingsAutoChannel) {
            settingsRememberChannel.onchange = () => {
                settingsAutoChannel.disabled = settingsRememberChannel.checked;
                if (settingsRememberChannel.checked) {
                    settingsAutoChannel.value = '';
                }
            };
        }

        settingsPanel?.classList.add('show');
        settingsPanelOverlay?.classList.add('show');
    }

    _syncAudioVisualSegment() {
        const currentMode = this.audioVisualMode || 'none';
        const segment = document.querySelector('.audio-visual-segment');
        const items = this.dom.audioVisualSegmentItems;
        if (segment) segment.dataset.selected = currentMode;
        items?.forEach(item => {
            item.classList.toggle('active', item.dataset.visual === currentMode);
        });
    }

    closeSettingsPanel() {
        const {
            settingsPanel, settingsPanelOverlay, settingsServerSelect,
            settingsCheckOnline, settingsRememberChannel, settingsAutoChannel,
            settingsMaxAttempts, settingsReconnectDelay, settingsMaxDelay
        } = this.dom;

        settingsPanel?.classList.remove('show');
        settingsPanelOverlay?.classList.remove('show');

        if (settingsServerSelect) this.currentServer = settingsServerSelect.value;
        if (settingsCheckOnline) this.checkOnlineBeforeConnect = settingsCheckOnline.checked;
        if (settingsRememberChannel) this.rememberChannel = settingsRememberChannel.checked;
        if (settingsAutoChannel) this.autoChannel = settingsAutoChannel.value;
        if (settingsMaxAttempts) this.maxReconnectAttempts = parseInt(settingsMaxAttempts.value) || 5;
        if (settingsReconnectDelay) this.reconnectDelay = parseInt(settingsReconnectDelay.value) || 1000;
        if (settingsMaxDelay) this.maxReconnectDelay = parseInt(settingsMaxDelay.value) || 30000;

        if (window.StreamStatusManager) {
            window.StreamStatusManager.setServer(this.currentServer);
        }

        localStorage.setItem('checkOnlineBeforeConnect', this.checkOnlineBeforeConnect);
        localStorage.setItem('jiBaJiBa_settings', JSON.stringify({
            server: this.currentServer,
            rememberChannel: this.rememberChannel,
            autoChannel: this.autoChannel,
            maxReconnectAttempts: this.maxReconnectAttempts,
            reconnectDelay: this.reconnectDelay,
            maxReconnectDelay: this.maxReconnectDelay
        }));

        localStorage.setItem('jibajiba_remember', this.rememberChannel);

        // autoChannel 可能为空字符串或 undefined —— 空值就 remove，避免写入 "undefined"
        if (this.autoChannel) {
            localStorage.setItem('jibajiba_auto_channel', this.autoChannel);
        } else {
            localStorage.removeItem('jibajiba_auto_channel');
        }

        if (!this.rememberChannel) {
            localStorage.removeItem('jibajiba_last_channel');
        }

        // 把新的重连配置同步给两路 slot
        const cfg = {
            maxReconnectAttempts: this.maxReconnectAttempts,
            reconnectDelay: this.reconnectDelay,
            maxReconnectDelay: this.maxReconnectDelay
        };
        this.slots.main.updateReconnectConfig(cfg);
        this.slots.split.updateReconnectConfig(cfg);
    }

    openAboutModal() {
        this.dom.aboutModal?.classList.add('show');
    }

    closeAboutModal() {
        this.dom.aboutModal?.classList.remove('show');
    }

    updateStatus(text) { if (this.statusEl) this.statusEl.textContent = text; }
}

window.player = new JiBaJiBaPlayer();