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
 * @returns {boolean} 是否包含邀请token
 */
export const hasInviteToken = () => {
    return getQueryParam('token') !== null;
};

/**
 * 获取邀请token
 * @returns {string|null} 邀请token或null
 */
export const getInviteToken = () => {
    return getQueryParam('token');
};

/**
 * 从URL中移除邀请token
 */
export const removeInviteToken = () => {
    const url = new URL(window.location.href);
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
    url.searchParams.set('token', token);
    return url.toString();
};