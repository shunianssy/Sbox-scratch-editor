/**
 * 增量同步工具函数
 * 
 * 核心思路：
 * 1. 比较本地和远程的积木块差异
 * 2. 只同步差异部分（新增、删除、修改的积木块）
 * 3. 使用 VM 的 blocks API 直接操作积木块，而不是重新加载整个项目
 * 
 * 这样可以保证编辑区的原生体验，不会出现卡顿
 */

/**
 * 比较两个积木块是否相同
 * @param {Object} block1 - 第一个积木块
 * @param {Object} block2 - 第二个积木块
 * @returns {boolean} 是否相同
 */
const isBlockEqual = (block1, block2) => {
    if (!block1 || !block2) return block1 === block2;
    
    // 比较关键字段
    if (block1.opcode !== block2.opcode) return false;
    
    // 比较字段
    const fields1 = block1.fields || {};
    const fields2 = block2.fields || {};
    const fieldKeys1 = Object.keys(fields1);
    const fieldKeys2 = Object.keys(fields2);
    
    if (fieldKeys1.length !== fieldKeys2.length) return false;
    
    for (const key of fieldKeys1) {
        if (fields1[key].value !== fields2[key].value) return false;
    }
    
    // 比较输入
    const inputs1 = block1.inputs || {};
    const inputs2 = block2.inputs || {};
    const inputKeys1 = Object.keys(inputs1);
    const inputKeys2 = Object.keys(inputs2);
    
    if (inputKeys1.length !== inputKeys2.length) return false;
    
    for (const key of inputKeys1) {
        if (inputs1[key].block !== inputs2[key].block ||
            inputs1[key].shadow !== inputs2[key].shadow) {
            return false;
        }
    }
    
    // 比较下一个积木块
    if (block1.next !== block2.next) return false;
    
    // 比较父积木块
    if (block1.parent !== block2.parent) return false;
    
    return true;
};

/**
 * 计算积木块差异
 * @param {Object} localBlocks - 本地积木块集合
 * @param {Object} remoteBlocks - 远程积木块集合
 * @returns {Object} 差异对象 { added, removed, modified }
 */
const computeBlocksDiff = (localBlocks, remoteBlocks) => {
    const localIds = new Set(Object.keys(localBlocks || {}));
    const remoteIds = new Set(Object.keys(remoteBlocks || {}));
    
    const added = [];      // 远程新增的积木块
    const removed = [];    // 远程删除的积木块
    const modified = [];   // 远程修改的积木块
    
    // 找出远程新增的积木块
    for (const id of remoteIds) {
        if (!localIds.has(id)) {
            added.push({ id, block: remoteBlocks[id] });
        } else {
            // 检查是否修改
            if (!isBlockEqual(localBlocks[id], remoteBlocks[id])) {
                modified.push({ id, localBlock: localBlocks[id], remoteBlock: remoteBlocks[id] });
            }
        }
    }
    
    // 找出远程删除的积木块
    for (const id of localIds) {
        if (!remoteIds.has(id)) {
            removed.push({ id, block: localBlocks[id] });
        }
    }
    
    return { added, removed, modified };
};

/**
 * 计算精灵差异
 * @param {Array} localTargets - 本地精灵列表
 * @param {Array} remoteTargets - 远程精灵列表
 * @returns {Object} 差异对象
 */
const computeTargetsDiff = (localTargets, remoteTargets) => {
    const localMap = new Map();
    const remoteMap = new Map();
    
    (localTargets || []).forEach(target => {
        localMap.set(target.id, target);
    });
    
    (remoteTargets || []).forEach(target => {
        remoteMap.set(target.id, target);
    });
    
    const added = [];      // 新增的精灵
    const removed = [];    // 删除的精灵
    const modified = [];   // 修改的精灵（积木块有变化）
    
    // 找出新增和修改的精灵
    for (const [id, remoteTarget] of remoteMap) {
        if (!localMap.has(id)) {
            added.push(remoteTarget);
        } else {
            const localTarget = localMap.get(id);
            const blocksDiff = computeBlocksDiff(
                localTarget.blocks,
                remoteTarget.blocks
            );
            
            // 只有在有差异时才添加到修改列表
            if (blocksDiff.added.length > 0 || 
                blocksDiff.removed.length > 0 || 
                blocksDiff.modified.length > 0) {
                modified.push({
                    id,
                    name: remoteTarget.name,
                    isStage: remoteTarget.isStage,
                    blocksDiff,
                    remoteTarget
                });
            }
        }
    }
    
    // 找出删除的精灵
    for (const [id, localTarget] of localMap) {
        if (!remoteMap.has(id)) {
            removed.push(localTarget);
        }
    }
    
    return { added, removed, modified };
};

