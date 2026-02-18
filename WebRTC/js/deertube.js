let pc = null;
let isFullscreen = false;
let fullscreenTimeout = null;
window.whepUrl_ref = '';

const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:stun.services.mozilla.com:3478' },
    { urls: 'stun:stun.stunprotocol.org:3478' }
];

function getWhepUrl(stream) {
    return `http://10.126.126.15:1985/rtc/v1/whep/?app=live&stream=${stream}`;
}

function isMobileDevice() {
    const ua = navigator.userAgent || navigator.vendor || window.opera;
    const mobileRegex = /android|iphone|ipad|ipod|blackberry|iemobile|opera mini|mobile|windows phone|phone|webos|kindle|tablet/i;
    return mobileRegex.test(ua.toLowerCase());
}

function getTextBoxValue() {
    return document.getElementById('userenter').value;
}

function detectBrowser() {
    const userAgent = navigator.userAgent;
    const warningElement = document.getElementById('browserWarning');
}

function adjustLayoutForMobile() {
    if (isMobileDevice()) {
        console.log("检测到移动设备，应用移动布局");
        document.body.classList.add('mobile-device');
        
        const style = document.createElement('style');
        style.textContent = `
            .mobile-device .main_ {
                flex-direction: column !important;
            }
            .mobile-device .videoContainer {
                width: 100% !important;
                min-width: 100% !important;
            }
            .mobile-device .buttons {
                width: 100% !important;
                display: flex !important;
                flex-direction: column !important;
                align-items: center !important;
            }
            .mobile-device .button_play {
                width: 95% !important;
                min-width: 95% !important;
                margin: 5px auto !important;
            }
        `;
        document.head.appendChild(style);
        
        updateStatus('移动设备模式 - 垂直布局');
    }
}

window.addEventListener('load', function() {
    adjustLayoutForMobile();
    detectBrowser();
    _checkStreamStatus();
    setInterval(_checkStreamStatus, 10000);
});

window.addEventListener('resize', function() {
    adjustLayoutForMobile();
});

detectBrowser();

function updateStatus(message) {
    document.getElementById('status').textContent = message;
    console.log(message);
}

function toggleFullscreen() {
    const video = document.getElementById('remoteVideo');
    const fullscreenBtn = document.querySelector('button[onclick="toggleFullscreen()"]');
    
    if (!isFullscreen) {
        const fullscreenDiv = document.createElement('div');
        fullscreenDiv.className = 'fullscreen-mode';
        fullscreenDiv.id = 'fullscreenContainer';
        
        const controlsDiv = document.createElement('div');
        controlsDiv.className = 'fullscreen-controls';
        controlsDiv.innerHTML = `
            <button onclick="disconnect()">断开</button>
            <button onclick="toggleFullscreen()">退出全屏</button>
        `;
        
        const videoWrapper = document.createElement('div');
        videoWrapper.style.cssText = 'width:100%;height:100%;display:flex;justify-content:center;align-items:center;';
        
        video.style.display = '';
        video.style.width = '100%';
        video.style.height = '100%';
        video.style.objectFit = 'contain';
        videoWrapper.appendChild(video);
        
        fullscreenDiv.appendChild(videoWrapper);
        fullscreenDiv.appendChild(controlsDiv);
        document.body.appendChild(fullscreenDiv);
        
        isFullscreen = true;
        fullscreenBtn.textContent = '退出全屏';
        
        fullscreenTimeout = setTimeout(() => controlsDiv.classList.add('hidden'), 1000);
        fullscreenDiv.addEventListener('mousemove', () => {
            controlsDiv.classList.remove('hidden');
            clearTimeout(fullscreenTimeout);
            fullscreenTimeout = setTimeout(() => controlsDiv.classList.add('hidden'), 1200);
        });
        controlsDiv.addEventListener('mouseleave', () => {
            clearTimeout(fullscreenTimeout);
            fullscreenTimeout = setTimeout(() => controlsDiv.classList.add('hidden'), 1200);
        });
        
        updateStatus('已进入网页全屏模式');
        
    } else {
        const fullscreenContainer = document.getElementById('fullscreenContainer');
        if (fullscreenContainer) {
            const videoWrapper = fullscreenContainer.querySelector('div');
            if (videoWrapper && video.parentElement === videoWrapper) {
                videoWrapper.removeChild(video);
            }
            document.body.removeChild(fullscreenContainer);
        }
        
        if (fullscreenTimeout) { clearTimeout(fullscreenTimeout); fullscreenTimeout = null; }
        
        const videoContainer = document.getElementById('videoContainer');
        if (videoContainer && video.parentElement !== videoContainer) {
            videoContainer.insertBefore(video, videoContainer.firstChild);
        }
        video.style.width = '';
        video.style.height = '';
        video.style.objectFit = '';
        video.style.display = '';
        
        isFullscreen = false;
        fullscreenBtn.textContent = '网页全屏';
        
        updateStatus('已退出全屏模式');
    }
}

