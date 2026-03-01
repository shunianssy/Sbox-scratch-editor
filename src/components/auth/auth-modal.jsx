import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import Modal from '../modal/modal.jsx';
import { toastManager } from '../toast/toast.jsx';
import './auth-modal.css';

const AuthModal = ({ isOpen, onRequestClose, onAuthSuccess }) => {
    const [activeTab, setActiveTab] = useState('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [showSuccessAnimation, setShowSuccessAnimation] = useState(false);
    
    // 重置状态当模态框打开时
    useEffect(() => {
        if (isOpen) {
            setError('');
            setSuccess('');
            setShowSuccessAnimation(false);
        }
    }, [isOpen]);
    
    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setSuccess('');
        setLoading(true);
        
        try {
            // 导入认证API
            const AuthAPI = (await import('../../lib/auth-api.js')).default;
            
            let result;
            if (activeTab === 'login') {
                result = await AuthAPI.login(email, password);
                setSuccess('✅ 登录成功！欢迎回来，已自动为您保存登录状态');
            } else {
                result = await AuthAPI.register(email, password);
                setSuccess('✅ 注册成功！欢迎加入，已自动为您保存登录状态');
            }
            
            // 显示成功动画
            setShowSuccessAnimation(true);
            
            // 保存认证信息
            AuthAPI.saveAuth(result.access_token, result.user_id);
            
            // 显示全局Toast通知
            if (activeTab === 'login') {
                toastManager.success('登录成功！欢迎回来', 5000);
            } else {
                toastManager.success('注册成功！欢迎加入', 5000);
            }
            
            // 通知父组件认证成功
            onAuthSuccess(result);
            
            // 延迟关闭模态框，让用户看到成功提示（增加到4秒）
            setTimeout(() => {
                onRequestClose();
                // 重置表单状态
                setEmail('');
                setPassword('');
                setSuccess('');
                setError('');
                setShowSuccessAnimation(false);
            }, 4000);
        } catch (err) {
            setError(err.message || '操作失败，请重试');
            setShowSuccessAnimation(false);
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
                
                {success && (
                    <div className={`auth-success ${showSuccessAnimation ? 'auth-success-animate' : ''}`}>
                        <span className="auth-success-icon">✓</span>
                        <span className="auth-success-text">{success}</span>
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
                    
                    {/* 使用原生 button 元素确保表单提交功能正常工作 */}
                    <button
                        type="submit"
                        className="auth-submit-button-native"
                        disabled={loading}
                    >
                        {loading ? '处理中...' : activeTab === 'login' ? '登录' : '注册'}
                    </button>
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
