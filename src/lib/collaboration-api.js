// 协作API服务
const WS_BASE_URL = 'ws://localhost:8765';

class CollaborationAPI {
    constructor() {
        this.socket = null;
        this.projectToken = null;
        this.callbacks = {
            connect: [],
            disconnect: [],
            message: [],
            error: [],
            userJoined: [],
            userLeft: []
        };
    }
    
    /**
     * 连接到协作服务器
     * @param {string} projectToken - 项目邀请token
     * @param {string} authToken - 认证token
     * @returns {Promise<void>}
     */
    connect(projectToken, authToken) {
        return new Promise((resolve, reject) => {
            try {
                this.projectToken = projectToken;
                this.socket = new WebSocket(`${WS_BASE_URL}/${projectToken}`);
                
                this.socket.onopen = () => {
                    console.log('WebSocket连接已打开');
                    // 发送认证信息
                    this.socket.send(JSON.stringify({
                        type: 'auth',
                        token: authToken
                    }));
                    // 通知回调
                    this.callbacks.connect.forEach(callback => callback());
                    resolve();
                };
                
                this.socket.onmessage = (event) => {
                    try {
                        const message = JSON.parse(event.data);
                        console.log('收到WebSocket消息:', message);
                        
                        // 处理特定类型的消息
                        switch (message.type) {
                            case 'user_joined':
                                this.callbacks.userJoined.forEach(callback => callback(message.user_id));
                                break;
                            case 'user_left':
                                this.callbacks.userLeft.forEach(callback => callback(message.user_id));
                                break;
                            default:
                                // 其他消息传递给通用回调
                                this.callbacks.message.forEach(callback => callback(message));
                        }
                    } catch (error) {
                        console.error('解析WebSocket消息错误:', error);
                    }
                };
                
                this.socket.onclose = () => {
                    console.log('WebSocket连接已关闭');
                    this.callbacks.disconnect.forEach(callback => callback());
                };
                
                this.socket.onerror = (error) => {
                    console.error('WebSocket错误:', error);
                    this.callbacks.error.forEach(callback => callback(error));
                    reject(error);
                };
            } catch (error) {
                console.error('WebSocket连接错误:', error);
                reject(error);
            }
        });
    }
    
    /**
     * 断开WebSocket连接
     */
    disconnect() {
        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }
    }
    
    /**
     * 发送消息到协作服务器
     * @param {Object} message - 要发送的消息
     */
    send(message) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            try {
                this.socket.send(JSON.stringify(message));
            } catch (error) {
                console.error('发送WebSocket消息错误:', error);
            }
        } else {
            console.error('WebSocket未连接，无法发送消息');
        }
    }
    
    /**
     * 发送积木变更消息
     * @param {Object} blockData - 积木数据
     */
    sendBlockChange(blockData) {
        this.send({
            type: 'block_change',
            data: blockData
        });
    }
    
    /**
     * 发送舞台变更消息
     * @param {Object} stageData - 舞台数据
     */
    sendStageChange(stageData) {
        this.send({
            type: 'stage_change',
            data: stageData
        });
    }
    
    /**
     * 发送精灵变更消息
     * @param {Object} spriteData - 精灵数据
     */
    sendSpriteChange(spriteData) {
        this.send({
            type: 'sprite_change',
            data: spriteData
        });
    }
    
    /**
     * 注册事件回调
     * @param {string} event - 事件名称
     * @param {Function} callback - 回调函数
     */
    on(event, callback) {
        if (this.callbacks[event]) {
            this.callbacks[event].push(callback);
        }
    }
    
    /**
     * 移除事件回调
     * @param {string} event - 事件名称
     * @param {Function} callback - 回调函数
     */
    off(event, callback) {
        if (this.callbacks[event]) {
            this.callbacks[event] = this.callbacks[event].filter(cb => cb !== callback);
        }
    }
    
    /**
     * 检查连接状态
     * @returns {boolean} 是否连接
     */
    isConnected() {
        return this.socket && this.socket.readyState === WebSocket.OPEN;
    }
}

// 导出单例实例
export default new CollaborationAPI();