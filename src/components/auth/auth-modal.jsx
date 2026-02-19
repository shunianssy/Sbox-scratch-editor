import React, { useState } from 'react';
import PropTypes from 'prop-types';
import Modal from '../modal/modal.jsx';
import Button from '../button/button.jsx';
import './auth-modal.css';

const AuthModal = ({ isOpen, onRequestClose, onAuthSuccess }) => {
    const [activeTab, setActiveTab] = useState('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    
    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        
        try {
            // 导入认证API
            const AuthAPI = (await import('../../lib/auth-api.js')).default;
            
            let result;
            if (activeTab === 'login') {
                result = await AuthAPI.login(email, password);
            } else {
                result = await AuthAPI.register(email, password);
            }
            
            // 保存认证信息
            AuthAPI.saveAuth(result.access_token, result.user_id);
            
            // 通知父组件认证成功
            onAuthSuccess(result);
            
            // 关闭模态框
            onRequestClose();
        } catch (err) {
            setError(err.message || '操作失败，请重试');
        } finally {
            setLoading(false);
        }
    };
    
    return (
        <Modal
            isOpen={isOpen}
            onRequestClose={onRequestClose}
            className="auth-modal"
            contentLabel="登录/注册"
        >
            <div className="auth-modal-content">
                <h2>账号管理</h2>
                
                <div className="auth-tabs">
                    <button
                        className={`auth-tab ${activeTab === 'login' ? 'active' : ''}`}
                        onClick={() => setActiveTab('login')}
                    >
                        登录
                    </button>
                    <button
                        className={`auth-tab ${activeTab === 'register' ? 'active' : ''}`}
                        onClick={() => setActiveTab('register')}
                    >
                        注册
                    </button>
                </div>
                
                {error && (
                    <div className="auth-error">
                        {error}
                    </div>
                )}
                
                <form onSubmit={handleSubmit} className="auth-form">
                    <div className="form-group">
                        <label htmlFor="email">邮箱</label>
                        <input
                            type="email"
                            id="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="请输入163邮箱"
                            required
                        />
                    </div>
                    
                    <div className="form-group">
                        <label htmlFor="password">密码</label>
                        <input
                            type="password"
                            id="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="请输入密码"
                            required
                        />
                    </div>
                    
                    <Button
                        className="auth-submit-button"
                        type="submit"
                        variant="primary"
                        disabled={loading}
                    >
                        {loading ? '处理中...' : activeTab === 'login' ? '登录' : '注册'}
                    </Button>
                </form>
                
                {activeTab === 'register' && (
                    <div className="auth-info">
                        <p>请注意：</p>
                        <ul>
                            <li>请使用163邮箱注册</li>
                            <li>密码长度至少6位</li>
                            <li>注册即表示同意使用条款</li>
                        </ul>
                    </div>
                )}
            </div>
        </Modal>
    );
};

AuthModal.propTypes = {
    isOpen: PropTypes.bool.isRequired,
    onRequestClose: PropTypes.func.isRequired,
    onAuthSuccess: PropTypes.func.isRequired
};

export default AuthModal;