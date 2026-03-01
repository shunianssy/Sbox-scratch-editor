import React, { useEffect, useState, useCallback, useRef, useImperativeHandle, forwardRef } from 'react';
import PropTypes from 'prop-types';
import { getInviteToken } from '../../lib/url-utils';
import collaborationAPI from '../../lib/collaboration-api';
import AuthAPI from '../../lib/auth-api';
import { toastManager } from '../toast/toast.jsx';
import { incrementalSync, computeTargetsDiff, computeBlocksDiff } from '../../lib/incremental-sync';
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
const CollaborationManager = forwardRef(({ vm, onCollaborationStart, onCollaborationEnd, onUserCountChange, onSyncStatusChange, onPendingRemoteChangesChange }, ref) => {
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
    // 缓存的远程修改（其他用户的同步数据）
    const pendingRemoteChanges = useRef([]);
    // 是否有待合并的远程修改
    const [hasPendingRemoteChanges, setHasPendingRemoteChanges] = useState(false);

    // 暴露方法给父组件调用
    useImperativeHandle(ref, () => ({
        // 手动同步方法
        sync: () => handleManualSync(),
        // 检查是否有本地变更
        hasLocalChanges: () => hasLocalChanges,
        // 获取同步状态
        getSyncStatus: () => syncStatus,
        // 获取连接状态
        isConnected: () => connectionStatus === 'connected',
        // 检查是否有待合并的远程修改
        hasPendingRemoteChanges: () => hasPendingRemoteChanges,
        // 获取待合并的远程修改数量
        getPendingRemoteChangesCount: () => pendingRemoteChanges.current.length
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

    // 待合并远程修改状态变化时通知父组件
    useEffect(() => {
        if (onPendingRemoteChangesChange) {
            onPendingRemoteChangesChange(hasPendingRemoteChanges);
        }
    }, [hasPendingRemoteChanges, onPendingRemoteChangesChange]);

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

    /**
     * 合并项目数据（保留本地修改 + 添加远程修改）
     * 策略：
     * 1. 保留本地的所有精灵和代码
     * 2. 添加远程新增的精灵（本地没有的）
     * 3. 对于同名精灵，合并积木代码（保留本地 + 添加远程新增的）
     * 4. 合并变量、列表等资源
     * 
     * @param {Object} localJSON - 本地项目 JSON
     * @param {Object} remoteJSON - 远程项目 JSON
     * @returns {Object} 合并后的项目 JSON
     */
    const mergeProjectJSON = useCallback((localJSON, remoteJSON) => {
        try {
            const local = typeof localJSON === 'string' ? JSON.parse(localJSON) : localJSON;
            const remote = typeof remoteJSON === 'string' ? JSON.parse(remoteJSON) : remoteJSON;

            if (!local || !local.targets) {
                console.log('[协作] 本地项目为空，使用远程项目');
                return remoteJSON;
            }

            if (!remote || !remote.targets) {
                console.log('[协作] 远程项目为空，保留本地项目');
                return localJSON;
            }

            console.log('[协作] 开始合并项目...');
            console.log('[协作] 本地精灵数:', local.targets.length);
            console.log('[协作] 远程精灵数:', remote.targets.length);

            // 创建合并后的项目对象
            const merged = {
                ...local,
                targets: [],
                meta: {
                    ...local.meta,
                    ...remote.meta,
                    semver: local.meta?.semver || '3.0.0'
                }
            };

            // 本地精灵映射（按名称和ID）
            const localTargetMap = new Map();
            const localTargetIds = new Set();

            local.targets.forEach(target => {
                localTargetMap.set(target.name, target);
                localTargetIds.add(target.id);
            });

            // 远程精灵映射（按ID）
            const remoteTargetById = new Map();
            remote.targets.forEach(target => {
                remoteTargetById.set(target.id, target);
            });

            // 合并每个精灵
            remote.targets.forEach(remoteTarget => {
                const localTarget = localTargetMap.get(remoteTarget.name);
                
                if (!localTarget) {
                    // 远程精灵在本地不存在，直接添加
                    console.log('[协作] 添加远程新精灵:', remoteTarget.name);
                    merged.targets.push(remoteTarget);
                } else if (localTarget.id === remoteTarget.id) {
                    // 同名且同ID，合并积木代码
                    console.log('[协作] 合并同名精灵:', remoteTarget.name);
                    const mergedTarget = mergeTargetBlocks(localTarget, remoteTarget);
                    merged.targets.push(mergedTarget);
                } else {
                    // 同名但不同ID，添加远程版本（重命名）
                    const renamedTarget = {
                        ...remoteTarget,
                        name: `${remoteTarget.name}_远程`,
                        id: `${remoteTarget.id}_remote`
                    };
                    console.log('[协作] 添加远程同名精灵（重命名）:', renamedTarget.name);
                    merged.targets.push(renamedTarget);
                }
            });

            // 添加本地独有的精灵（远程没有的）
            const mergedNames = new Set(merged.targets.map(t => t.name));
            local.targets.forEach(localTarget => {
                if (!mergedNames.has(localTarget.name)) {
                    console.log('[协作] 保留本地独有精灵:', localTarget.name);
                    merged.targets.push(localTarget);
                }
            });

            console.log('[协作] 合并后精灵总数:', merged.targets.length);

            // 合并扩展列表（去重）
            const localExtensions = new Set(local.extensionHost || []);
            const remoteExtensions = remote.extensionHost || [];
            remoteExtensions.forEach(ext => localExtensions.add(ext));
            if (localExtensions.size > 0) {
                merged.extensionHost = Array.from(localExtensions);
            }

            // 合并监控器（保留本地 + 添加远程新增的）
            const localMonitorIds = new Set((local.monitors || []).map(m => m.id));
            const mergedMonitors = [...(local.monitors || [])];
            (remote.monitors || []).forEach(monitor => {
                if (!localMonitorIds.has(monitor.id)) {
                    mergedMonitors.push(monitor);
                }
            });
            merged.monitors = mergedMonitors;

            return JSON.stringify(merged);
        } catch (error) {
            console.error('[协作] 合并项目失败:', error);
            // 合并失败时保留本地版本
            return localJSON;
        }
    }, []);

    /**
     * 合并两个同名精灵的积木代码
     * 策略：
     * 1. 保留本地独有的积木（远程没有的）
     * 2. 添加远程新增的积木（本地没有的）
     * 3. 对于双方都有的积木，使用远程版本覆盖（因为远程是最新同步的）
     * 
     * @param {Object} localTarget - 本地精灵
     * @param {Object} remoteTarget - 远程精灵
     * @returns {Object} 合并后的精灵
     */
    const mergeTargetBlocks = useCallback((localTarget, remoteTarget) => {
        // 开始合并
        const merged = { ...localTarget };

        // 合并积木块（blocks）
        if (remoteTarget.blocks) {
            const localBlocks = localTarget.blocks || {};
            const remoteBlocks = remoteTarget.blocks;

            // 创建合并后的blocks对象，从远程开始（远程版本优先）
            const mergedBlocks = { ...remoteBlocks };

            // 添加本地独有的积木（远程没有的）
            let addedLocalBlocks = 0;
            let updatedBlocks = 0;
            Object.keys(localBlocks).forEach(blockId => {
                if (!mergedBlocks[blockId]) {
                    // 本地独有的积木，添加到合并结果
                    mergedBlocks[blockId] = localBlocks[blockId];
                    addedLocalBlocks++;
                }
                // 如果远程也有这个积木，已经使用远程版本，不需要额外处理
            });

            merged.blocks = mergedBlocks;
            console.log(`[协作] 精灵 ${localTarget.name} 合并结果: 保留 ${addedLocalBlocks} 个本地独有积木, 使用 ${Object.keys(remoteBlocks).length} 个远程积木`);
        }

        // 合并变量（variables）
        if (remoteTarget.variables) {
            const localVars = localTarget.variables || {};
            const mergedVars = { ...localVars };

            Object.keys(remoteTarget.variables).forEach(varId => {
                if (!mergedVars[varId]) {
                    mergedVars[varId] = remoteTarget.variables[varId];
                }
            });

            merged.variables = mergedVars;
        }

        // 合并列表（lists）
        if (remoteTarget.lists) {
            const localLists = localTarget.lists || {};
            const mergedLists = { ...localLists };

            Object.keys(remoteTarget.lists).forEach(listId => {
                if (!mergedLists[listId]) {
                    mergedLists[listId] = remoteTarget.lists[listId];
                }
            });

            merged.lists = mergedLists;
        }

        // 合并广播消息（broadcasts）
        if (remoteTarget.broadcasts) {
            const localBroadcasts = localTarget.broadcasts || {};
            merged.broadcasts = { ...localBroadcasts, ...remoteTarget.broadcasts };
        }

        // 合并造型（costumes）- 添加远程新增的造型
        if (remoteTarget.costumes && remoteTarget.costumes.length > 0) {
            const localCostumeNames = new Set((localTarget.costumes || []).map(c => c.name));
            const mergedCostumes = [...(localTarget.costumes || [])];

            remoteTarget.costumes.forEach(costume => {
                if (!localCostumeNames.has(costume.name)) {
                    mergedCostumes.push(costume);
                }
            });

            merged.costumes = mergedCostumes;
        }

        // 合并声音（sounds）- 添加远程新增的声音
        if (remoteTarget.sounds && remoteTarget.sounds.length > 0) {
            const localSoundNames = new Set((localTarget.sounds || []).map(s => s.name));
            const mergedSounds = [...(localTarget.sounds || [])];

            remoteTarget.sounds.forEach(sound => {
                if (!localSoundNames.has(sound.name)) {
                    mergedSounds.push(sound);
                }
            });

            merged.sounds = mergedSounds;
        }

        return merged;
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

    /**
     * 增量应用远程修改（核心方法）
     * 不重新加载整个项目，只更新变化的部分
     * 保证编辑区的原生体验
     */
    const applyRemoteChangesIncrementally = useCallback(async (remoteProjectJSON) => {
        const currentVm = vmRef.current;
        if (!currentVm) {
            console.warn('[协作] VM 未初始化');
            return { success: false, needFullLoad: true };
        }

        // 获取本地项目数据
        const localProjectJSON = getCurrentProjectJSON();
        if (!localProjectJSON) {
            console.warn('[协作] 无法获取本地项目数据');
            return { success: false, needFullLoad: true };
        }

        console.log('[协作] 开始增量应用远程修改...');

        // 保存当前工作区状态
        const workspaceState = getWorkspaceState();

        try {
            // 使用增量同步
            const result = await incrementalSync(currentVm, localProjectJSON, remoteProjectJSON);

            if (result.success) {
                console.log(`[协作] 增量同步成功，变更数量: ${result.changes}`);
                
                // 恢复工作区状态
                restoreWorkspaceState(workspaceState);
                
                // 更新同步状态
                lastSyncedJSON.current = remoteProjectJSON;
                
                return { success: true, changes: result.changes };
            } else if (result.needFullLoad) {
                console.log('[协作] 增量同步失败，需要完整加载:', result.reason);
                return { success: false, needFullLoad: true };
            } else {
                console.warn('[协作] 增量同步失败:', result.reason);
                return { success: false, needFullLoad: true };
            }
        } catch (error) {
            console.error('[协作] 增量同步出错:', error);
            return { success: false, needFullLoad: true, error };
        }
    }, [getCurrentProjectJSON, getWorkspaceState, restoreWorkspaceState]);

    // 手动同步方法（核心功能）
    // 流程：上传本地修改 -> 增量应用远程修改（不重新加载整个项目）
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
            const currentVm = vmRef.current;
            const projectJSON = getCurrentProjectJSON();
            if (!projectJSON) {
                throw new Error('无法获取项目数据');
            }

            // 步骤1：发送本地修改到服务器（上传自己的修改）
            collaborationAPI.send({
                type: 'manual_sync',
                data: {
                    projectJSON: projectJSON,
                    targetId: currentVm && currentVm.editingTarget ? currentVm.editingTarget.id : null,
                    timestamp: Date.now(),
                    userId: currentUserIdRef.current
                }
            });
            console.log('[协作] 已上传本地修改');

            // 步骤2：增量应用缓存的远程修改（核心改进）
            const pendingChanges = pendingRemoteChanges.current;

            if (pendingChanges.length > 0) {
                console.log('[协作] 开始增量应用缓存的远程修改，数量:', pendingChanges.length);

                // 合并所有远程修改为一个项目 JSON
                let mergedRemoteJSON = projectJSON;
                for (const remoteChange of pendingChanges) {
                    mergedRemoteJSON = mergeProjectJSON(mergedRemoteJSON, remoteChange.projectJSON);
                }

                // 尝试增量同步
                isApplyingRemoteChange.current = true;
                
                try {
                    const result = await applyRemoteChangesIncrementally(mergedRemoteJSON);

                    if (result.success) {
                        console.log(`[协作] 增量同步成功，变更数量: ${result.changes}`);
                        toastManager.success(`同步成功！已增量更新 ${result.changes} 处变更`, 2000);
                    } else if (result.needFullLoad) {
                        // 增量同步失败，回退到完整加载
                        console.log('[协作] 增量同步失败，回退到完整加载');
                        
                        const workspaceState = getWorkspaceState();
                        
                        await currentVm.loadProject(mergedRemoteJSON);
                        
                        console.log('[协作] 完整加载成功');
                        restoreWorkspaceState(workspaceState);
                        
                        toastManager.success('同步成功！（完整加载）', 2000);
                    }
                } finally {
                    setTimeout(() => {
                        isApplyingRemoteChange.current = false;
                    }, WORKSPACE_RESTORE_DELAY);
                }

                // 清空缓存
                pendingRemoteChanges.current = [];
                setHasPendingRemoteChanges(false);
                console.log('[协作] 已清空远程修改缓存');
            } else {
                console.log('[协作] 没有待合并的远程修改');
                toastManager.success('同步成功！本地修改已上传', 2000);
            }

            // 更新同步状态
            lastSyncedJSON.current = getCurrentProjectJSON();
            localChangesCount.current = 0;
            setHasLocalChanges(false);
            setSyncStatus('synced');

            console.log('[协作] 同步完成');

        } catch (error) {
            console.error('[协作] 同步失败:', error);
            setSyncStatus('error');
            toastManager.error(`同步失败: ${error.message}`, 3000);
        }
    }, [syncStatus, checkDraggingState, getCurrentProjectJSON, mergeProjectJSON, getWorkspaceState, restoreWorkspaceState, applyRemoteChangesIncrementally]);

    // 处理同步响应（缓存远程修改，不自动加载）
    const handleSyncResponse = useCallback(async (syncData, fromUserId) => {
        console.log('[协作] 收到远程同步数据，发送者:', fromUserId, '当前用户:', currentUserIdRef.current);

        // 忽略自己发送的同步数据
        if (fromUserId && fromUserId === currentUserIdRef.current) {
            console.log('[协作] 忽略自己发送的同步数据');
            return;
        }

        if (!syncData.projectJSON) {
            console.warn('[协作] 同步响应中没有项目数据');
            return;
        }

        // 缓存远程修改，等待用户点击同步按钮时合并
        pendingRemoteChanges.current.push({
            projectJSON: syncData.projectJSON,
            targetId: syncData.targetId,
            timestamp: syncData.timestamp || Date.now(),
            userId: fromUserId
        });

        // 更新状态，提示用户有待合并的远程修改
        setHasPendingRemoteChanges(true);

        console.log('[协作] 远程修改已缓存，当前缓存数量:', pendingRemoteChanges.current.length);
        toastManager.info('有新的远程修改，点击同步按钮合并', 3000);
    }, []);

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
        console.log('[协作] 收到消息:', message.type, '来自用户:', message.user_id);
        
        switch (message.type) {
            case 'sync_response':
                // 收到其他用户的同步响应，缓存他们的修改
                if (message.data && message.data.projectJSON) {
                    handleSyncResponse(message.data, message.user_id);
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
    onSyncStatusChange: PropTypes.func,
    onPendingRemoteChangesChange: PropTypes.func
};

CollaborationManager.displayName = 'CollaborationManager';

export default CollaborationManager;
