// URL工具函数

/**
 * 从URL中获取查询参数
 * @param {string} name - 参数名称
 * @returns {string|null} 参数值或null
 */
export const getQueryParam = (name) => {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(name);
};

/**
 * 检查URL中是否包含邀请token
 * 支持 invite 和 token 两种参数名
 * @returns {boolean} 是否包含邀请token
 */
export const hasInviteToken = () => {
    return getQueryParam('invite') !== null || getQueryParam('token') !== null;
};

/**
 * 获取邀请token
 * 优先使用 invite 参数，兼容 token 参数
 * @returns {string|null} 邀请token或null
 */
export const getInviteToken = () => {
    // 优先使用 invite 参数
    const inviteToken = getQueryParam('invite');
    if (inviteToken) {
        return inviteToken;
    }
    // 兼容旧的 token 参数
    return getQueryParam('token');
};

/**
 * 从URL中移除邀请token
 */
export const removeInviteToken = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('invite');
    url.searchParams.delete('token');
    window.history.replaceState({}, document.title, url.toString());
};

/**
 * 构建带有邀请token的URL
 * @param {string} token - 邀请token
 * @returns {string} 带有邀请token的URL
 */
export const buildInviteUrl = (token) => {
    const url = new URL(window.location.origin);
    url.searchParams.set('invite', token);
    return url.toString();
};