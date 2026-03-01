// 认证API服务
const API_BASE_URL = 'http://localhost:5000/api';

class AuthAPI {
    /**
     * 注册新用户
     * @param {string} email - 用户邮箱（必须是163邮箱）
     * @param {string} password - 用户密码
     * @returns {Promise<Object>} 包含access_token和user_id的对象
     */
    static async register(email, password) {
        try {
            const response = await fetch(`${API_BASE_URL}/auth/register`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email, password })
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || '注册失败');
            }
            
            return await response.json();
        } catch (error) {
            console.error('注册错误:', error);
            throw error;
        }
    }
    
    /**
     * 用户登录
     * @param {string} email - 用户邮箱
     * @param {string} password - 用户密码
     * @returns {Promise<Object>} 包含access_token和user_id的对象
     */
    static async login(email, password) {
        try {
            const response = await fetch(`${API_BASE_URL}/auth/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email, password })
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || '登录失败');
            }
            
            return await response.json();
        } catch (error) {
            console.error('登录错误:', error);
            throw error;
        }
    }
    
    /**
     * 获取用户项目列表
     * @param {string} token - 访问令牌
     * @returns {Promise<Array>} 项目列表
     */
    static async getProjects(token) {
        try {
            const response = await fetch(`${API_BASE_URL}/projects`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                // 如果token无效，清除本地存储
                if (errorData.code === 'INVALID_TOKEN' || errorData.code === 'TOKEN_EXPIRED') {
                    this.clearAuth();
                    throw new Error('登录已过期，请重新登录');
                }
                throw new Error(errorData.error || '获取项目列表失败');
            }
            
            return await response.json();
        } catch (error) {
            console.error('获取项目列表错误:', error);
            throw error;
        }
    }
    
    /**
     * 创建新项目
     * @param {string} token - 访问令牌
     * @param {string} name - 项目名称
     * @returns {Promise<Object>} 新项目对象
     */
    static async createProject(token, name) {
        try {
            const response = await fetch(`${API_BASE_URL}/projects`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ name })
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                // 如果token无效，清除本地存储
                if (errorData.code === 'INVALID_TOKEN' || errorData.code === 'TOKEN_EXPIRED') {
                    this.clearAuth();
                    throw new Error('登录已过期，请重新登录');
                }
                throw new Error(errorData.error || '创建项目失败');
            }
            
            return await response.json();
        } catch (error) {
            console.error('创建项目错误:', error);
            throw error;
        }
    }
    
    /**
     * 删除项目
     * @param {string} token - 访问令牌
     * @param {number} projectId - 项目ID
     * @returns {Promise<Object>} 响应对象
     */
    static async deleteProject(token, projectId) {
        try {
            const response = await fetch(`${API_BASE_URL}/projects/${projectId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (!response.ok) {
                throw new Error('删除项目失败');
            }
            
            return await response.json();
        } catch (error) {
            console.error('删除项目错误:', error);
            throw error;
        }
    }
    
    /**
     * 保存认证信息到本地存储
     * @param {string} token - 访问令牌
     * @param {number} userId - 用户ID
     */
    static saveAuth(token, userId) {
        localStorage.setItem('auth_token', token);
        localStorage.setItem('user_id', userId);
    }
    
    /**
     * 从本地存储获取认证信息
     * @returns {Object|null} 认证信息对象或null
     */
    static getAuth() {
        const token = localStorage.getItem('auth_token');
        const userId = localStorage.getItem('user_id');
        return token && userId ? { token, userId: parseInt(userId, 10) } : null;
    }
    
    /**
     * 清除本地存储的认证信息
     */
    static clearAuth() {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('user_id');
    }
}

export default AuthAPI;