document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && isFullscreen) {
        toggleFullscreen();
    }
    
    if (e.key === 'f' || e.key === 'F') {
        if (!isFullscreen && document.getElementById('remoteVideo').srcObject) {
            toggleFullscreen();
        }
    }
});

async function connect_play() {
    try {
        updateStatus('正在连接');
        
        disconnect();
        const selectedStream = window.whepUrl_ref.split('=').pop();
        if (window.streamStatus && !window.streamStatus[selectedStream]?.active) {
            updateStatus('警告：该频道当前可能没有直播流');
        }
        
        pc = new RTCPeerConnection({
            iceServers: ICE_SERVERS,
            iceTransportPolicy: 'all',
            bundlePolicy: 'max-bundle',
            rtcpMuxPolicy: 'require'
        });
        
        pc.ontrack = e => {
            updateStatus('已接收到视频流');
            const remoteVideo = document.getElementById('remoteVideo');
            remoteVideo.srcObject = e.streams[0];
            
            if (navigator.userAgent.includes('Firefox')) {
                remoteVideo.play().catch(err => {
                    console.warn('Firefox 自动播放被阻止:', err);
                    updateStatus('Firefox: 请点击视频播放按钮');
                });
            }
        };
        
        pc.onconnectionstatechange = () => {
            const state = pc.connectionState;
            updateStatus('连接状态: ' + state);
            
            if (state === 'connected') {
                updateStatus('连接成功！');
            } else if (state === 'failed') {
                updateStatus('连接失败，请重试或使用 Chrome 浏览器');
            }
        };
        
        pc.oniceconnectionstatechange = () => {
            updateStatus('ICE连接状态: ' + pc.iceConnectionState);
        };
        
        pc.onicegatheringstatechange = () => {
            console.log('ICE gathering state:', pc.iceGatheringState);
        };
        
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('ICE candidate:', event.candidate.candidate);
            } else {
                console.log('ICE gathering complete');
            }
        };
        
        const transceiverVideo = pc.addTransceiver('video', { direction: 'recvonly' });
        const transceiverAudio = pc.addTransceiver('audio', { direction: 'recvonly' });
        
        try {
            const offer = await pc.createOffer();
            
            let sdp = offer.sdp;
            
            if (navigator.userAgent.includes('Firefox')) {
                sdp = sdp.replace(/a=group:BUNDLE 0 1/g, 'a=group:BUNDLE 0');
            }
            
            await pc.setLocalDescription({ type: 'offer', sdp: sdp });
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            
            const response = await fetch(whepUrl_ref, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/sdp'
                },
                body: sdp,
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const answerSdp = await response.text();
            await pc.setRemoteDescription({
                type: 'answer',
                sdp: answerSdp
            });
            
            updateStatus('连接建立成功，等待视频流...');
            
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error('连接超时，请检查网络或服务器状态');
            }
            throw error;
        }
        _startStats();
    } catch (error) {
        updateStatus('连接失败: ' + error.message);
        console.error('连接错误:', error);
        
        if (navigator.userAgent.includes('Firefox')) {
            updateStatus('Firefox 用户建议: 尝试刷新页面或使用 Chrome 浏览器');
        }
    }
}