/**
 * 增量应用积木块变更到 VM
 * 这是核心函数，模拟积木块的释放操作
 * 
 * @param {Object} vm - Scratch VM 实例
 * @param {Object} target - 目标精灵
 * @param {Object} blocksDiff - 积木块差异
 * @param {Object} remoteBlocks - 远程完整的积木块集合
 * @returns {Promise<void>}
 */
const applyBlocksDiffToTarget = async (vm, target, blocksDiff, remoteBlocks) => {
    if (!target || !target.blocks) {
        console.warn('[增量同步] 目标精灵不存在或没有积木块');
        return;
    }
    
    const targetId = target.id;
    const blocks = target.blocks;
    
    console.log(`[增量同步] 开始应用变更到精灵 ${targetId}`);
    console.log(`[增量同步] 新增: ${blocksDiff.added.length}, 删除: ${blocksDiff.removed.length}, 修改: ${blocksDiff.modified.length}`);
    
    // 1. 删除远程已删除的积木块
    for (const { id } of blocksDiff.removed) {
        try {
            // 检查积木块是否存在
            if (blocks.getBlock(id)) {
                // 使用 VM 的事件系统来删除积木块
                // 这会触发 Blockly 的更新
                vm.runtime.emit('BLOCKS_NEED_UPDATE', {
                    targetId,
                    type: 'delete',
                    blockId: id
                });
            }
        } catch (err) {
            console.warn(`[增量同步] 删除积木块 ${id} 失败:`, err);
        }
    }
    
    // 2. 添加新增的积木块
    for (const { id, block } of blocksDiff.added) {
        try {
            vm.runtime.emit('BLOCKS_NEED_UPDATE', {
                targetId,
                type: 'create',
                blockId: id,
                block: block
            });
        } catch (err) {
            console.warn(`[增量同步] 添加积木块 ${id} 失败:`, err);
        }
    }
    
    // 3. 更新修改的积木块
    for (const { id, remoteBlock } of blocksDiff.modified) {
        try {
            vm.runtime.emit('BLOCKS_NEED_UPDATE', {
                targetId,
                type: 'change',
                blockId: id,
                block: remoteBlock
            });
        } catch (err) {
            console.warn(`[增量同步] 更新积木块 ${id} 失败:`, err);
        }
    }
};

/**
 * 直接操作 VM 的积木块数据（底层方法）
 * 这个方法直接修改 VM 内部的 blocks 对象，然后通知 Blockly 更新显示
 * 
 * @param {Object} vm - Scratch VM 实例
 * @param {string} targetId - 目标精灵 ID
 * @param {Object} remoteBlocks - 远程完整的积木块集合
 * @param {Object} blocksDiff - 积木块差异
 */
