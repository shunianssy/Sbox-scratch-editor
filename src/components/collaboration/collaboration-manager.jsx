import React, { useEffect, useState, useCallback, useRef, useImperativeHandle, forwardRef } from 'react';
import PropTypes from 'prop-types';
import { getInviteToken } from '../../lib/url-utils';
import collaborationAPI from '../../lib/collaboration-api';
import AuthAPI from '../../lib/auth-api';
import { toastManager } from '../toast/toast.jsx';
import './collaboration-manager.css';

// 工作区状态恢复延迟（毫秒）
const WORKSPACE_RESTORE_DELAY = 100;
// 拖拽检测延迟（毫秒）
const DRAG_CHECK_DELAY = 50;

/**
 * 协作管理器组件
 * 
 * 新的同步机制（类似Git）：
 * 1. 本地操作只记录，不实时发送
 * 2. 用户点击"同步"按钮时，上传本地修改并拉取他人修改
 * 3. 新用户加入时，从服务器获取项目快照
 */
const CollaborationManager = forwardRef(({ vm, onCollaborationStart, onCollaborationEnd, onUserCountChange, onSyncStatusChange }, ref) => {
    const [isCollaborating, setIsCollaborating] = useState(false);
    const [connectedUsers, setConnectedUsers] = useState([]);
    const [connectionStatus, setConnectionStatus] = useState('disconnected');
    const [error, setError] = useState('');
    const [syncStatus, setSyncStatus] = useState('idle'); // idle, syncing, synced, error
    const [hasLocalChanges, setHasLocalChanges] = useState(false);
    
    // 用于防止循环更新的标志
    const isApplyingRemoteChange = useRef(false);
    // 上次同步的项目版本
    const lastSyncedJSON = useRef(null);
    // VM 事件处理器引用
    const vmHandlersRef = useRef({});
    // VM 引用
    const vmRef = useRef(vm);
    // 协作状态引用
    const isCollaboratingRef = useRef(false);
    // 连接状态引用
    const connectionStatusRef = useRef('disconnected');
    // 是否已经初始化
    const isInitializedRef = useRef(false);
    // 是否已经接收过项目同步
    const hasReceivedProjectSync = useRef(false);
    // 回调引用
    const onCollaborationStartRef = useRef(onCollaborationStart);
    const onCollaborationEndRef = useRef(onCollaborationEnd);
    // 当前用户 ID
    const currentUserIdRef = useRef(null);
    // 是否正在拖拽积木
    const isDraggingBlock = useRef(false);
    // 拖拽积木的 ID
    const draggingBlockId = useRef(null);
    // 本地变更计数
    const localChangesCount = useRef(0);

    // 暴露方法给父组件调用
    useImperativeHandle(ref, () => ({
        // 手动同步方法
        sync: () => handleManualSync(),
        // 检查是否有本地变更
        hasLocalChanges: () => hasLocalChanges,
        // 获取同步状态
        getSyncStatus: () => syncStatus,
        // 获取连接状态
        isConnected: () => connectionStatus === 'connected'
    }));

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

    // 用户数量变化时通知父组件
    useEffect(() => {
        if (onUserCountChange && isCollaborating) {
            onUserCountChange(connectedUsers.length + 1);
        }
    }, [connectedUsers.length, isCollaborating, onUserCountChange]);

    // 同步状态变化时通知父组件
    useEffect(() => {
        if (onSyncStatusChange) {
            onSyncStatusChange(syncStatus);
        }
    }, [syncStatus, onSyncStatusChange]);

    // 检测是否有积木正在被拖拽
    const checkDraggingState = useCallback(() => {
        try {
            if (window.Blockly && window.Blockly.getMainWorkspace) {
                const workspace = window.Blockly.getMainWorkspace();
                if (workspace) {
                    const dragSurface = workspace.getBlockDragSurface ? workspace.getBlockDragSurface() : null;
                    if (dragSurface && dragSurface.getBlock) {
                        const draggingBlock = dragSurface.getBlock();
                        if (draggingBlock) {
                            isDraggingBlock.current = true;
                            draggingBlockId.current = draggingBlock.id;
                            return true;
                        }
                    }
                    if (workspace.currentGesture_ && workspace.currentGesture_.isDragging_) {
                        isDraggingBlock.current = true;
                        return true;
                    }
                }
            }
        } catch (err) {
            // 忽略错误
        }
        isDraggingBlock.current = false;
        draggingBlockId.current = null;
        return false;
    }, []);

    // 等待拖拽结束
    const waitForDragEnd = useCallback(() => {
        return new Promise((resolve) => {
            let checkCount = 0;
            const maxChecks = 20;
            
            const checkInterval = setInterval(() => {
                checkCount++;
                const isDragging = checkDraggingState();
                
                if (!isDragging || checkCount >= maxChecks) {
                    clearInterval(checkInterval);
                    setTimeout(resolve, DRAG_CHECK_DELAY);
                }
            }, DRAG_CHECK_DELAY);
        });
    }, [checkDraggingState]);

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

    // 获取工作区状态
    const getWorkspaceState = useCallback(() => {
        try {
            if (window.Blockly && window.Blockly.getMainWorkspace) {
                const workspace = window.Blockly.getMainWorkspace();
                if (workspace) {
                    return {
                        scrollX: workspace.scrollX || 0,
                        scrollY: workspace.scrollY || 0,
                        scale: workspace.scale || 1,
                        startX: workspace.startX || 0,
                        startY: workspace.startY || 0,
                        selectedBlockId: workspace.selectedBlockId || null
                    };
                }
            }
        } catch (err) {
            console.warn('[协作] 获取工作区状态失败:', err);
        }
        return null;
    }, []);

    // 恢复工作区状态
    const restoreWorkspaceState = useCallback((state) => {
        if (!state) return;
        
        try {
            const restoreState = () => {
                if (window.Blockly && window.Blockly.getMainWorkspace) {
                    const workspace = window.Blockly.getMainWorkspace();
                    if (workspace) {
                        const originalRendered = workspace.rendered;
                        workspace.rendered = false;
                        
                        try {
                            if (state.scrollX !== undefined && state.scrollY !== undefined) {
                                workspace.scrollX = state.scrollX;
                                workspace.scrollY = state.scrollY;
                            }
                            if (state.startX !== undefined && state.startY !== undefined) {
                                workspace.startX = state.startX;
                                workspace.startY = state.startY;
                            }
                            if (state.scale !== undefined) {
                                workspace.scale = state.scale;
                            }
                            if (state.selectedBlockId) {
                                const block = workspace.getBlockById(state.selectedBlockId);
                                if (block) {
                                    workspace.selectedBlockId = state.selectedBlockId;
                                }
                            }
                        } finally {
                            workspace.rendered = originalRendered;
                        }
                        
                        if (workspace.updateInverseScreenCTM) {
                            workspace.updateInverseScreenCTM();
                        }
                        if (workspace.resize) {
                            workspace.resize();
                        }
                        if (workspace.scrollbar) {
                            workspace.scrollbar.resize();
                        }
                        if (workspace.render) {
                            workspace.render();
                        }
                        
                        console.log('[协作] 已恢复工作区状态');
                    }
                }
            };
            
            setTimeout(() => {
                requestAnimationFrame(restoreState);
            }, WORKSPACE_RESTORE_DELAY);
        } catch (err) {
            console.warn('[协作] 恢复工作区状态失败:', err);
        }
    }, []);

    // 检测本地变更（只记录，不发送）
    const detectLocalChange = useCallback(() => {
        if (isApplyingRemoteChange.current) {
            return;
        }
        
        const projectJSON = getCurrentProjectJSON();
        if (!projectJSON) return;
        
        // 检查是否有实际变更
        if (lastSyncedJSON.current !== projectJSON) {
            localChangesCount.current++;
            setHasLocalChanges(true);
            console.log('[协作] 检测到本地变更，变更计数:', localChangesCount.current);
        }
    }, [getCurrentProjectJSON]);

    // 注册 VM 事件监听（只记录变更，不发送）
    const registerVMListeners = useCallback(() => {
        const currentVm = vmRef.current;
        if (!currentVm) {
            console.warn('[协作] VM 未初始化，无法注册事件监听');
            return;
        }

        console.log('[协作] 正在注册 VM 事件监听（手动同步模式）...');

        // 监听 workspaceUpdate 事件
        const workspaceUpdateHandler = () => {
            if (isApplyingRemoteChange.current) return;
            detectLocalChange();
        };

        // 监听 PROJECT_CHANGED 事件
        const projectChangedHandler = () => {
            if (isApplyingRemoteChange.current) return;
            detectLocalChange();
        };

        // 监听 targetsUpdate 事件
        const targetsUpdateHandler = () => {
            if (isApplyingRemoteChange.current) return;
            detectLocalChange();
        };

        vmHandlersRef.current = {
            workspaceUpdate: workspaceUpdateHandler,
            projectChanged: projectChangedHandler,
            targetsUpdate: targetsUpdateHandler
        };

        currentVm.on('workspaceUpdate', workspaceUpdateHandler);
        currentVm.on('PROJECT_CHANGED', projectChangedHandler);
        currentVm.on('targetsUpdate', targetsUpdateHandler);

        console.log('[协作] 已注册 VM 事件监听（手动同步模式）');
    }, [detectLocalChange]);

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

    // 手动同步方法（核心功能）
    const handleManualSync = useCallback(async () => {
        if (!isCollaboratingRef.current) {
            toastManager.warning('未连接到协作服务器', 2000);
            return;
        }

        if (syncStatus === 'syncing') {
            toastManager.info('正在同步中，请稍候...', 2000);
            return;
        }

        // 检查是否有积木正在被拖拽
        if (checkDraggingState()) {
            toastManager.warning('请先完成当前操作再同步', 2000);
            return;
        }

        setSyncStatus('syncing');
        console.log('[协作] 开始手动同步...');

        try {
            const projectJSON = getCurrentProjectJSON();
            if (!projectJSON) {
                throw new Error('无法获取项目数据');
            }

            // 发送同步请求到服务器
            collaborationAPI.send({
                type: 'manual_sync',
                data: {
                    projectJSON: projectJSON,
                    targetId: vmRef.current && vmRef.current.editingTarget ? vmRef.current.editingTarget.id : null,
                    timestamp: Date.now(),
                    userId: currentUserIdRef.current
                }
            });

            // 更新本地同步状态
            lastSyncedJSON.current = projectJSON;
            localChangesCount.current = 0;
            setHasLocalChanges(false);
            setSyncStatus('synced');
            
            toastManager.success('同步成功！', 2000);
            console.log('[协作] 同步完成');

        } catch (error) {
            console.error('[协作] 同步失败:', error);
            setSyncStatus('error');
            toastManager.error(`同步失败: ${error.message}`, 3000);
        }
    }, [syncStatus, checkDraggingState, getCurrentProjectJSON]);

    // 处理同步响应
    const handleSyncResponse = useCallback(async (syncData) => {
        console.log('[协作] 收到同步响应');

        if (!syncData.projectJSON) {
            console.warn('[协作] 同步响应中没有项目数据');
            setSyncStatus('error');
            return;
        }

        const currentVm = vmRef.current;
        if (!currentVm) {
            console.warn('[协作] VM 未初始化');
            return;
        }

        // 检查是否有积木正在被拖拽
        if (checkDraggingState()) {
            console.log('[协作] 检测到拖拽中，等待拖拽结束...');
            await waitForDragEnd();
        }

        // 保存当前工作区状态
        const workspaceState = getWorkspaceState();

        try {
            isApplyingRemoteChange.current = true;
            
            console.log('[协作] 正在加载同步的项目...');
            
            await currentVm.loadProject(syncData.projectJSON);
            
            console.log('[协作] 同步项目已加载');
            lastSyncedJSON.current = syncData.projectJSON;
            
            // 重置本地变更状态
            localChangesCount.current = 0;
            setHasLocalChanges(false);
            setSyncStatus('synced');
            
            // 恢复工作区状态
            restoreWorkspaceState(workspaceState);
            
            toastManager.success('同步成功！', 2000);
            
        } catch (error) {
            console.error('[协作] 加载同步项目失败:', error);
            setSyncStatus('error');
            toastManager.error('同步失败，请重试', 3000);
        } finally {
            setTimeout(() => {
                isApplyingRemoteChange.current = false;
            }, WORKSPACE_RESTORE_DELAY);
        }
    }, [checkDraggingState, waitForDragEnd, getWorkspaceState, restoreWorkspaceState]);

    // 处理项目同步（新用户加入时收到）
    const handleProjectSync = useCallback(async (syncData) => {
        console.log('[协作] 收到项目同步请求');
        
        // 如果有 forUser 字段，检查是否是发给自己的
        // 如果 forUser 为空，说明是广播给所有人的
        if (syncData.forUser && syncData.forUser !== currentUserIdRef.current) {
            console.log('[协作] 忽略发给其他用户的项目同步, forUser:', syncData.forUser, '当前用户:', currentUserIdRef.current);
            return;
        }

        if (!syncData.projectJSON) {
            console.warn('[协作] 项目同步数据中没有 projectJSON');
            return;
        }

        const currentVm = vmRef.current;
        if (!currentVm) {
            console.warn('[协作] VM 未初始化');
            return;
        }

        // 如果已经接收过项目同步，并且这个同步不是发给自己的，则跳过
        if (hasReceivedProjectSync.current && syncData.forUser) {
            console.log('[协作] 已经同步过项目，跳过定向同步');
            return;
        }

        // 检查是否有积木正在被拖拽
        if (checkDraggingState()) {
            console.log('[协作] 检测到拖拽中，等待拖拽结束...');
            await waitForDragEnd();
        }

        // 保存当前工作区状态
        const workspaceState = getWorkspaceState();

        try {
            isApplyingRemoteChange.current = true;
            
            console.log('[协作] 正在加载同步的项目...');
            
            await currentVm.loadProject(syncData.projectJSON);
            
            console.log('[协作] 同步项目已加载');
            lastSyncedJSON.current = syncData.projectJSON;
            hasReceivedProjectSync.current = true;
            
            // 重置本地变更状态
            localChangesCount.current = 0;
            setHasLocalChanges(false);
            
            // 恢复工作区状态
            restoreWorkspaceState(workspaceState);
            
            toastManager.success('已加载项目快照', 2000);
            
        } catch (error) {
            console.error('[协作] 处理项目同步失败:', error);
        } finally {
            setTimeout(() => {
                isApplyingRemoteChange.current = false;
            }, WORKSPACE_RESTORE_DELAY);
        }
    }, [checkDraggingState, waitForDragEnd, getWorkspaceState, restoreWorkspaceState]);

    // 发送当前项目给新用户
    const sendProjectToNewUser = useCallback((newUserId) => {
        if (!isCollaboratingRef.current) {
            return;
        }

        const projectJSON = getCurrentProjectJSON();
        if (!projectJSON) {
            console.warn('[协作] 无法发送项目给新用户：项目 JSON 为空');
            return;
        }

        console.log('[协作] 发送当前项目给新用户:', newUserId);
        
        collaborationAPI.send({
            type: 'project_sync',
            data: {
                projectJSON: projectJSON,
                targetId: vmRef.current && vmRef.current.editingTarget ? vmRef.current.editingTarget.id : null,
                timestamp: Date.now(),
                forUser: newUserId
            }
        });
    }, [getCurrentProjectJSON]);

    // 处理协作消息
    const handleCollaborationMessage = useCallback((message) => {
        console.log('[协作] 收到消息:', message.type);
        
        switch (message.type) {
            case 'sync_response':
                // 收到其他用户的同步响应，加载他们的项目
                if (message.data && message.data.projectJSON) {
                    handleSyncResponse(message.data);
                }
                break;
            case 'project_sync':
                // 项目同步（新用户加入或服务器快照）
                handleProjectSync(message.data);
                break;
            case 'user_synced':
                // 其他用户同步了项目
                toastManager.info('其他用户已同步项目', 2000);
                break;
            case 'manual_sync':
            case 'request_snapshot':
                // 忽略这些消息，它们是发给服务器的
                break;
            default:
                break;
        }
    }, [handleSyncResponse, handleProjectSync]);

    // 初始化协作连接
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
            setSyncStatus('idle');
            
            toastManager.success('协作连接成功！', 3000);
            
            if (onCollaborationStartRef.current) {
                onCollaborationStartRef.current();
            }
            
            // 初始化同步状态
            const currentProjectJSON = getCurrentProjectJSON();
            if (currentProjectJSON) {
                try {
                    const projectObj = JSON.parse(currentProjectJSON);
                    if (projectObj && projectObj.targets && projectObj.targets.length > 0) {
                        lastSyncedJSON.current = currentProjectJSON;
                        console.log('[协作] 已有项目，初始化同步状态');
                    } else {
                        console.log('[协作] 项目为空，等待接收同步');
                    }
                } catch (e) {
                    console.log('[协作] 项目解析失败，等待接收同步');
                }
            }
            
            // 注册 VM 事件监听（手动同步模式）
            registerVMListeners();
            
            // 请求项目快照（新用户加入时）
            collaborationAPI.send({
                type: 'request_snapshot',
                data: {
                    userId: currentUserIdRef.current,
                    timestamp: Date.now()
                }
            });
        });

        // 注册断开连接回调
        collaborationAPI.on('disconnect', () => {
            console.log('[协作] 连接断开');
            setConnectionStatus('disconnected');
            setIsCollaborating(false);
            setConnectedUsers([]);
            setSyncStatus('idle');
            
            toastManager.warning('协作连接已断开', 3000);
            
            if (onCollaborationEndRef.current) {
                onCollaborationEndRef.current();
            }
            
            unregisterVMListeners();
        });

        // 注册错误回调
        collaborationAPI.on('error', (err) => {
            console.error('[协作] 连接错误:', err);
            setError(`连接错误: ${err.message || '未知错误'}`);
            setConnectionStatus('disconnected');
            setIsCollaborating(false);
            setSyncStatus('error');
            
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
            
            // 发送当前项目给新用户（延迟发送）
            setTimeout(() => {
                sendProjectToNewUser(userId);
            }, 500);
        });

        // 注册用户离开回调
        collaborationAPI.on('userLeft', (userId) => {
            console.log('[协作] 用户离开:', userId);
            setConnectedUsers(prev => prev.filter(id => id !== userId));
        });

        // 注册消息回调
        collaborationAPI.on('message', (message) => {
            if (message.user_id) {
                currentUserIdRef.current = message.user_id;
            }
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
            unregisterVMListeners();
            collaborationAPI.disconnect();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    
    return null;
});

CollaborationManager.propTypes = {
    vm: PropTypes.object.isRequired,
    onCollaborationStart: PropTypes.func,
    onCollaborationEnd: PropTypes.func,
    onUserCountChange: PropTypes.func,
    onSyncStatusChange: PropTypes.func
};

CollaborationManager.displayName = 'CollaborationManager';

export default CollaborationManager;
