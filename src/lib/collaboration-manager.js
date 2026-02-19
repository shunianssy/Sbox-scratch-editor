// 协作模式管理工具

/**
 * 禁用整理积木功能
 */
export const disableCleanUp = () => {
    console.log('禁用整理积木功能');
    
    // 等待Blockly加载完成
    const checkBlockly = setInterval(() => {
        if (window.Blockly) {
            clearInterval(checkBlockly);
            
            // 保存原始的cleanUp方法
            window.originalCleanUp = window.Blockly.WorkspaceSvg.prototype.cleanUp;
            
            // 重写cleanUp方法，在协作模式下禁用
            window.Blockly.WorkspaceSvg.prototype.cleanUp = function() {
                console.log('协作模式下禁用整理积木功能');
                // 可以选择显示一个提示信息
                alert('协作模式下禁用整理积木功能，以避免冲突');
            };
            
            // 禁用上下文菜单中的整理选项
            if (window.Blockly.ContextMenu) {
                const originalShow = window.Blockly.ContextMenu.show;
                window.Blockly.ContextMenu.show = function(e, menuOptions, rtl) {
                    // 过滤掉整理积木相关的选项
                    const filteredOptions = menuOptions.filter(option => {
                        return option.text !== window.Blockly.Msg.CLEAN_UP;
                    });
                    originalShow.call(this, e, filteredOptions, rtl);
                };
            }
        }
    }, 100);
};

/**
 * 启用整理积木功能
 */
export const enableCleanUp = () => {
    console.log('启用整理积木功能');
    
    // 恢复原始的cleanUp方法
    if (window.originalCleanUp) {
        window.Blockly.WorkspaceSvg.prototype.cleanUp = window.originalCleanUp;
    }
    
    // 恢复原始的上下文菜单
    if (window.originalContextMenuShow) {
        window.Blockly.ContextMenu.show = window.originalContextMenuShow;
    }
};

/**
 * 检查是否处于协作模式
 * @returns {boolean} 是否处于协作模式
 */
export const isInCollaborationMode = () => {
    // 这里可以根据实际的协作状态检查逻辑
    return window.isCollaborating || false;
};

/**
 * 设置协作模式状态
 * @param {boolean} isCollaborating - 是否处于协作模式
 */
export const setCollaborationMode = (isCollaborating) => {
    window.isCollaborating = isCollaborating;
    
    if (isCollaborating) {
        disableCleanUp();
    } else {
        enableCleanUp();
    }
};