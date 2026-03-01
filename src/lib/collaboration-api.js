// 协作API服务 - 实时后台同步模式
const WS_BASE_URL = 'ws://localhost:8765';

/**
 * 协作API类
 * 
 * 当前同步机制：
 * 1. 前端在本地变更后自动触发后台同步（节流/去抖）
 * 2. 远程变更自动合并，尽量不打断编辑体验
 * 3. 新用户加入时，从服务器获取项目快照
 */
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
        // 递增连接ID，用于忽略过期连接事件
        this.connectionId = 0;
        // 标记是否为主动关闭（避免误触发断开提示）
        this.isIntentionalClose = false;
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
                let settled = false;
                const currentConnectionId = ++this.connectionId;
                this.isIntentionalClose = false;

                // 清理之前的连接：移除旧监听，避免旧连接 onclose 误触发当前回调
                if (this.socket) {
                    const oldSocket = this.socket;
                    try {
                        oldSocket.onopen = null;
                        oldSocket.onmessage = null;
                        oldSocket.onerror = null;
                        oldSocket.onclose = null;
                        oldSocket.close();
                    } catch (e) {
                        console.error('关闭旧连接失败:', e);
                    }
                    this.socket = null;
                }
                
                this.projectToken = projectToken;
                const socket = new WebSocket(`${WS_BASE_URL}/${projectToken}`);
                this.socket = socket;
                
                socket.onopen = () => {
                    // 忽略过期连接事件
                    if (currentConnectionId !== this.connectionId || socket !== this.socket) return;

                    console.log('[协作API] WebSocket连接已打开');
                    // 发送认证信息
                    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                        this.socket.send(JSON.stringify({
                            type: 'auth',
                            token: authToken
                        }));
                        // 通知回调
                        this.callbacks.connect.forEach(callback => callback());
                        if (!settled) {
                            settled = true;
                            resolve();
                        }
                    } else {
                        console.error('[协作API] WebSocket连接状态异常:', this.socket ? this.socket.readyState : 'null');
                        if (!settled) {
                            settled = true;
                            reject(new Error('WebSocket连接状态异常'));
                        }
                    }
                };
                
                socket.onmessage = (event) => {
                    // 忽略过期连接事件
                    if (currentConnectionId !== this.connectionId || socket !== this.socket) return;

                    try {
                        const message = JSON.parse(event.data);
                        // 显示所有消息类型
                        console.log('[协作API] 收到消息:', message.type, message);
                        
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
                        console.error('[协作API] 解析WebSocket消息错误:', error);
                    }
                };
                
                socket.onclose = (event) => {
                    // 忽略过期连接事件
                    if (currentConnectionId !== this.connectionId || socket !== this.socket) return;

                    const isIntentional = this.isIntentionalClose;
                    console.log(`[协作API] WebSocket连接已关闭 (code=${event.code}, reason=${event.reason || 'none'}, intentional=${isIntentional})`);

                    this.socket = null;

                    // 主动关闭时不触发断开回调，避免误提示
                    if (!isIntentional) {
                        this.callbacks.disconnect.forEach(callback => callback());
                    }
                };
                
                socket.onerror = (error) => {
                    // 忽略过期连接事件
                    if (currentConnectionId !== this.connectionId || socket !== this.socket) return;

                    console.error('[协作API] WebSocket错误:', error);
                    this.callbacks.error.forEach(callback => callback(error));
                    if (!settled) {
                        settled = true;
                        reject(error);
                    }
                };
            } catch (error) {
                console.error('[协作API] WebSocket连接错误:', error);
                reject(error);
            }
        });
    }
    
    /**
     * 断开WebSocket连接
     */
    disconnect() {
        if (this.socket) {
            const socket = this.socket;
            this.isIntentionalClose = true;
            this.socket = null;
            try {
                socket.close();
            } catch (e) {
                console.error('[协作API] 关闭连接失败:', e);
            }
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
                console.log('[协作API] 发送消息:', message.type);
            } catch (error) {
                console.error('[协作API] 发送WebSocket消息错误:', error);
            }
        } else {
            console.error('[协作API] WebSocket未连接，无法发送消息');
        }
    }
    
    /**
     * 发送手动同步请求
     * 上传本地修改并拉取服务器上的最新版本
     * @param {Object} projectJSON - 项目JSON数据
     * @param {string} targetId - 当前编辑目标ID
     * @param {string} userId - 用户ID
     */
    sendManualSync(projectJSON, targetId, userId) {
        this.send({
            type: 'manual_sync',
            data: {
                projectJSON: projectJSON,
                targetId: targetId,
                timestamp: Date.now(),
                userId: userId
            }
        });
    }
    
    /**
     * 请求项目快照（新用户加入时）
     * @param {string} userId - 用户ID
     */
    requestSnapshot(userId) {
        this.send({
            type: 'request_snapshot',
            data: {
                userId: userId,
                timestamp: Date.now()
            }
        });
    }
    
    /**
     * 发送项目同步给指定用户
     * @param {Object} projectJSON - 项目JSON数据
     * @param {string} targetId - 当前编辑目标ID
     * @param {string} forUser - 目标用户ID
     */
    sendProjectSync(projectJSON, targetId, forUser) {
        this.send({
            type: 'project_sync',
            data: {
                projectJSON: projectJSON,
                targetId: targetId,
                timestamp: Date.now(),
                forUser: forUser
            }
        });
    }
    
    /**
     * 注册事件回调
     * @param {string} event - 事件名称
     * @param {Function} callback - 回调函数
     */
    on(event, callback) {
        if (this.callbacks[event]) {
            // 避免重复注册相同的回调
            if (!this.callbacks[event].includes(callback)) {
                this.callbacks[event].push(callback);
            }
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
     * 清空所有事件回调
     */
    clearCallbacks() {
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
     * 检查连接状态
     * @returns {boolean} 是否连接
     */
    isConnected() {
        return this.socket && this.socket.readyState === WebSocket.OPEN;
    }
}

// 导出单例实例
export default new CollaborationAPI();
