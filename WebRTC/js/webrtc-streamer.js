(function() {
    let peerConnection = null;
    let localStream = null;
    let streamTimerInterval = null;
    let statsInterval = null;
    let streamStartTime = null;
    let isStreaming = false;
    let isConnecting = false;
    let currentSdpOffer = null;
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 5;
    const RECONNECT_DELAY = 2000;

    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    const domVideo = $('#previewVideo');
    const domVideoWrapper = $('#videoWrapper');
    const domVideoPlaceholder = $('#videoPlaceholder');
    const domVideoOverlay = $('#videoOverlay');
    const domStatusDot = $('#statusDot');
    const domStatusText = $('#statusText');
    const domStreamTimer = $('#streamTimer');
    const domStatusPill = $('#statusPill');
    const domBtnStart = $('#btnStart');
    const domBtnStop = $('#btnStop');
    const domLogContainer = $('#logContainer');
    const domToastContainer = $('#toastContainer');
    const domLocalSdpDisplay = $('#localSdpDisplay');
    const domRemoteSdpInput = $('#remoteSdpInput');
    const domManualSdpSection = $('#manualSdpSection');
    const domProtocolMode = $('#protocolMode');
    const domServerUrl = $('#serverUrl');
    const domStreamKey = $('#streamKey');
    const domAuthHeader = $('#authHeader');
    const domSourceType = $('#sourceType');
    const domCameraSettings = $('#cameraSettings');
    const domScreenSettings = $('#screenSettings');
    const domCameraDevice = $('#cameraDevice');
    const domResolution = $('#resolution');
    const domFrameRate = $('#frameRate');
    const domMaxBitrate = $('#maxBitrate');
    const domCodecPreference = $('#codecPreference');
    const domAudioDevice = $('#audioDevice');
    const domAudioBitrate = $('#audioBitrate');
    const domAudioEnabled = $('#audioEnabled');
    const domEchoCancellation = $('#echoCancellation');
    const domNoiseSuppression = $('#noiseSuppression');
    const domScreenAudio = $('#screenAudio');
    const domAutoReconnect = $('#autoReconnect');
    const domIceServersConfig = $('#iceServersConfig');

    const SETTINGS_KEY = 'webrtc_streamer_settings';

    const PERSIST_INPUTS = [
        '#protocolMode', '#serverUrl', '#streamKey', '#authHeader',
        '#sourceType', '#resolution', '#frameRate', '#codecPreference',
        '#iceServersConfig', '#maxBitrate', '#audioBitrate',
    ];
    const PERSIST_CHECKBOXES = [
        '#audioEnabled', '#echoCancellation', '#noiseSuppression',
        '#screenAudio', '#autoReconnect',
    ];
    const PERSIST_DEVICE_SELECTS = ['#cameraDevice', '#audioDevice'];

    function saveSettings() {
        const data = {};

        for (const sel of PERSIST_INPUTS) {
            const el = $(sel);
            if (el) data[sel] = el.value;
        }
        for (const sel of PERSIST_CHECKBOXES) {
            const el = $(sel);
            if (el) data[sel] = el.checked;
        }
        for (const sel of PERSIST_DEVICE_SELECTS) {
            const el = $(sel);
            if (el) data[sel] = el.value || '';
        }

        try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(data));
        } catch (e) {
            // localStorage may be full or unavailable
        }
    }

    function loadSettings() {
        let data;
        try {
            data = JSON.parse(localStorage.getItem(SETTINGS_KEY));
        } catch (e) {
            data = null;
        }
        if (!data || typeof data !== 'object') return;

        for (const sel of PERSIST_INPUTS) {
            if (data[sel] !== undefined) {
                const el = $(sel);
                if (el) el.value = data[sel];
            }
        }
        for (const sel of PERSIST_CHECKBOXES) {
            if (data[sel] !== undefined) {
                const el = $(sel);
                if (el) el.checked = data[sel];
            }
        }
        // device IDs are only restored if the device still exists
        // (they change per session/device, so we skip applying them here,
        //  but we still save them so the logic is consistent)
    }

    function initPersistence() {
        for (const sel of PERSIST_INPUTS) {
            const el = $(sel);
            if (el) el.addEventListener('input', saveSettings);
        }
        for (const sel of PERSIST_CHECKBOXES) {
            const el = $(sel);
            if (el) el.addEventListener('change', saveSettings);
        }
        for (const sel of PERSIST_DEVICE_SELECTS) {
            const el = $(sel);
            if (el) el.addEventListener('change', saveSettings);
        }
    }

    function now() { return new Date(); }
    function timeStr() { return now().toLocaleTimeString('zh-CN', { hour12: false }); }
    function addLog(msg, type = '') {
        const entry = document.createElement('div');
        entry.className = 'log-entry' + (type ? ' log-' + type : '');
        entry.innerHTML = `<span class="log-time">[${timeStr()}]</span>${msg}`;
        domLogContainer.appendChild(entry);
        domLogContainer.scrollTop = domLogContainer.scrollHeight;
    }
    function clearLogs() { domLogContainer.innerHTML = ''; addLog('日志已清空', 'info'); }
    function showToast(msg, type = 'info') {
        const toast = document.createElement('div');
        toast.className = 'toast ' + type;
        toast.textContent = msg;
        domToastContainer.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(40px)';
            toast.style.transition = 'all 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
    function updateStatus(state) {
        domStatusDot.className = 'status-dot ' + state;
        const stateMap = { idle: '待机中', connecting: '连接中...', live: '推流中', error: '连接错误' };
        domStatusText.textContent = stateMap[state] || state;
    }
    function setVideoWrapperState(state) {
        domVideoWrapper.classList.remove('live-active', 'connecting-active', 'error-active');
        if (state === 'live') domVideoWrapper.classList.add('live-active');
        if (state === 'connecting') domVideoWrapper.classList.add('connecting-active');
        if (state === 'error') domVideoWrapper.classList.add('error-active');
    }
    function formatDuration(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
        return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    }
    function startStreamTimer() {
        streamStartTime = Date.now();
        domStreamTimer.style.display = 'inline';
        domStreamTimer.textContent = '00:00';
        if (streamTimerInterval) clearInterval(streamTimerInterval);
        streamTimerInterval = setInterval(() => {
            if (streamStartTime) {
                const elapsed = (Date.now() - streamStartTime) / 1000;
                domStreamTimer.textContent = formatDuration(elapsed);
            }
        }, 500);
    }
    function stopStreamTimer() {
        if (streamTimerInterval) clearInterval(streamTimerInterval);
        streamTimerInterval = null;
        streamStartTime = null;
        domStreamTimer.style.display = 'none';
        domStreamTimer.textContent = '';
    }

    window.toggleCard = function(cardId) {
        const body = document.getElementById('body-' + cardId);
        const chevron = document.getElementById('chevron-' + cardId);
        if (!body || !chevron) return;
        const isCollapsed = body.classList.contains('collapsed');
        if (isCollapsed) {
            body.classList.remove('collapsed');
            chevron.classList.remove('rotated');
        } else {
            body.classList.add('collapsed');
            chevron.classList.add('rotated');
        }
    };

    async function enumerateDevices() {
        try {
            // 分别请求视频和音频权限，避免一者失败导致全部无法枚举
            try {
                const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
                videoStream.getTracks().forEach(t => t.stop());
            } catch (e) {
                addLog('摄像头权限未获取，可能无法显示设备标签', 'warn');
            }
            try {
                const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                audioStream.getTracks().forEach(t => t.stop());
            } catch (e) {
                addLog('麦克风权限未获取，可能无法显示设备标签', 'warn');
            }

            const devices = await navigator.mediaDevices.enumerateDevices();
            const videoDevices = devices.filter(d => d.kind === 'videoinput');
            const audioDevices = devices.filter(d => d.kind === 'audioinput');
            domCameraDevice.innerHTML = '';
            if (videoDevices.length === 0) {
                domCameraDevice.innerHTML = '<option value="">未检测到摄像头</option>';
            } else {
                videoDevices.forEach((d, i) => {
                    const opt = document.createElement('option');
                    opt.value = d.deviceId;
                    opt.textContent = d.label || `摄像头 ${i + 1}`;
                    domCameraDevice.appendChild(opt);
                });
            }
            domAudioDevice.innerHTML = '';
            if (audioDevices.length === 0) {
                domAudioDevice.innerHTML = '<option value="">未检测到麦克风</option>';
            } else {
                audioDevices.forEach((d, i) => {
                    const opt = document.createElement('option');
                    opt.value = d.deviceId;
                    opt.textContent = d.label || `麦克风 ${i + 1}`;
                    domAudioDevice.appendChild(opt);
                });
            }
        } catch (e) {
            addLog('枚举设备失败: ' + e.message, 'warn');
        }
    }
    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
        navigator.mediaDevices.addEventListener('devicechange', enumerateDevices);
    }

    async function getLocalStream() {
        if (localStream) {
            localStream.getTracks().forEach(t => t.stop());
            localStream = null;
        }

        const sourceType = domSourceType.value;
        const [width, height] = domResolution.value.split('x').map(Number);
        const fps = parseInt(domFrameRate.value);
        const audioEnabled = domAudioEnabled.checked;
        const echoCancellation = domEchoCancellation.checked;
        const noiseSuppression = domNoiseSuppression.checked;
        const cameraDeviceId = domCameraDevice.value;
        const audioDeviceId = domAudioDevice.value;
        const screenAudio = domScreenAudio.checked;

        let videoStream = null;
        let audioStream = null;

        if (sourceType === 'camera') {
            const videoConstraints = {
                width: { ideal: width },
                height: { ideal: height },
                frameRate: { ideal: fps },
            };
            if (cameraDeviceId) videoConstraints.deviceId = { exact: cameraDeviceId };

            try {
                videoStream = await navigator.mediaDevices.getUserMedia({
                    video: videoConstraints,
                    audio: false,
                });
                addLog(`摄像头已就绪: ${width}×${height} @ ${fps}fps`, 'success');
            } catch (e) {
                addLog('获取摄像头失败: ' + e.message, 'error');
                showToast('无法访问摄像头', 'error');
                throw e;
            }

            if (audioEnabled) {
                try {
                    const audioConstraints = {
                        echoCancellation,
                        noiseSuppression,
                        autoGainControl: true,
                    };
                    if (audioDeviceId) audioConstraints.deviceId = { exact: audioDeviceId };
                    audioStream = await navigator.mediaDevices.getUserMedia({
                        video: false,
                        audio: audioConstraints,
                    });
                    addLog('麦克风已就绪', 'success');
                } catch (e) {
                    addLog('获取麦克风失败 (将继续无音频推流): ' + e.message, 'warn');
                    showToast('无法访问麦克风，将仅推送视频', 'warn');
                }
            }
        } else if (sourceType === 'screen') {
            try {
                const screenConstraints = {
                    video: {
                        width: { ideal: width },
                        height: { ideal: height },
                        frameRate: { ideal: fps },
                    },
                    audio: screenAudio,
                };
                videoStream = await navigator.mediaDevices.getDisplayMedia(screenConstraints);
                addLog(`屏幕共享已就绪: ${width}×${height} @ ${fps}fps`, 'success');

                const videoTrack = videoStream.getVideoTracks()[0];
                if (videoTrack) {
                    videoTrack.addEventListener('ended', () => {
                        addLog('屏幕共享已被用户停止', 'warn');
                        if (isStreaming) {
                            stopStreaming();
                            showToast('屏幕共享已停止，推流已中断', 'warn');
                        }
                        domVideoPlaceholder.style.display = 'flex';
                        domVideo.srcObject = null;
                    });
                }

                if (!screenAudio && audioEnabled) {
                    try {
                        const micConstraints = {
                            echoCancellation,
                            noiseSuppression,
                            autoGainControl: true,
                        };
                        if (audioDeviceId) micConstraints.deviceId = { exact: audioDeviceId };
                        audioStream = await navigator.mediaDevices.getUserMedia({
                            video: false,
                            audio: micConstraints,
                        });
                        addLog('麦克风已就绪（屏幕共享模式）', 'success');
                    } catch (e) {
                        addLog('获取麦克风失败 (屏幕共享将无音频): ' + e.message, 'warn');
                        showToast('无法访问麦克风，屏幕共享将只有画面', 'warn');
                    }
                } else if (screenAudio) {
                    addLog('屏幕共享包含系统音频', 'info');
                }
            } catch (e) {
                addLog('获取屏幕共享失败: ' + e.message, 'error');
                showToast('无法启动屏幕共享', 'error');
                throw e;
            }
        }

        const combinedTracks = [];
        if (videoStream) {
            videoStream.getTracks().forEach(t => combinedTracks.push(t));
        }
        if (audioStream) {
            audioStream.getTracks().forEach(t => combinedTracks.push(t));
        }

        const hasAudio = combinedTracks.some(track => track.kind === 'audio');
        if (!hasAudio) {
            try {
                const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                const silenceBuffer = audioContext.createBuffer(1, 1, 44100);
                const source = audioContext.createBufferSource();
                source.buffer = silenceBuffer;
                source.loop = true;
                const destination = audioContext.createMediaStreamDestination();
                source.connect(destination);
                source.start();
                const silenceTrack = destination.stream.getAudioTracks()[0];
                if (silenceTrack) {
                    silenceTrack.enabled = true;
                    combinedTracks.push(silenceTrack);
                    addLog('已添加静音音频轨道（确保流媒体兼容性）', 'info');
                }
            } catch (e) {
                addLog('创建静音音频失败: ' + e.message, 'warn');
            }
        }

        if (combinedTracks.length === 0) {
            throw new Error('未能获取任何媒体轨道');
        }

        localStream = new MediaStream(combinedTracks);
        domVideo.srcObject = localStream;
        domVideoPlaceholder.style.display = 'none';
        domVideoOverlay.innerHTML = '';

        return localStream;
    }

    function modifySdpBitrate(sdp, maxBitrateKbps, audioBitrateKbps) {
        let modifiedSdp = sdp;
        const videoBitrateLines = modifiedSdp.match(/m=video[\s\S]*?(?=m=|$)/g);
        if (videoBitrateLines) {
            videoBitrateLines.forEach(block => {
                if (/b=AS:\d+/.test(block)) {
                    modifiedSdp = modifiedSdp.replace(/b=AS:\d+/g, `b=AS:${maxBitrateKbps}`);
                } else {
                    modifiedSdp = modifiedSdp.replace(
                        /(m=video.*\r?\n)/,
                        `$1b=AS:${maxBitrateKbps}\r\n`
                    );
                }
                if (/b=TIAS:\d+/.test(modifiedSdp)) {
                    modifiedSdp = modifiedSdp.replace(/b=TIAS:\d+/g, `b=TIAS:${maxBitrateKbps * 1000}`);
                }
            });
        }
        if (audioBitrateKbps) {
            const audioBitrateLines = modifiedSdp.match(/m=audio[\s\S]*?(?=m=|$)/g);
            if (audioBitrateLines) {
                audioBitrateLines.forEach(block => {
                    if (/b=AS:\d+/.test(block)) {
                        const blockStart = modifiedSdp.indexOf(block);
                        const matchStart = modifiedSdp.indexOf('b=AS:', blockStart);
                        if (matchStart >= blockStart && matchStart < blockStart + block.length) {
                            modifiedSdp = modifiedSdp.replace(/b=AS:\d+/g, (match, offset) => {
                                if (offset === matchStart) return `b=AS:${audioBitrateKbps}`;
                                return match;
                            });
                        }
                    }
                });
            }
        }
        return modifiedSdp;
    }
    function setCodecPreferenceInSdp(sdp, preference) {
        if (preference === 'auto') return sdp;
        return sdp;
    }

    function createPeerConnection() {
        if (peerConnection) {
            peerConnection.close();
            peerConnection = null;
        }
        let iceServers;
        try {
            iceServers = JSON.parse(domIceServersConfig.value);
            if (!Array.isArray(iceServers)) iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
        } catch (e) {
            iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
            addLog('ICE配置解析失败，使用默认STUN服务器', 'warn');
        }
        const config = {
            iceServers,
            iceTransportPolicy: 'all',
            iceCandidatePoolSize: 2,
        };
        peerConnection = new RTCPeerConnection(config);
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                addLog(`ICE候选: ${event.candidate.type} ${event.candidate.protocol}`, 'info');
            }
        };
        peerConnection.oniceconnectionstatechange = () => {
            const state = peerConnection.iceConnectionState;
            addLog(`ICE连接状态: ${state}`, state === 'failed' || state === 'disconnected' ? 'warn' : 'info');
            $('#statIceState').textContent = state;
            if (state === 'connected' || state === 'completed') {
                updateStatus('live');
                setVideoWrapperState('live');
                isConnecting = false;
                reconnectAttempts = 0;
                if (!streamStartTime) startStreamTimer();
                const liveBadge = document.createElement('span');
                liveBadge.className = 'overlay-badge live-badge';
                liveBadge.textContent = '● LIVE';
                domVideoOverlay.innerHTML = '';
                domVideoOverlay.appendChild(liveBadge);
                showToast('推流连接成功！', 'success');
            } else if (state === 'failed') {
                updateStatus('error');
                setVideoWrapperState('error');
                isConnecting = false;
                addLog('ICE连接失败', 'error');
                handleConnectionFailure();
            } else if (state === 'disconnected') {
                addLog('ICE连接断开', 'warn');
                handleConnectionFailure();
            }
        };
        peerConnection.onconnectionstatechange = () => {
            const state = peerConnection.connectionState;
            addLog(`连接状态: ${state}`, state === 'failed' ? 'error' : 'info');
            if (state === 'failed') {
                handleConnectionFailure();
            }
        };
        peerConnection.onsignalingstatechange = () => {
            addLog(`信令状态: ${peerConnection.signalingState}`, 'info');
        };
        return peerConnection;
    }

    function handleConnectionFailure() {
        if (!isStreaming && !isConnecting) return;
        isConnecting = false;
        if (domAutoReconnect.checked && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++;
            addLog(`尝试自动重连 (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`, 'warn');
            updateStatus('connecting');
            setVideoWrapperState('connecting');
            setTimeout(() => {
                if (isStreaming || isConnecting) return;
                attemptReconnect();
            }, RECONNECT_DELAY);
        } else if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            addLog('达到最大重连次数，停止推流', 'error');
            stopStreaming();
            showToast('重连失败，已达到最大重试次数', 'error');
        }
    }
    async function attemptReconnect() {
        try {
            addLog('正在重新建立连接...', 'info');
            await startStreamingInternal();
        } catch (e) {
            addLog('重连失败: ' + e.message, 'error');
            handleConnectionFailure();
        }
    }

    async function startStreamingInternal() {
        if (isStreaming) {
            await stopStreamingInternal();
        }
        isConnecting = true;
        updateStatus('connecting');
        setVideoWrapperState('connecting');
        domVideoOverlay.innerHTML = '';
        reconnectAttempts = 0;
        if (!localStream || localStream.getTracks().length === 0) {
            await getLocalStream();
        }
        if (!localStream || localStream.getTracks().length === 0) {
            throw new Error('无可用媒体流');
        }
        const pc = createPeerConnection();
        localStream.getTracks().forEach(track => {
            if (track.readyState === 'live') {
                pc.addTrack(track, localStream);
                addLog(`添加轨道: ${track.kind} (${track.label || '未命名'})`, 'info');
            }
        });
        const codecPref = domCodecPreference.value;
        if (codecPref !== 'auto') {
            try {
                const transceivers = pc.getTransceivers();
                for (const transceiver of transceivers) {
                    if (transceiver.sender && transceiver.sender.track?.kind === 'video') {
                        const codecs = RTCRtpSender.getCapabilities('video')?.codecs || [];
                        const preferredCodec = codecs.find(c =>
                            c.mimeType.toLowerCase().includes(codecPref)
                        );
                        if (preferredCodec) {
                            transceiver.setCodecPreferences([preferredCodec]);
                            addLog(`设置视频编码器偏好: ${preferredCodec.mimeType}`, 'info');
                        }
                    }
                }
            } catch (e) {
                addLog('设置编码器偏好失败: ' + e.message, 'warn');
            }
        }
        const offerOptions = { offerToReceiveAudio: false, offerToReceiveVideo: false };
        const offer = await pc.createOffer(offerOptions);
        const maxBitrate = parseInt(domMaxBitrate.value) || 4000;
        const audioBitrate = parseInt(domAudioBitrate.value) || 128;
        let modifiedSdp = modifySdpBitrate(offer.sdp, maxBitrate, audioBitrate);
        modifiedSdp = setCodecPreferenceInSdp(modifiedSdp, codecPref);
        const modifiedOffer = { type: 'offer', sdp: modifiedSdp };
        await pc.setLocalDescription(modifiedOffer);
        addLog('本地SDP已生成 (Offer)', 'success');
        currentSdpOffer = modifiedSdp;
        const protocolMode = domProtocolMode.value;
        if (protocolMode === 'whip') {
            await sendWhipRequest(pc, modifiedSdp);
        } else {
            domLocalSdpDisplay.value = modifiedSdp;
            domManualSdpSection.style.display = 'block';
            addLog('请复制本地SDP Offer到服务器，并粘贴Answer', 'info');
            showToast('SDP已生成，请手动交换', 'info');
            isConnecting = false;
            updateStatus('idle');
            setVideoWrapperState('idle');
            return;
        }
        isStreaming = true;
        isConnecting = false;
        domBtnStart.style.display = 'none';
        domBtnStop.style.display = 'flex';
        startStatsMonitoring();
    }
    async function sendWhipRequest(pc, sdpOffer) {
        let serverUrl = domServerUrl.value.trim();
        const streamKey = domStreamKey.value.trim();
        const authHeader = domAuthHeader.value.trim();
        if (!serverUrl) {
            throw new Error('请输入服务器URL');
        }
        if (streamKey && !serverUrl.includes(streamKey)) {
            serverUrl = serverUrl.replace(/\/$/, '') + '/' + streamKey.replace(/^\//, '');
        }
        addLog(`WHIP请求: POST ${serverUrl}`, 'info');
        const headers = { 'Content-Type': 'application/sdp' };
        if (authHeader) {
            headers['Authorization'] = authHeader;
        }
        const response = await fetch(serverUrl, {
            method: 'POST',
            headers,
            body: sdpOffer,
        });
        if (!response.ok) {
            const errorBody = await response.text().catch(() => '');
            throw new Error(`WHIP请求失败: HTTP ${response.status} ${response.statusText}${errorBody ? ' - ' + errorBody : ''}`);
        }
        const answerSdp = await response.text();
        addLog('收到服务器SDP Answer', 'success');
        const answer = { type: 'answer', sdp: answerSdp };
        if (pc.signalingState !== 'have-local-offer') {
            addLog(`信令状态异常: ${pc.signalingState}，尝试恢复...`, 'warn');
        }
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        addLog('Remote SDP已设置', 'success');
        updateStatus('connecting');
        setVideoWrapperState('connecting');
    }
    async function startStreaming() {
        try {
            await startStreamingInternal();
        } catch (e) {
            addLog('推流启动失败: ' + e.message, 'error');
            showToast('推流失败: ' + e.message, 'error');
            updateStatus('error');
            setVideoWrapperState('error');
            isConnecting = false;
            isStreaming = false;
            stopStreamTimer();
        }
    }
    async function applyRemoteSdp() {
        const answerSdp = domRemoteSdpInput.value.trim();
        if (!answerSdp) {
            showToast('请粘贴服务器返回的SDP Answer', 'warn');
            return;
        }
        if (!peerConnection) {
            showToast('PeerConnection不存在，请重新生成Offer', 'error');
            return;
        }
        try {
            const answer = { type: 'answer', sdp: answerSdp };
            await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
            addLog('Remote SDP已手动应用', 'success');
            isStreaming = true;
            isConnecting = false;
            domBtnStart.style.display = 'none';
            domBtnStop.style.display = 'flex';
            updateStatus('connecting');
            setVideoWrapperState('connecting');
            startStatsMonitoring();
            showToast('SDP Answer已应用，等待ICE连接...', 'info');
        } catch (e) {
            addLog('应用Remote SDP失败: ' + e.message, 'error');
            showToast('SDP应用失败', 'error');
        }
    }
    async function stopStreamingInternal() {
        isStreaming = false;
        isConnecting = false;
        stopStreamTimer();
        stopStatsMonitoring();
        updateStatus('idle');
        setVideoWrapperState('idle');
        domVideoOverlay.innerHTML = '';
        domBtnStart.style.display = 'flex';
        domBtnStop.style.display = 'none';
        reconnectAttempts = 0;
        if (peerConnection) {
            try { peerConnection.close(); } catch (e) {}
            peerConnection = null;
        }
        addLog('推流已停止', 'info');
    }
    async function stopStreaming() {
        await stopStreamingInternal();
        if (localStream && localStream.active) {
            domVideo.srcObject = localStream;
        }
        showToast('推流已停止', 'info');
    }

    function startStatsMonitoring() {
        if (statsInterval) clearInterval(statsInterval);
        statsInterval = setInterval(async () => {
            if (!peerConnection || !isStreaming) return;
            try {
                const stats = await peerConnection.getStats();
                let bitrate = 0, fps = 0, resolution = '--', packetLoss = 0, rtt = 0;
                let totalPacketsLost = 0, totalPackets = 0;
                const nowMs = performance.now();
                stats.forEach(report => {
                    if (report.type === 'outbound-rtp' && report.kind === 'video') {
                        if (report.bytesSent !== undefined && report.timestamp) {
                            if (report._prevBytes && report._prevTimestamp) {
                                const bytesDelta = report.bytesSent - report._prevBytes;
                                const timeDelta = (report.timestamp - report._prevTimestamp) / 1000;
                                if (timeDelta > 0) {
                                    bitrate = Math.round((bytesDelta * 8) / timeDelta / 1000);
                                }
                            }
                            report._prevBytes = report.bytesSent;
                            report._prevTimestamp = report.timestamp;
                        }
                        if (report.framesPerSecond !== undefined) fps = Math.round(report.framesPerSecond);
                        if (report.frameWidth && report.frameHeight) resolution = `${report.frameWidth}×${report.frameHeight}`;
                        totalPacketsLost += report.packetsLost || 0;
                        totalPackets += report.packetsSent || 0;
                    }
                    if (report.type === 'outbound-rtp' && report.kind === 'audio') {
                        totalPacketsLost += report.packetsLost || 0;
                        totalPackets += report.packetsSent || 0;
                    }
                    if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                        if (report.currentRoundTripTime) rtt = Math.round(report.currentRoundTripTime * 1000);
                    }
                });
                if (totalPackets > 0) packetLoss = ((totalPacketsLost / totalPackets) * 100).toFixed(2);
                $('#statBitrate').textContent = bitrate > 0 ? bitrate : '--';
                $('#statFps').textContent = fps > 0 ? fps : '--';
                $('#statResolution').textContent = resolution;
                $('#statPacketLoss').textContent = packetLoss > 0 ? packetLoss + '%' : '0%';
                $('#statRtt').textContent = rtt > 0 ? rtt : '--';
                $('#statIceState').textContent = peerConnection.iceConnectionState || '--';
            } catch (e) {}
        }, 1500);
    }
    function stopStatsMonitoring() {
        if (statsInterval) clearInterval(statsInterval);
        statsInterval = null;
        $('#statBitrate').textContent = '--';
        $('#statFps').textContent = '--';
        $('#statResolution').textContent = '--';
        $('#statPacketLoss').textContent = '--';
        $('#statRtt').textContent = '--';
        $('#statIceState').textContent = '--';
    }

    function onProtocolChange() {
        const mode = domProtocolMode.value;
        domManualSdpSection.style.display = mode === 'manual' ? 'block' : 'none';
        if (mode === 'whip') {
            domLocalSdpDisplay.value = '';
            domRemoteSdpInput.value = '';
        }
    }
    function onSourceTypeChange() {
        const type = domSourceType.value;
        const isCamera = type === 'camera';
        domCameraSettings.style.display = isCamera ? 'block' : 'none';
        domScreenSettings.style.display = isCamera ? 'none' : 'block';
        // 屏幕共享不需要回声消除和降噪（针对系统音频）
        const echoRow = $('#echoCancellationRow');
        const noiseRow = $('#noiseSuppressionRow');
        if (echoRow) echoRow.style.display = isCamera ? 'flex' : 'none';
        if (noiseRow) noiseRow.style.display = isCamera ? 'flex' : 'none';
        if (localStream) {
            localStream.getTracks().forEach(t => t.stop());
            localStream = null;
        }
        domVideo.srcObject = null;
        domVideoPlaceholder.style.display = 'flex';
        domVideoOverlay.innerHTML = '';
    }
    window.onProtocolChange = onProtocolChange;
    window.onSourceTypeChange = onSourceTypeChange;
    window.applyRemoteSdp = applyRemoteSdp;
    window.startStreaming = startStreaming;
    window.stopStreaming = stopStreaming;
    window.clearLogs = clearLogs;

    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); if (!isStreaming) startStreaming(); }
        if (e.ctrlKey && e.key === 's') { e.preventDefault(); if (isStreaming) stopStreaming(); }
    });

    window.addEventListener('beforeunload', () => {
        if (localStream) { localStream.getTracks().forEach(t => t.stop()); }
        if (peerConnection) { peerConnection.close(); }
        stopStatsMonitoring();
        stopStreamTimer();
    });
    window.addEventListener('pagehide', () => {
        if (localStream) { localStream.getTracks().forEach(t => t.stop()); }
        if (peerConnection) { peerConnection.close(); }
        stopStatsMonitoring();
        stopStreamTimer();
    });

    async function init() {
        loadSettings();
        initPersistence();
        addLog('WebRTC 推流控制台已就绪', 'info');
        addLog('协议: ' + (domProtocolMode.value === 'whip' ? 'WHIP自动模式' : '手动SDP交换'), 'info');
        await enumerateDevices();
        onSourceTypeChange();
        onProtocolChange();
        updateStatus('idle');
        setVideoWrapperState('idle');
        $('#statIceState').textContent = 'idle';
    }
    init().catch(e => addLog('初始化失败: ' + e.message, 'error'));
})();