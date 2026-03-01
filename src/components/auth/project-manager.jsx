import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import Modal from '../modal/modal.jsx';
import Button from '../button/button.jsx';
import './project-manager.css';

const ProjectManager = ({ isOpen, onRequestClose, authToken, onRequireLogin }) => {
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [newProjectName, setNewProjectName] = useState('');
    const [creatingProject, setCreatingProject] = useState(false);
    
    // 获取项目列表
    const fetchProjects = async () => {
        setLoading(true);
        setError('');
        
        try {
            const AuthAPI = (await import('../../lib/auth-api.js')).default;
            const projectList = await AuthAPI.getProjects(authToken);
            setProjects(projectList);
        } catch (err) {
            setError(err.message || '获取项目列表失败');
            // 如果需要重新登录，通知父组件
            if (err.message && err.message.includes('重新登录')) {
                if (onRequireLogin) {
                    setTimeout(() => {
                        onRequestClose();
                        onRequireLogin();
                    }, 1500);
                }
            }
        } finally {
            setLoading(false);
        }
    };
    
    // 创建新项目
    const handleCreateProject = async () => {
        if (!newProjectName.trim()) {
            setError('请输入项目名称');
            return;
        }
        
        setCreatingProject(true);
        setError('');
        
        try {
            const AuthAPI = (await import('../../lib/auth-api.js')).default;
            const newProject = await AuthAPI.createProject(authToken, newProjectName);
            setProjects([...projects, newProject]);
            setNewProjectName('');
        } catch (err) {
            setError(err.message || '创建项目失败');
            // 如果需要重新登录，通知父组件
            if (err.message && err.message.includes('重新登录')) {
                if (onRequireLogin) {
                    setTimeout(() => {
                        onRequestClose();
                        onRequireLogin();
                    }, 1500);
                }
            }
        } finally {
            setCreatingProject(false);
        }
    };
    
    // 复制邀请链接
    const handleCopyInviteLink = (token) => {
        const inviteLink = `${window.location.origin}?token=${token}`;
        navigator.clipboard.writeText(inviteLink)
            .then(() => {
                alert('邀请链接已复制到剪贴板');
            })
            .catch(() => {
                alert('复制失败，请手动复制链接');
            });
    };
    
    // 组件挂载时获取项目列表
    useEffect(() => {
        if (isOpen && authToken) {
            fetchProjects();
        }
    }, [isOpen, authToken]);
    
    return (
        <Modal
            isOpen={isOpen}
            onRequestClose={onRequestClose}
            className="project-manager-modal"
            contentLabel="项目管理"
        >
            <div className="project-manager-content">
                <h2>我的项目</h2>
                
                {error && (
                    <div className="project-error">
                        {error}
                    </div>
                )}
                
                {/* 创建新项目 */}
                <div className="create-project-section">
                    <h3>创建新项目</h3>
                    <div className="create-project-form">
                        <input
                            type="text"
                            value={newProjectName}
                            onChange={(e) => setNewProjectName(e.target.value)}
                            placeholder="输入项目名称"
                            disabled={creatingProject}
                        />
                        <Button
                            variant="primary"
                            onClick={handleCreateProject}
                            disabled={creatingProject || !newProjectName.trim()}
                        >
                            {creatingProject ? '创建中...' : '创建'}
                        </Button>
                    </div>
                </div>
                
                {/* 项目列表 */}
                <div className="projects-list-section">
                    <h3>项目列表</h3>
                    {loading ? (
                        <div className="loading">加载中...</div>
                    ) : projects.length === 0 ? (
                        <div className="no-projects">暂无项目，点击上方创建新项目</div>
                    ) : (
                        <ul className="projects-list">
                            {projects.map((project) => (
                                <li key={project.id} className="project-item">
                                    <div className="project-info">
                                        <h4>{project.name}</h4>
                                        <p className="project-token">邀请Token: {project.token}</p>
                                        <p className="project-date">创建于: {new Date(project.created_at).toLocaleString()}</p>
                                    </div>
                                    <div className="project-actions">
                                        <Button
                                            variant="secondary"
                                            onClick={() => handleCopyInviteLink(project.token)}
                                        >
                                            复制邀请链接
                                        </Button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
                
                {/* 说明 */}
                <div className="project-manager-info">
                    <h3>使用说明</h3>
                    <ul>
                        <li>每个项目对应一个唯一的邀请Token</li>
                        <li>通过邀请链接可以邀请其他用户协作编辑</li>
                        <li>协作时会自动禁用整理积木功能，避免冲突</li>
                    </ul>
                </div>
            </div>
        </Modal>
    );
};

ProjectManager.propTypes = {
    isOpen: PropTypes.bool.isRequired,
    onRequestClose: PropTypes.func.isRequired,
    authToken: PropTypes.string,
    onRequireLogin: PropTypes.func
};

ProjectManager.defaultProps = {
    authToken: null,
    onRequireLogin: null
};

export default ProjectManager;