let streamStatus = {};

async function _checkStreamStatus() {
    try {
        const response = await fetch('http://10.126.126.15:1985/api/v1/streams/');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        
        if (data.code === 0 && data.streams) {
            window.streamStatus = {};
            data.streams.forEach(stream => {
                window.streamStatus[stream.name] = {
                    active: stream.publish && stream.publish.active,
                    video: stream.video,
                    audio: stream.audio
                };
            });
            
            _updateChannelStatusIndicators();
        }
    } catch (error) {
        console.error('获取流状态失败:', error);
        _setAllStatusUnknown();
    }
}

function _updateStatusIndicators(updateFn) {
    document.querySelectorAll('.button_play img[streamname]').forEach(updateFn);
}

function _updateChannelStatusIndicators() {
    _updateStatusIndicators(img => {
        const streamName = img.getAttribute('streamname');
        const status = window.streamStatus && window.streamStatus[streamName];
        
        if (status && status.active) {
            img.style.border = '3px solid var(--caution-color)';
        } else {
            img.style.border = '3px solid var(--secondary-color)';
        }
    });
}

function _setAllStatusUnknown() {
    _updateStatusIndicators(img => {
        img.style.border = '3px solid var(--secondary-color)';
    });
}

let statsInterval = null;

function _startStats() {
    if (statsInterval) {
        clearInterval(statsInterval);
    }
    
    statsInterval = setInterval(async () => {
        if (!pc || pc.connectionState !== 'connected') {
            return;
        }
        
        try {
            const stats = await pc.getStats();
            let fps = 0, bitrate = 0, rtt = 0, loss = 0;
            
            stats.forEach(r => {
                if (r.type === 'inbound-rtp' && r.kind === 'video') {
                    if (r.framesPerSecond) {
                        fps = r.framesPerSecond;
                    }
                    
                    if (r.bytesReceived && r.timestamp) {
                        if (!window._lastBytes) {
                            window._lastBytes = r.bytesReceived;
                            window._lastTimestamp = r.timestamp;
                        } else {
                            const dt = (r.timestamp - window._lastTimestamp) / 1000;
                            if (dt > 0) {
                                bitrate = ((r.bytesReceived - window._lastBytes) * 8 / dt / 1024 / 1024).toFixed(2);
                            }
                            window._lastBytes = r.bytesReceived;
                            window._lastTimestamp = r.timestamp;
                        }
                    }
                    
                    if (r.packetsLost !== undefined && r.packetsReceived !== undefined) {
                        const total = r.packetsLost + r.packetsReceived;
                        loss = total > 0 ? (r.packetsLost / total * 100).toFixed(2) : 0;
                    }
                }
                
                if (r.type === 'candidate-pair' && r.currentRoundTripTime) {
                    rtt = (r.currentRoundTripTime * 1000).toFixed(0);
                }
            });
            
            updateStatus(`码率: ${bitrate}Mbps | FPS: ${fps} `);
        } catch (e) {
        }
    }, 1000);
}

function connect(streamName) {
    window.whepUrl_ref = getWhepUrl(streamName);
    connect_play();
}

function disconnect() {
    if (pc) {
        pc.close();
        pc = null;
        updateStatus('已断开连接');
        document.getElementById('remoteVideo').srcObject = null;
        
        if (statsInterval) {
            clearInterval(statsInterval);
            statsInterval = null;
        }
        
        window._lastBytes = null;
        window._lastTimestamp = null;
        
        if (isFullscreen) {
            toggleFullscreen();
        }
    }
}

async function connect_URL() {
    try {
        updateStatus('正在连接URL...');
        
        var pro = document.getElementById('Protocol').value;
        var room = getTextBoxValue();
        var userUrl = pro + room;
        if (!userUrl) {
            updateStatus('请输入房间号');
            return;
        }
        
        window.whepUrl_ref = userUrl;
        connect_play();
    } catch (error) {
        updateStatus('连接失败: ' + error.message);
        console.error('连接 URL 错误:', error);
    }
}
