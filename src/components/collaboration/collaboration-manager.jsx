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
// 工作区状态恢复延迟（毫秒）
const WORKSPACE_RESTORE_DELAY = 100;
// 拖拽检测延迟（毫秒）
const DRAG_CHECK_DELAY = 50;

const CollaborationManager = ({ vm, onCollaborationStart, onCollaborationEnd, onUserCountChange }) => {
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
    // 是否已经初始化
    const isInitializedRef = useRef(false);
    // 是否已经接收过项目同步（用于新用户加入时避免重复加载）
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

    // 检测是否有积木正在被拖拽
    const checkDraggingState = useCallback(() => {
        try {
            if (window.Blockly && window.Blockly.getMainWorkspace) {
                const workspace = window.Blockly.getMainWorkspace();
                if (workspace) {
                    // 检查是否有正在拖拽的积木
                    const dragSurface = workspace.getBlockDragSurface ? workspace.getBlockDragSurface() : null;
                    if (dragSurface && dragSurface.getBlock) {
                        const draggingBlock = dragSurface.getBlock();
                        if (draggingBlock) {
                            isDraggingBlock.current = true;
                            draggingBlockId.current = draggingBlock.id;
                            return true;
                        }
                    }
                    // 检查 gesture 是否正在拖拽
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
            const maxChecks = 20; // 最多检查 20 次（1秒）
            
            const checkInterval = setInterval(() => {
                checkCount++;
                const isDragging = checkDraggingState();
                
                if (!isDragging || checkCount >= maxChecks) {
                    clearInterval(checkInterval);
                    // 额外等待一小段时间确保拖拽完全结束
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

    // 获取工作区状态（滚动位置、缩放等）
    const getWorkspaceState = useCallback(() => {
        try {
            // 尝试从 Blockly 获取工作区状态
            if (window.Blockly && window.Blockly.getMainWorkspace) {
                const workspace = window.Blockly.getMainWorkspace();
                if (workspace) {
                    const state = {
                        scrollX: workspace.scrollX || 0,
                        scrollY: workspace.scrollY || 0,
                        scale: workspace.scale || 1,
                        // 保存更多状态信息
                        startX: workspace.startX || 0,
                        startY: workspace.startY || 0,
                        // 保存当前选中的积木
                        selectedBlockId: workspace.selectedBlockId || null
                    };
                    console.log('[协作] 获取工作区状态:', state);
                    return state;
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
            // 使用 requestAnimationFrame 确保在下一帧渲染时恢复状态
            const restoreState = () => {
                if (window.Blockly && window.Blockly.getMainWorkspace) {
                    const workspace = window.Blockly.getMainWorkspace();
                    if (workspace) {
                        // 先暂停重绘
                        const originalRendered = workspace.rendered;
                        workspace.rendered = false;
                        
                        try {
                            // 恢复滚动位置
                            if (state.scrollX !== undefined && state.scrollY !== undefined) {
                                workspace.scrollX = state.scrollX;
                                workspace.scrollY = state.scrollY;
                            }
                            // 恢复起始位置
                            if (state.startX !== undefined && state.startY !== undefined) {
                                workspace.startX = state.startX;
                                workspace.startY = state.startY;
                            }
                            // 恢复缩放级别
                            if (state.scale !== undefined) {
                                workspace.scale = state.scale;
                            }
                            // 恢复选中状态
                            if (state.selectedBlockId) {
                                const block = workspace.getBlockById(state.selectedBlockId);
                                if (block) {
                                    workspace.selectedBlockId = state.selectedBlockId;
                                }
                            }
                        } finally {
                            // 恢复重绘状态
                            workspace.rendered = originalRendered;
                        }
                        
                        // 使用 translate 来设置工作区偏移
                        if (workspace.updateInverseScreenCTM) {
                            workspace.updateInverseScreenCTM();
                        }
                        
                        // 触发重绘
                        if (workspace.resize) {
                            workspace.resize();
                        }
                        // 如果有 scrollbar，更新滚动条
                        if (workspace.scrollbar) {
                            workspace.scrollbar.resize();
                        }
                        // 重新渲染工作区
                        if (workspace.render) {
                            workspace.render();
                        }
                        
                        console.log('[协作] 已恢复工作区状态:', state);
                    }
                }
            };
            
            // 延迟执行，等待 Blockly 工作区更新完成
            setTimeout(() => {
                requestAnimationFrame(restoreState);
            }, WORKSPACE_RESTORE_DELAY);
        } catch (err) {
            console.warn('[协作] 恢复工作区状态失败:', err);
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
        
        // 发送项目状态给服务器，服务器会转发给新用户
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
    const handleBlockChange = useCallback(async (blockData) => {
        if (isApplyingRemoteChange.current) {
            return;
        }
        
        // 检查是否有积木正在被拖拽，如果有则等待
        if (checkDraggingState()) {
            console.log('[协作] 检测到拖拽中，等待拖拽结束...');
            await waitForDragEnd();
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

        // 再次检查拖拽状态
        if (checkDraggingState()) {
            console.log('[协作] 仍有拖拽，跳过此次更新');
            return;
        }

        // 保存当前工作区状态
        const workspaceState = getWorkspaceState();
        console.log('[协作] 保存工作区状态:', workspaceState);

        try {
            isApplyingRemoteChange.current = true;
            
            console.log('[协作] 正在加载远程项目更新...');
            
            currentVm.loadProject(blockData.projectJSON)
                .then(() => {
                    console.log('[协作] 远程项目更新已加载');
                    lastSyncedJSON.current = blockData.projectJSON;
                    lastSyncTime.current = Date.now();
                    
                    // 恢复工作区状态
                    restoreWorkspaceState(workspaceState);
                })
                .catch(err => {
                    console.error('[协作] 加载远程项目失败:', err);
                })
                .finally(() => {
                    setTimeout(() => {
                        isApplyingRemoteChange.current = false;
                    }, WORKSPACE_RESTORE_DELAY);
                });
            
        } catch (error) {
            console.error('[协作] 处理积木变更失败:', error);
            isApplyingRemoteChange.current = false;
        }
    }, [checkDraggingState, waitForDragEnd, getWorkspaceState, restoreWorkspaceState]);

    // 处理项目同步（新用户加入时收到）
    const handleProjectSync = useCallback(async (syncData) => {
        console.log('[协作] 收到项目同步请求');
        
        // 检查是否是发给自己的
        if (syncData.forUser && syncData.forUser !== currentUserIdRef.current) {
            console.log('[协作] 忽略发给其他用户的项目同步');
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
        // 这样可以避免新用户加入时被错误地加载其他人的空项目
        if (hasReceivedProjectSync.current && !syncData.forUser) {
            console.log('[协作] 已经同步过项目，跳过非定向同步');
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
            
            currentVm.loadProject(syncData.projectJSON)
                .then(() => {
                    console.log('[协作] 同步项目已加载');
                    lastSyncedJSON.current = syncData.projectJSON;
                    lastSyncTime.current = Date.now();
                    hasReceivedProjectSync.current = true;
                    
                    // 恢复工作区状态
                    restoreWorkspaceState(workspaceState);
                    
                    toastManager.success('已同步项目', 2000);
                })
                .catch(err => {
                    console.error('[协作] 加载同步项目失败:', err);
                })
                .finally(() => {
                    setTimeout(() => {
                        isApplyingRemoteChange.current = false;
                    }, WORKSPACE_RESTORE_DELAY);
                });
            
        } catch (error) {
            console.error('[协作] 处理项目同步失败:', error);
            isApplyingRemoteChange.current = false;
        }
    }, [checkDraggingState, waitForDragEnd, getWorkspaceState, restoreWorkspaceState]);

    // 处理协作消息
    const handleCollaborationMessage = useCallback((message) => {
        console.log('[协作] 收到消息:', message.type);
        
        switch (message.type) {
            case 'block_change':
                handleBlockChange(message.data);
                break;
            case 'project_sync':
                handleProjectSync(message.data);
                break;
            default:
                break;
        }
    }, [handleBlockChange, handleProjectSync]);

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
            // 注意：不立即设置 lastSyncedJSON，让新用户等待接收项目同步
            // 如果是新用户，会等待其他用户发送项目
            // 如果是房间第一个用户，会使用自己的项目
            const currentProjectJSON = getCurrentProjectJSON();
            if (currentProjectJSON) {
                // 只有当项目非空时才设置
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
            
            // 更新用户列表
            setConnectedUsers(prev => {
                if (!prev.includes(userId)) {
                    return [...prev, userId];
                }
                return prev;
            });
            
            // 发送当前项目给新用户
            // 延迟发送，确保新用户已经准备好接收
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
            // 如果消息包含当前用户的 ID，保存它
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
            stopPeriodicSync();
            unregisterVMListeners();
            collaborationAPI.disconnect();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // 空依赖数组，只在组件挂载时执行一次
    
    // 不再渲染大面板，协作状态通过 onUserCountChange 回调传递给父组件
    // 由 menu-bar 组件显示简洁的用户数量指示器
    return null;
};

CollaborationManager.propTypes = {
    vm: PropTypes.object.isRequired,
    onCollaborationStart: PropTypes.func,
    onCollaborationEnd: PropTypes.func,
    onUserCountChange: PropTypes.func
};

export default CollaborationManager;
