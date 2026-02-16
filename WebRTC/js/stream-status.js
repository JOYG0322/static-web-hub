(function() {
    class StreamStatusManager {
        constructor() {
            this.status = {};
            this.server = '10.126.126.15';
            this.pollingInterval = null;
            this.callbacks = [];
        }

        setServer(server) {
            this.server = server;
        }

        async fetchStatus() {
            try {
                const response = await fetch(`http://${this.server}:1985/api/v1/streams/`);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = await response.json();
                
                if (data.code === 0 && data.streams) {
                    const newStatus = {};
                    data.streams.forEach(stream => {
                        newStatus[stream.name] = {
                            active: stream.publish && stream.publish.active,
                            video: stream.video,
                            audio: stream.audio
                        };
                    });
                    
                    const changed = JSON.stringify(this.status) !== JSON.stringify(newStatus);
                    this.status = newStatus;
                    
                    if (changed) {
                        this._notifyCallbacks();
                    }
                    return this.status;
                }
            } catch (error) {
                console.error('[StreamStatus] 获取流状态失败:', error);
            }
            return null;
        }

        checkStatus(streamName) {
            const status = this.status[streamName];
            return status ? status.active : false;
        }

        getAllStatus() {
            return { ...this.status };
        }

        isOnline(streamName) {
            return this.checkStatus(streamName);
        }

        startPolling(interval = 10000) {
            if (this.pollingInterval) {
                clearInterval(this.pollingInterval);
            }
            this.fetchStatus();
            this.pollingInterval = setInterval(() => this.fetchStatus(), interval);
        }

        stopPolling() {
            if (this.pollingInterval) {
                clearInterval(this.pollingInterval);
                this.pollingInterval = null;
            }
        }

        onStatusChange(callback) {
            this.callbacks.push(callback);
            return () => {
                this.callbacks = this.callbacks.filter(cb => cb !== callback);
            };
        }

        _notifyCallbacks() {
            this.callbacks.forEach(cb => {
                try {
                    cb(this.status);
                } catch (e) {
                    console.error('[StreamStatus] 回调执行错误:', e);
                }
            });
        }
    }

    window.StreamStatusManager = new StreamStatusManager();
})();