const applyBlocksDiffDirect = (vm, targetId, remoteBlocks, blocksDiff) => {
    const target = vm.runtime.getTargetById(targetId);
    if (!target) {
        console.warn(`[增量同步] 找不到精灵 ${targetId}`);
        return;
    }
    
    const blocks = target.blocks;
    if (!blocks) {
        console.warn(`[增量同步] 精灵 ${targetId} 没有 blocks 对象`);
        return;
    }
    
    // 使用 _blocks 直接操作
    if (!blocks._blocks) {
        console.warn(`[增量同步] 精灵 ${targetId} 没有 _blocks 对象`);
        return;
    }
    
    // 1. 删除积木块
    for (const { id } of blocksDiff.removed) {
        if (blocks._blocks[id]) {
            // 先断开与其他积木块的连接
            const block = blocks._blocks[id];
            
            // 如果有父积木块，更新父积木块的输入
            if (block.parent && blocks._blocks[block.parent]) {
                const parent = blocks._blocks[block.parent];
                for (const inputName in parent.inputs) {
                    const input = parent.inputs[inputName];
                    if (input.block === id) {
                        input.block = null;
                    }
                    if (input.shadow === id) {
                        input.shadow = null;
                    }
                }
            }
            
            // 如果有下一个积木块，断开连接
            if (block.next && blocks._blocks[block.next]) {
                blocks._blocks[block.next].parent = block.parent;
            }
            
            // 删除积木块
            delete blocks._blocks[id];
        }
    }
    
    // 2. 添加/更新积木块
    for (const { id, block } of blocksDiff.added) {
        blocks._blocks[id] = { ...block };
    }
    
    for (const { id, remoteBlock } of blocksDiff.modified) {
        // 保留本地的一些状态，更新其他内容
        blocks._blocks[id] = {
            ...blocks._blocks[id],
            ...remoteBlock,
            // 保留本地的一些运行时状态
        };
    }
    
    // 3. 通知 VM 更新
    vm.emitTargetsUpdate();
    vm.runtime.requestTargetsUpdate(target);
};

/**
 * 使用 Blockly API 直接更新工作区
 * 这是最直接的方式，模拟用户拖放积木块的效果
 * 
 * @param {Object} vm - Scratch VM 实例
 * @param {string} targetId - 目标精灵 ID
 * @param {Object} remoteTarget - 远程精灵数据
 * @param {Object} blocksDiff - 积木块差异
 */
const applyBlocksDiffViaBlockly = (vm, targetId, remoteTarget, blocksDiff) => {
    // 获取 Blockly 工作区
    const workspace = window.Blockly?.getMainWorkspace?.();
    if (!workspace) {
        console.warn('[增量同步] 无法获取 Blockly 工作区');
        return false;
    }
    
    const target = vm.runtime.getTargetById(targetId);
    if (!target) {
        console.warn(`[增量同步] 找不到精灵 ${targetId}`);
        return false;
    }
    
    // 检查是否是当前编辑的精灵
    if (vm.editingTarget?.id !== targetId) {
        console.log(`[增量同步] 精灵 ${targetId} 不是当前编辑的精灵，跳过 Blockly 更新`);
        return false;
    }
    
    const ScratchBlocks = window.ScratchBlocks;
    if (!ScratchBlocks) {
        console.warn('[增量同步] 无法获取 ScratchBlocks');
        return false;
    }
    
    // 标记正在应用远程变更，防止触发本地变更检测
    const previousApplyingFlag = vm._applyingRemoteChange;
    vm._applyingRemoteChange = true;
    
    try {
        // 1. 删除积木块
        for (const { id } of blocksDiff.removed) {
            const block = workspace.getBlockById(id);
            if (block) {
                // 保存连接信息
                const parent = block.getParent();
                const inputName = block.outputConnection?.targetConnection?.getSourceBlock() 
                    ? null 
                    : Object.keys(parent?.inputList || {}).find(key => 
                        parent?.inputList[key]?.connection?.targetConnection?.sourceBlock_ === block
                    );
                
                // 删除积木块
                block.dispose(true, true);
            }
        }
        
        // 2. 添加新增的积木块
        // 需要将积木块数据转换为 XML 然后渲染
        for (const { id, block } of blocksDiff.added) {
            try {
                // 使用 VM 的 shareBlocksToTarget 方法
                // 但这里我们需要直接在工作区创建积木块
                const blockXml = blockToXml(block, remoteTarget.blocks);
                const dom = ScratchBlocks.Xml.textToDom(blockXml);
                ScratchBlocks.Xml.domToBlock(dom, workspace);
            } catch (err) {
                console.warn(`[增量同步] 创建积木块 ${id} 失败:`, err);
            }
        }
        
        // 3. 更新修改的积木块
        for (const { id, remoteBlock } of blocksDiff.modified) {
            const block = workspace.getBlockById(id);
            if (block) {
                // 更新字段值
                const fields = remoteBlock.fields || {};
                for (const fieldName in fields) {
                    const field = block.getField(fieldName);
                    if (field && field.getValue() !== fields[fieldName].value) {
                        field.setValue(fields[fieldName].value);
                    }
                }
            }
        }
        
        return true;
    } finally {
        // 恢复标志
        vm._applyingRemoteChange = previousApplyingFlag;
    }
};

