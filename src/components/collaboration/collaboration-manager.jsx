import React, { useEffect, useState, useCallback, useRef } from 'react';
import PropTypes from 'prop-types';
import { getInviteToken } from '../../lib/url-utils';
import collaborationAPI from '../../lib/collaboration-api';
import AuthAPI from '../../lib/auth-api';
import { toastManager } from '../toast/toast.jsx';
import './collaboration-manager.css';

// 同步间隔（毫秒）
const SYNC_INTERVAL = 1000;
// 最大同步间隔（毫秒）
const MAX_SYNC_INTERVAL = 3000;
// 最小同步间隔（毫秒）- 防止过于频繁的同步
const MIN_SYNC_INTERVAL = 300;

const CollaborationManager = ({ vm, onCollaborationStart, onCollaborationEnd }) => {
    const [isCollaborating, setIsCollaborating] = useState(false);
    const [connectedUsers, setConnectedUsers] = useState([]);
    const [connectionStatus, setConnectionStatus] = useState('disconnected');
    const [error, setError] = useState('');
    
    // 用于防止循环更新的标志
    const isApplyingRemoteChange = useRef(false);
    // 上次同步的项目版本
    const lastSyncedJSON = useRef(null);
    // 上次同步时间
    const lastSyncTime = useRef(0);
    // 同步定时器
    const syncIntervalRef = useRef(null);
    // 是否有待发送的变更
    const hasPendingChanges = useRef(false);
    // VM 事件处理器引用
    const vmHandlersRef = useRef({});
    // VM 引用
    const vmRef = useRef(vm);
    // 协作状态引用
    const isCollaboratingRef = useRef(false);
    // 连接状态引用
    const connectionStatusRef = useRef('disconnected');
    // 是否正在连接
    const isConnectingRef = useRef(false);
    // 是否已经初始化
    const isInitializedRef = useRef(false);
    // 回调引用
    const onCollaborationStartRef = useRef(onCollaborationStart);
    const onCollaborationEndRef = useRef(onCollaborationEnd);

    // 更新 VM 引用
    useEffect(() => {
        vmRef.current = vm;
    }, [vm]);

    // 更新协作状态引用
    useEffect(() => {
        isCollaboratingRef.current = isCollaborating;
    }, [isCollaborating]);

    // 更新连接状态引用
    useEffect(() => {
        connectionStatusRef.current = connectionStatus;
    }, [connectionStatus]);

    // 更新回调引用
    useEffect(() => {
        onCollaborationStartRef.current = onCollaborationStart;
        onCollaborationEndRef.current = onCollaborationEnd;
    }, [onCollaborationStart, onCollaborationEnd]);

    // 获取当前项目 JSON
    const getCurrentProjectJSON = useCallback(() => {
        const currentVm = vmRef.current;
        if (!currentVm || !currentVm.toJSON) {
            return null;
        }
        try {
            return currentVm.toJSON();
        } catch (err) {
            console.error('[协作] 获取项目 JSON 失败:', err);
            return null;
        }
    }, []);

    // 发送项目变更到服务器
    const sendProjectUpdate = useCallback(() => {
        if (!isCollaboratingRef.current || isApplyingRemoteChange.current) {
            return;
        }

        const currentVm = vmRef.current;
        const now = Date.now();
        const timeSinceLastSync = now - lastSyncTime.current;

        // 如果距离上次同步时间太短，跳过
        if (timeSinceLastSync < MIN_SYNC_INTERVAL) {
            hasPendingChanges.current = true;
            return;
        }

        const projectJSON = getCurrentProjectJSON();
        if (!projectJSON) {
            return;
        }

        // 检查是否有实际变更
        if (lastSyncedJSON.current === projectJSON) {
            return;
        }

        console.log('[协作] 发送项目更新, JSON长度:', projectJSON.length);
        
        collaborationAPI.send({
            type: 'block_change',
            data: {
                changeType: 'project_update',
                projectJSON: projectJSON,
                targetId: currentVm && currentVm.editingTarget ? currentVm.editingTarget.id : null,
                timestamp: now
            }
        });

        lastSyncedJSON.current = projectJSON;
        lastSyncTime.current = now;
        hasPendingChanges.current = false;
    }, [getCurrentProjectJSON]);

    // 注册 VM 事件监听
    const registerVMListeners = useCallback(() => {
        const currentVm = vmRef.current;
        if (!currentVm) {
            console.warn('[协作] VM 未初始化，无法注册事件监听');
            return;
        }

        console.log('[协作] 正在注册 VM 事件监听...');

        // 监听 workspaceUpdate 事件
        const workspaceUpdateHandler = (data) => {
            if (isApplyingRemoteChange.current) {
                return;
            }
            console.log('[协作] 检测到 workspaceUpdate 事件');
            hasPendingChanges.current = true;
        };

        // 监听 PROJECT_CHANGED 事件
        const projectChangedHandler = () => {
            if (isApplyingRemoteChange.current) {
                return;
            }
            console.log('[协作] 检测到 PROJECT_CHANGED 事件');
            hasPendingChanges.current = true;
        };

        // 监听 targetsUpdate 事件
        const targetsUpdateHandler = () => {
            if (isApplyingRemoteChange.current) {
                return;
            }
            hasPendingChanges.current = true;
        };

        vmHandlersRef.current = {
            workspaceUpdate: workspaceUpdateHandler,
            projectChanged: projectChangedHandler,
            targetsUpdate: targetsUpdateHandler
        };

        currentVm.on('workspaceUpdate', workspaceUpdateHandler);
        currentVm.on('PROJECT_CHANGED', projectChangedHandler);
        currentVm.on('targetsUpdate', targetsUpdateHandler);

        console.log('[协作] 已注册 VM 事件监听');
    }, []);

    // 移除 VM 事件监听
    const unregisterVMListeners = useCallback(() => {
        const currentVm = vmRef.current;
        if (!currentVm) return;

        const handlers = vmHandlersRef.current;
        if (handlers.workspaceUpdate) {
            currentVm.off('workspaceUpdate', handlers.workspaceUpdate);
        }
        if (handlers.projectChanged) {
            currentVm.off('PROJECT_CHANGED', handlers.projectChanged);
        }
        if (handlers.targetsUpdate) {
            currentVm.off('targetsUpdate', handlers.targetsUpdate);
        }

        vmHandlersRef.current = {};
        console.log('[协作] 已移除 VM 事件监听');
    }, []);

    // 启动定期同步
    const startPeriodicSync = useCallback(() => {
        if (syncIntervalRef.current) {
            clearInterval(syncIntervalRef.current);
        }
        
        syncIntervalRef.current = setInterval(() => {
            if (hasPendingChanges.current) {
                sendProjectUpdate();
            }
        }, SYNC_INTERVAL);
        
        console.log('[协作] 启动定期同步，间隔:', SYNC_INTERVAL, 'ms');
    }, [sendProjectUpdate]);

    // 停止定期同步
    const stopPeriodicSync = useCallback(() => {
        if (syncIntervalRef.current) {
            clearInterval(syncIntervalRef.current);
            syncIntervalRef.current = null;
        }
        console.log('[协作] 停止定期同步');
    }, []);

    // 处理积木变更
    const handleBlockChange = useCallback((blockData) => {
        if (isApplyingRemoteChange.current) {
            return;
        }
        
        console.log('[协作] 处理积木变更:', blockData.changeType);
        
        const currentVm = vmRef.current;
        if (!currentVm || !currentVm.runtime) {
            console.warn('[协作] VM 未初始化，无法处理积木变更');
            return;
        }
        
        if (blockData.changeType !== 'project_update') {
            return;
        }

        if (!blockData.projectJSON) {
            console.warn('[协作] 收到的项目更新没有 projectJSON');
            return;
        }

        const now = Date.now();
        const messageTime = blockData.timestamp || 0;
        if (messageTime > 0 && (now - messageTime) > MAX_SYNC_INTERVAL * 2) {
            console.log('[协作] 忽略过时的更新，时间差:', now - messageTime, 'ms');
            return;
        }

        try {
            isApplyingRemoteChange.current = true;
            
            console.log('[协作] 正在加载远程项目更新...');
            
            currentVm.loadProject(blockData.projectJSON)
                .then(() => {
                    console.log('[协作] 远程项目更新已加载');
                    lastSyncedJSON.current = blockData.projectJSON;
                    lastSyncTime.current = Date.now();
                })
                .catch(err => {
                    console.error('[协作] 加载远程项目失败:', err);
                })
                .finally(() => {
                    setTimeout(() => {
                        isApplyingRemoteChange.current = false;
                    }, 100);
                });
            
        } catch (error) {
            console.error('[协作] 处理积木变更失败:', error);
            isApplyingRemoteChange.current = false;
        }
    }, []);

    // 处理协作消息
    const handleCollaborationMessage = useCallback((message) => {
        console.log('[协作] 收到消息:', message.type);
        
        switch (message.type) {
            case 'block_change':
                handleBlockChange(message.data);
                break;
            default:
                break;
        }
    }, [handleBlockChange]);

    // 初始化协作连接 - 只执行一次
    useEffect(() => {
        if (isInitializedRef.current) return;
        isInitializedRef.current = true;

        const token = getInviteToken();
        if (!token) return;

        console.log('[协作] 检测到邀请token:', token.substring(0, 8) + '...');
        
        const auth = AuthAPI.getAuth();
        const authToken = auth ? auth.token : null;
        
        if (!authToken) {
            console.log('[协作] 用户未登录，尝试匿名连接...');
        }

        // 清空之前的回调
        collaborationAPI.clearCallbacks();

        // 注册连接成功回调
        collaborationAPI.on('connect', () => {
            console.log('[协作] 连接成功回调');
            setConnectionStatus('connected');
            setIsCollaborating(true);
            setConnectedUsers([]);
            
            toastManager.success('协作连接成功！', 3000);
            
            if (onCollaborationStartRef.current) {
                onCollaborationStartRef.current();
            }
            
            // 初始化同步状态
            lastSyncedJSON.current = getCurrentProjectJSON();
            lastSyncTime.current = Date.now();
            
            // 启动定期同步
            startPeriodicSync();
            
            // 注册 VM 事件监听
            registerVMListeners();
        });

        // 注册断开连接回调
        collaborationAPI.on('disconnect', () => {
            console.log('[协作] 连接断开');
            setConnectionStatus('disconnected');
            setIsCollaborating(false);
            setConnectedUsers([]);
            
            toastManager.warning('协作连接已断开', 3000);
            
            if (onCollaborationEndRef.current) {
                onCollaborationEndRef.current();
            }
            
            stopPeriodicSync();
            unregisterVMListeners();
        });

        // 注册错误回调
        collaborationAPI.on('error', (err) => {
            console.error('[协作] 连接错误:', err);
            setError(`连接错误: ${err.message || '未知错误'}`);
            setConnectionStatus('disconnected');
            setIsCollaborating(false);
            
            toastManager.error(`协作连接失败: ${err.message || '未知错误'}`, 4000);
        });

        // 注册用户加入回调
        collaborationAPI.on('userJoined', (userId) => {
            console.log('[协作] 用户加入:', userId);
            setConnectedUsers(prev => {
                if (!prev.includes(userId)) {
                    return [...prev, userId];
                }
                return prev;
            });
        });

        // 注册用户离开回调
        collaborationAPI.on('userLeft', (userId) => {
            console.log('[协作] 用户离开:', userId);
            setConnectedUsers(prev => prev.filter(id => id !== userId));
        });

        // 注册消息回调
        collaborationAPI.on('message', (message) => {
            handleCollaborationMessage(message);
        });

        // 连接到协作服务器
        setConnectionStatus('connecting');
        setError('');

        collaborationAPI.connect(token, authToken)
            .then(() => {
                console.log('[协作] WebSocket连接已建立');
            })
            .catch(err => {
                console.error('[协作] 连接失败:', err);
                setError(`连接失败: ${err.message || '未知错误'}`);
                setConnectionStatus('disconnected');
            });

        // 清理函数
        return () => {
            console.log('[协作] 组件卸载，清理资源');
            stopPeriodicSync();
            unregisterVMListeners();
            collaborationAPI.disconnect();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // 空依赖数组，只在组件挂载时执行一次
    
    // 渲染协作状态指示器
    const renderStatusIndicator = () => {
        let statusText = '未连接';
        let statusClass = 'collaboration-status-disconnected';
        
        switch (connectionStatus) {
            case 'connecting':
                statusText = '连接中...';
                statusClass = 'collaboration-status-connecting';
                break;
            case 'connected':
                statusText = `已连接 (${connectedUsers.length + 1}人)`;
                statusClass = 'collaboration-status-connected';
                break;
            default:
                break;
        }
        
        return (
            <div className={`collaboration-status ${statusClass}`}>
                <span className="collaboration-status-text">{statusText}</span>
                {error && (
                    <span className="collaboration-error">{error}</span>
                )}
            </div>
        );
    };
    
    return (
        <div className="collaboration-manager">
            {isCollaborating && (
                <div className="collaboration-panel">
                    <h3>🤝 实时协作</h3>
                    {renderStatusIndicator()}
                    <div className="connected-users">
                        <h4>在线用户 ({connectedUsers.length + 1}人)</h4>
                        <ul>
                            {connectedUsers.map((userId) => (
                                <li key={userId}>
                                    用户 {userId.toString().substring(0, 8)}...
                                </li>
                            ))}
                            <li className="current-user">
                                你 (当前用户)
                            </li>
                        </ul>
                    </div>
                </div>
            )}
        </div>
    );
};

CollaborationManager.propTypes = {
    vm: PropTypes.object.isRequired,
    onCollaborationStart: PropTypes.func,
    onCollaborationEnd: PropTypes.func
};

export default CollaborationManager;
