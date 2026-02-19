import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { getInviteToken } from '../../lib/url-utils';
import collaborationAPI from '../../lib/collaboration-api';
import AuthAPI from '../../lib/auth-api';
import './collaboration-manager.css';

const CollaborationManager = ({ vm, onCollaborationStart, onCollaborationEnd }) => {
    const [isCollaborating, setIsCollaborating] = useState(false);
    const [connectedUsers, setConnectedUsers] = useState([]);
    const [connectionStatus, setConnectionStatus] = useState('disconnected'); // disconnected, connecting, connected
    const [error, setError] = useState('');
    
    // 处理协作连接
    const handleCollaboration = async () => {
        const inviteToken = getInviteToken();
        const auth = AuthAPI.getAuth();
        
        if (!inviteToken) {
            setError('未找到邀请token');
            return;
        }
        
        if (!auth) {
            setError('请先登录');
            return;
        }
        
        try {
            setConnectionStatus('connecting');
            setError('');
            
            // 连接到协作服务器
            await collaborationAPI.connect(inviteToken, auth.token);
            
            // 注册事件回调
            collaborationAPI.on('connect', () => {
                setConnectionStatus('connected');
                setIsCollaborating(true);
                if (onCollaborationStart) {
                    onCollaborationStart();
                }
            });
            
            collaborationAPI.on('disconnect', () => {
                setConnectionStatus('disconnected');
                setIsCollaborating(false);
                setConnectedUsers([]);
                if (onCollaborationEnd) {
                    onCollaborationEnd();
                }
            });
            
            collaborationAPI.on('error', (err) => {
                setError(`连接错误: ${err.message}`);
                setConnectionStatus('disconnected');
                setIsCollaborating(false);
            });
            
            collaborationAPI.on('userJoined', (userId) => {
                setConnectedUsers(prev => [...prev, userId]);
            });
            
            collaborationAPI.on('userLeft', (userId) => {
                setConnectedUsers(prev => prev.filter(id => id !== userId));
            });
            
            collaborationAPI.on('message', (message) => {
                handleCollaborationMessage(message);
            });
            
        } catch (err) {
            setError(`连接失败: ${err.message}`);
            setConnectionStatus('disconnected');
        }
    };
    
    // 处理协作消息
    const handleCollaborationMessage = (message) => {
        switch (message.type) {
            case 'block_change':
                // 处理积木变更
                handleBlockChange(message.data);
                break;
            case 'stage_change':
                // 处理舞台变更
                handleStageChange(message.data);
                break;
            case 'sprite_change':
                // 处理精灵变更
                handleSpriteChange(message.data);
                break;
            default:
                break;
        }
    };
    
    // 处理积木变更
    const handleBlockChange = (blockData) => {
        // 这里需要根据实际的VM API来实现积木变更
        // 例如：vm.addBlock(blockData) 或其他相关方法
        console.log('处理积木变更:', blockData);
    };
    
    // 处理舞台变更
    const handleStageChange = (stageData) => {
        // 这里需要根据实际的VM API来实现舞台变更
        console.log('处理舞台变更:', stageData);
    };
    
    // 处理精灵变更
    const handleSpriteChange = (spriteData) => {
        // 这里需要根据实际的VM API来实现精灵变更
        console.log('处理精灵变更:', spriteData);
    };
    
    // 发送积木变更
    const sendBlockChange = (blockData) => {
        if (isCollaborating) {
            collaborationAPI.sendBlockChange(blockData);
        }
    };
    
    // 发送舞台变更
    const sendStageChange = (stageData) => {
        if (isCollaborating) {
            collaborationAPI.sendStageChange(stageData);
        }
    };
    
    // 发送精灵变更
    const sendSpriteChange = (spriteData) => {
        if (isCollaborating) {
            collaborationAPI.sendSpriteChange(spriteData);
        }
    };
    
    // 组件挂载时检查邀请token并尝试连接
    useEffect(() => {
        const inviteToken = getInviteToken();
        if (inviteToken) {
            handleCollaboration();
        }
        
        // 组件卸载时断开连接
        return () => {
            if (isCollaborating) {
                collaborationAPI.disconnect();
            }
        };
    }, []);
    
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
                    <h3>实时协作</h3>
                    {renderStatusIndicator()}
                    <div className="connected-users">
                        <h4>在线用户</h4>
                        <ul>
                            {connectedUsers.map((userId, index) => (
                                <li key={userId}>
                                    用户 {userId.substring(0, 8)}...
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