/**
 * 将积木块转换为 XML（用于 Blockly 创建积木块）
 * @param {Object} block - 积木块数据
 * @param {Object} allBlocks - 所有积木块集合
 * @returns {string} XML 字符串
 */
const blockToXml = (block, allBlocks) => {
    if (!block) return '';
    
    let xml = `<block type="${block.opcode}" id="${block.id}">`;
    
    // 添加字段
    const fields = block.fields || {};
    for (const fieldName in fields) {
        const field = fields[fieldName];
        xml += `<field name="${fieldName}">${escapeXml(field.value)}</field>`;
    }
    
    // 添加输入（子积木块）
    const inputs = block.inputs || {};
    for (const inputName in inputs) {
        const input = inputs[inputName];
        xml += `<value name="${inputName}">`;
        
        // 如果有影子积木块
        if (input.shadow && allBlocks[input.shadow]) {
            xml += blockToXml(allBlocks[input.shadow], allBlocks);
        }
        
        // 如果有实际积木块
        if (input.block && input.block !== input.shadow && allBlocks[input.block]) {
            xml += blockToXml(allBlocks[input.block], allBlocks);
        }
        
        xml += '</value>';
    }
    
    // 添加下一个积木块
    if (block.next && allBlocks[block.next]) {
        xml += `<next>${blockToXml(allBlocks[block.next], allBlocks)}</next>`;
    }
    
    xml += '</block>';
    return xml;
};

/**
 * XML 转义
 * @param {string} str - 原始字符串
 * @returns {string} 转义后的字符串
 */
const escapeXml = (str) => {
    if (typeof str !== 'string') return str;
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
};

/**
 * 增量同步主函数
 * 比较本地和远程项目，只同步差异部分
 * 
 * @param {Object} vm - Scratch VM 实例
 * @param {Object} localJSON - 本地项目 JSON
 * @param {Object} remoteJSON - 远程项目 JSON
 * @returns {Promise<Object>} 同步结果
 */
const incrementalSync = async (vm, localJSON, remoteJSON) => {
    console.log('[增量同步] 开始增量同步...');
    
    const local = typeof localJSON === 'string' ? JSON.parse(localJSON) : localJSON;
    const remote = typeof remoteJSON === 'string' ? JSON.parse(remoteJSON) : remoteJSON;
    
    if (!remote || !remote.targets) {
        console.warn('[增量同步] 远程项目数据无效');
        return { success: false, reason: 'invalid_remote' };
    }
    
    if (!local || !local.targets) {
        console.log('[增量同步] 本地项目为空，需要完整加载');
        return { success: false, reason: 'empty_local', needFullLoad: true };
    }
    
    // 计算精灵差异
    const targetsDiff = computeTargetsDiff(local.targets, remote.targets);
    
    console.log('[增量同步] 精灵差异:');
    console.log(`  - 新增: ${targetsDiff.added.length}`);
    console.log(`  - 删除: ${targetsDiff.removed.length}`);
    console.log(`  - 修改: ${targetsDiff.modified.length}`);
    
    // 如果差异太大，建议使用完整加载
    const totalChanges = targetsDiff.added.length + targetsDiff.removed.length + targetsDiff.modified.length;
    if (totalChanges > 50) {
        console.log('[增量同步] 变更数量过多，建议使用完整加载');
        return { success: false, reason: 'too_many_changes', needFullLoad: true };
    }
    
    // 如果没有变化，直接返回
    if (totalChanges === 0) {
        console.log('[增量同步] 没有发现差异');
        return { success: true, changes: 0 };
    }
    
    // 标记正在应用远程变更
    const previousFlag = vm._applyingRemoteChange;
    vm._applyingRemoteChange = true;
    
    try {
        // 1. 处理新增的精灵
        for (const target of targetsDiff.added) {
            console.log(`[增量同步] 添加新精灵: ${target.name}`);
            // 新增精灵需要完整添加
            // 这里我们使用 VM 的内部方法
            const sprite = vm.runtime.makeSprite(target);
            if (sprite) {
                vm.runtime.targets.push(sprite);
            }
        }
        
        // 2. 处理删除的精灵
        for (const target of targetsDiff.removed) {
            console.log(`[增量同步] 删除精灵: ${target.name}`);
            vm.runtime.disposeTarget(target.id);
        }
        
        // 3. 处理修改的精灵（核心：增量更新积木块）
        for (const { id, name, blocksDiff, remoteTarget } of targetsDiff.modified) {
            console.log(`[增量同步] 更新精灵积木块: ${name}`);
            
            // 首先尝试通过 Blockly 更新（如果当前正在编辑这个精灵）
            const updatedViaBlockly = applyBlocksDiffViaBlockly(vm, id, remoteTarget, blocksDiff);
            
            if (!updatedViaBlockly) {
                // 如果不是当前编辑的精灵，直接更新 VM 内部数据
                applyBlocksDiffDirect(vm, id, remoteTarget.blocks, blocksDiff);
            }
        }
        
        // 通知 VM 更新
        vm.emitTargetsUpdate();
        
        // 刷新工作区显示
        if (vm.editingTarget) {
            vm.emitWorkspaceUpdate();
        }
        
        console.log('[增量同步] 同步完成');
        return { success: true, changes: totalChanges };
        
    } catch (error) {
        console.error('[增量同步] 同步失败:', error);
        return { success: false, reason: 'error', error, needFullLoad: true };
    } finally {
        // 延迟恢复标志，避免触发本地变更检测
        setTimeout(() => {
            vm._applyingRemoteChange = previousFlag;
        }, 100);
    }
};

