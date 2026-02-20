import React, { useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';
import './toast.css';

/**
 * Toast通知组件
 * 用于显示全局通知消息
 */
const Toast = ({ message, type, duration, onClose }) => {
    const [isVisible, setIsVisible] = useState(false);
    const [isExiting, setIsExiting] = useState(false);

    useEffect(() => {
        // 入场动画
        requestAnimationFrame(() => {
            setIsVisible(true);
        });

        // 自动关闭
        const timer = setTimeout(() => {
            handleClose();
        }, duration);

        return () => clearTimeout(timer);
    }, [duration]);

    // 处理关闭
    const handleClose = useCallback(() => {
        setIsExiting(true);
        setTimeout(() => {
            setIsVisible(false);
            onClose();
        }, 300); // 等待退出动画完成
    }, [onClose]);

    if (!isVisible && !isExiting) return null;

    return (
        <div className={`toast-container ${isVisible && !isExiting ? 'toast-visible' : ''} ${isExiting ? 'toast-exiting' : ''}`}>
            <div className={`toast toast-${type}`}>
                <span className="toast-icon">
                    {type === 'success' && '✓'}
                    {type === 'error' && '✗'}
                    {type === 'warning' && '⚠'}
                    {type === 'info' && 'ℹ'}
                </span>
                <span className="toast-message">{message}</span>
                <button className="toast-close" onClick={handleClose}>
                    ×
                </button>
            </div>
        </div>
    );
};

Toast.propTypes = {
    message: PropTypes.string.isRequired,
    type: PropTypes.oneOf(['success', 'error', 'warning', 'info']),
    duration: PropTypes.number,
    onClose: PropTypes.func.isRequired
};

Toast.defaultProps = {
    type: 'info',
    duration: 3000
};

/**
 * Toast管理器
 * 用于在应用中显示Toast通知
 */
export class ToastManager {
    constructor() {
        this.toasts = [];
        this.listeners = [];
    }

    // 显示Toast
    show(message, type = 'info', duration = 3000) {
        const id = Date.now();
        const toast = { id, message, type, duration };
        this.toasts.push(toast);
        this.notifyListeners();
        return id;
    }

    // 显示成功Toast
    success(message, duration = 3000) {
        return this.show(message, 'success', duration);
    }

    // 显示错误Toast
    error(message, duration = 4000) {
        return this.show(message, 'error', duration);
    }

    // 显示警告Toast
    warning(message, duration = 3500) {
        return this.show(message, 'warning', duration);
    }

    // 显示信息Toast
    info(message, duration = 3000) {
        return this.show(message, 'info', duration);
    }

    // 移除Toast
    remove(id) {
        this.toasts = this.toasts.filter(t => t.id !== id);
        this.notifyListeners();
    }

    // 添加监听器
    addListener(listener) {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    // 通知所有监听器
    notifyListeners() {
        this.listeners.forEach(listener => listener(this.toasts));
    }
}

// 全局Toast实例
export const toastManager = new ToastManager();

/**
 * Toast容器组件
 * 用于渲染所有Toast通知
 */
export const ToastContainer = () => {
    const [toasts, setToasts] = useState([]);

    useEffect(() => {
        const unsubscribe = toastManager.addListener(setToasts);
        return unsubscribe;
    }, []);

    return (
        <div className="toast-root">
            {toasts.map((toast, index) => (
                <Toast
                    key={toast.id}
                    message={toast.message}
                    type={toast.type}
                    duration={toast.duration}
                    onClose={() => toastManager.remove(toast.id)}
                />
            ))}
        </div>
    );
};

export default Toast;