/**
 * 简化版增量同步：只更新当前编辑的精灵的积木块
 * 这个方法更安全，只影响当前可见的内容
 * 
 * @param {Object} vm - Scratch VM 实例
 * @param {Object} remoteJSON - 远程项目 JSON
 * @returns {Promise<Object>} 同步结果
 */
const incrementalSyncCurrentTarget = async (vm, remoteJSON) => {
    console.log('[增量同步] 开始简化版增量同步...');
    
    const remote = typeof remoteJSON === 'string' ? JSON.parse(remoteJSON) : remoteJSON;
    
    if (!remote || !remote.targets) {
        console.warn('[增量同步] 远程项目数据无效');
        return { success: false, reason: 'invalid_remote' };
    }
    
    const editingTarget = vm.editingTarget;
    if (!editingTarget) {
        console.warn('[增量同步] 没有正在编辑的精灵');
        return { success: false, reason: 'no_editing_target' };
    }
    
    // 找到远程对应的精灵
    const remoteTarget = remote.targets.find(t => t.id === editingTarget.id);
    if (!remoteTarget) {
        console.warn('[增量同步] 远程没有对应的精灵');
        return { success: false, reason: 'no_remote_target' };
    }
    
    // 计算积木块差异
    const blocksDiff = computeBlocksDiff(editingTarget.blocks._blocks, remoteTarget.blocks);
    
    console.log(`[增量同步] 当前精灵积木块差异: 新增 ${blocksDiff.added.length}, 删除 ${blocksDiff.removed.length}, 修改 ${blocksDiff.modified.length}`);
    
    // 如果没有变化，直接返回
    const totalChanges = blocksDiff.added.length + blocksDiff.removed.length + blocksDiff.modified.length;
    if (totalChanges === 0) {
        console.log('[增量同步] 没有发现差异');
        return { success: true, changes: 0 };
    }
    
    // 尝试通过 Blockly 更新
    const updated = applyBlocksDiffViaBlockly(vm, editingTarget.id, remoteTarget, blocksDiff);
    
    if (updated) {
        console.log('[增量同步] 通过 Blockly 更新成功');
        return { success: true, changes: totalChanges };
    }
    
    // 如果 Blockly 更新失败，直接更新 VM 数据
    applyBlocksDiffDirect(vm, editingTarget.id, remoteTarget.blocks, blocksDiff);
    vm.emitWorkspaceUpdate();
    
    return { success: true, changes: totalChanges };
};

export {
    computeBlocksDiff,
    computeTargetsDiff,
    incrementalSync,
    incrementalSyncCurrentTarget,
    applyBlocksDiffDirect,
    applyBlocksDiffViaBlockly,
    isBlockEqual
};

export default incrementalSync;
