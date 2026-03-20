class StorageAdapter {
    constructor() {
        this.useIndexedDB = false;
        this.initialized = false;
    }
    
    /**
     * 初始化存储系统
     */
    async init() {
        try {
            // 尝试初始化 IndexedDB
            if (window.indexedStorage) {
                this.useIndexedDB = await window.indexedStorage.init();
                if (this.useIndexedDB) {
                    // console.log('使用 IndexedDB 作为主存储');
                } else {
                    console.log('IndexedDB 初始化失败，回退到 localStorage');
                }
            } else {
                console.log('IndexedDB 管理器不可用，使用 localStorage');
            }
            
            this.initialized = true;
            return true;
        } catch (error) {
            console.error('存储适配器初始化失败:', error);
            this.useIndexedDB = false;
            this.initialized = true;
            return false;
        }
    }
    
    /**
     * 等待初始化完成
     */
    async ensureInitialized() {
        if (!this.initialized) {
            await this.init();
        }
    }
    
    /**
     * 检查本地是否有对话内容
     */
    async hasLocalConversation(conversationId) {
        await this.ensureInitialized();
        
        if (this.useIndexedDB) {
            try {
                const messages = await window.indexedStorage.getConversationMessages(conversationId);
                return messages && messages.length > 0;
            } catch (error) {
                return false;
            }
        } else {
            // 检查localStorage中是否有对话内容
            const stored = localStorage.getItem(`molaChat_${conversationId}`);
            return stored ? true : false;
        }
    }
    
    /**
     * 获取所有对话列表
     */
    async getAllConversationsList() {
        await this.ensureInitialized();
        
        if (this.useIndexedDB) {
            return await window.indexedStorage.getAllConversations();
        } else {
            // 回退到 localStorage
            const stored = localStorage.getItem('molaChatList');
            return stored ? JSON.parse(stored) : [];
        }
    }
    
    /**
     * 获取对话消息详情
     */
    async getConversationDetail(conversationId) {
        await this.ensureInitialized();
        
        if (this.useIndexedDB) {
            return await window.indexedStorage.getConversationMessages(conversationId);
        } else {
            // 回退到 localStorage
            const stored = localStorage.getItem(`molaChat_${conversationId}`);
            return stored ? JSON.parse(stored) : null;
        }
    }
    
    /**
     * 保存对话
     */
    async saveConversation(conversationId, conversationData, messagesList) {
        await this.ensureInitialized();
        
        if (this.useIndexedDB) {
            try {
                await window.indexedStorage.saveConversationMetadata(conversationData);
                if (messagesList && messagesList.length > 0) {
                    await window.indexedStorage.saveConversationMessages(conversationId, messagesList);
                }
            } catch (error) {
                if (error.name === 'QuotaExceededError') {
                    throw error;
                }
                throw error;
            }
        } else {
            try {
                // 回退到 localStorage
                const allConversations = await this.getAllConversationsList();
                const existingIndex = allConversations.findIndex(c => c.id === conversationId);
                
                if (existingIndex >= 0) {
                    allConversations[existingIndex] = conversationData;
                } else {
                    allConversations.unshift(conversationData);
                }
                
                localStorage.setItem('molaChatList', JSON.stringify(allConversations));
                if (messagesList) {
                    localStorage.setItem(`molaChat_${conversationId}`, JSON.stringify(messagesList));
                }
            } catch (error) {
                if (error.name === 'QuotaExceededError') {
                    throw error;
                }
                throw error;
            }
        }
    }
    
    /**
     * 删除对话
     */
    async deleteConversation(conversationId) {
        await this.ensureInitialized();
        
        if (this.useIndexedDB) {
            await window.indexedStorage.deleteConversation(conversationId);
        } else {
            // 回退到 localStorage
            const allConversations = await this.getAllConversationsList();
            const updatedList = allConversations.filter(conv => conv.id !== conversationId);
            localStorage.setItem('molaChatList', JSON.stringify(updatedList));
            localStorage.removeItem(`molaChat_${conversationId}`);
        }
    }
    
    /**
     * 更新对话标题
     */
    async updateConversationTitle(conversationId, title) {
        await this.ensureInitialized();
        
        if (this.useIndexedDB) {
            await window.indexedStorage.updateConversationTitle(conversationId, title);
        } else {
            // 回退到 localStorage
            const allConversations = await this.getAllConversationsList();
            const conversation = allConversations.find(c => c.id === conversationId);
            if (conversation) {
                conversation.title = title;
                conversation.updated_at = new Date().toISOString();
                localStorage.setItem('molaChatList', JSON.stringify(allConversations));
            }
        }
    }
    
    /**
     * 添加消息到对话
     */
    async addMessage(conversationId, message) {
        await this.ensureInitialized();
        
        if (this.useIndexedDB) {
            await window.indexedStorage.addMessage(conversationId, message);
        } else {
            // 回退到 localStorage
            const messages = await this.getConversationDetail(conversationId) || [];
            messages.push(message);
            localStorage.setItem(`molaChat_${conversationId}`, JSON.stringify(messages));
            
            // 更新对话元数据的时间
            const allConversations = await this.getAllConversationsList();
            const conversation = allConversations.find(c => c.id === conversationId);
            if (conversation) {
                conversation.updated_at = new Date().toISOString();
                localStorage.setItem('molaChatList', JSON.stringify(allConversations));
            }
        }
    }
    
    /**
     * 获取指定对话的最后同步时间戳
     * @param {string} conversationId - 对话ID，如果未提供则返回全局同步时间戳（向后兼容）
     */
    async getLastSyncTimestamp(conversationId = null) {
        await this.ensureInitialized();
        
        if (this.useIndexedDB) {
            return await window.indexedStorage.getLastSyncTimestamp(conversationId);
        } else {
            if (conversationId) {
                // 获取特定对话的同步时间戳
                const meta = localStorage.getItem('molasync_meta');
                if (meta) {
                    const parsedMeta = JSON.parse(meta);
                    return parsedMeta.conversation_sync_timestamps?.[conversationId] || '1970-01-01T00:00:00.000Z';
                }
                return '1970-01-01T00:00:00.000Z';
            } else {
                // 向后兼容：获取全局同步时间戳
                const meta = localStorage.getItem('molasync_meta');
                return meta ? JSON.parse(meta).last_sync_timestamp : '1970-01-01T00:00:00.000Z';
            }
        }
    }
    
    /**
     * 设置指定对话的同步时间戳
     * @param {string} timestamp - 时间戳
     * @param {string} conversationId - 对话ID，如果未提供则设置全局同步时间戳（向后兼容）
     */
    async setLastSyncTimestamp(timestamp, conversationId = null) {
        await this.ensureInitialized();
        
        if (this.useIndexedDB) {
            await window.indexedStorage.setLastSyncTimestamp(timestamp, conversationId);
        } else {
            if (conversationId) {
                // 设置特定对话的同步时间戳
                let meta = localStorage.getItem('molasync_meta');
                let parsedMeta = meta ? JSON.parse(meta) : {};
                
                // 确保conversation_sync_timestamps对象存在
                if (!parsedMeta.conversation_sync_timestamps) {
                    parsedMeta.conversation_sync_timestamps = {};
                }
                
                // 设置对话的同步时间戳
                parsedMeta.conversation_sync_timestamps[conversationId] = timestamp;
                
                // 同时更新全局同步时间戳（用于向后兼容）
                parsedMeta.last_sync_timestamp = timestamp;
                
                localStorage.setItem('molasync_meta', JSON.stringify(parsedMeta));
            } else {
                // 向后兼容：设置全局同步时间戳
                let meta = localStorage.getItem('molasync_meta');
                let parsedMeta = meta ? JSON.parse(meta) : {};
                parsedMeta.last_sync_timestamp = timestamp;
                localStorage.setItem('molasync_meta', JSON.stringify(parsedMeta));
            }
        }
    }
    
    async resetSyncTimestamp() {
        await this.ensureInitialized();
        
        if (this.useIndexedDB) {
            await window.indexedStorage.resetSyncTimestamp();
        } else {
            localStorage.removeItem('molasync_meta');
        }
    }
    
    /**
     * 收藏相关方法
     */
    async getFavorites() {
        await this.ensureInitialized();
        
        if (this.useIndexedDB) {
            return await window.indexedStorage.getFavorites();
        } else {
            const favorites = localStorage.getItem('molagpt_favorite_conversations');
            return favorites ? JSON.parse(favorites) : [];
        }
    }
    
    async addFavorite(conversationId) {
        await this.ensureInitialized();
        
        if (this.useIndexedDB) {
            await window.indexedStorage.addFavorite(conversationId);
        } else {
            const favorites = await this.getFavorites();
            if (!favorites.includes(conversationId)) {
                favorites.push(conversationId);
                localStorage.setItem('molagpt_favorite_conversations', JSON.stringify(favorites));
            }
        }
    }
    
    async removeFavorite(conversationId) {
        await this.ensureInitialized();
        
        if (this.useIndexedDB) {
            await window.indexedStorage.removeFavorite(conversationId);
        } else {
            const favorites = await this.getFavorites();
            const updatedFavorites = favorites.filter(id => id !== conversationId);
            localStorage.setItem('molagpt_favorite_conversations', JSON.stringify(updatedFavorites));
        }
    }
    
    /**
     * 设置相关方法
     */
    async getSetting(key) {
        await this.ensureInitialized();
        
        if (this.useIndexedDB) {
            return await window.indexedStorage.getSetting(key);
        } else {
            // 根据不同的设置键映射到不同的 localStorage 键
            const keyMap = {
                'ui_settings': 'molagpt_ui_settings',
                'sync_meta': 'molasync_meta'
            };
            const storageKey = keyMap[key] || key;
            const stored = localStorage.getItem(storageKey);
            return stored ? JSON.parse(stored) : null;
        }
    }
    
    async setSetting(key, value) {
        await this.ensureInitialized();
        
        if (this.useIndexedDB) {
            await window.indexedStorage.setSetting(key, value);
        } else {
            // 根据不同的设置键映射到不同的 localStorage 键
            const keyMap = {
                'ui_settings': 'molagpt_ui_settings',
                'sync_meta': 'molasync_meta'
            };
            const storageKey = keyMap[key] || key;
            localStorage.setItem(storageKey, JSON.stringify(value));
        }
    }
    
    /**
     * 批量同步数据（用于云同步）
     */
    async batchSyncConversations(conversationsData) {
        await this.ensureInitialized();
        
        if (!conversationsData || !Array.isArray(conversationsData)) {
            console.warn('无效的批量同步数据');
            return;
        }
        
        // 过滤掉无效的对话数据（缺少ID）
        const validConversationsData = conversationsData.filter(convData => {
            if (!convData || !convData.metadata || !convData.metadata.id) {
                console.warn('跳过无效的对话数据:', convData);
                return false;
            }
            return true;
        });
        
        if (this.useIndexedDB) {
            await window.indexedStorage.syncConversations(validConversationsData);
        } else {
            // 回退到 localStorage 的批量同步
            for (const convData of validConversationsData) {
                if (convData.metadata && convData.messages) {
                    const conversationId = convData.metadata.id;
                    await this.saveConversation(conversationId, convData.metadata, convData.messages);
                }
            }
        }
    }
    
    /**
     * 错误处理：存储空间不足时的清理策略
     */
    async handleQuotaExceeded() {
        console.warn('存储空间不足，尝试清理旧数据...');
        
        try {
            if (this.useIndexedDB) {
                // IndexedDB 很少遇到空间问题，但如果遇到，删除最旧的对话
                const conversations = await this.getAllConversationsList();
                if (conversations.length > 100) {
                    const toDelete = conversations.slice(100); // 保留最新的100个对话
                    for (const conv of toDelete) {
                        await this.deleteConversation(conv.id);
                    }
                    console.log(`清理了 ${toDelete.length} 个旧对话`);
                }
            } else {
                // localStorage 清理策略
                const conversations = await this.getAllConversationsList();
                if (conversations.length > 50) {
                    const toDelete = conversations.slice(50); // 保留最新的50个对话
                    for (const conv of toDelete) {
                        await this.deleteConversation(conv.id);
                    }
                    console.log(`清理了 ${toDelete.length} 个旧对话以释放空间`);
                }
            }
        } catch (error) {
            console.error('清理存储空间失败:', error);
        }
    }
    
    /**
     * 保存对话详情到本地存储
     */
    async saveConversationDetail(conversationId, conversationData) {
        await this.ensureInitialized();
        
        if (this.useIndexedDB) {
            if (conversationData.metadata) {
                await window.indexedStorage.saveConversationMetadata(conversationData.metadata);
            }
            if (conversationData.messages && conversationData.messages.length > 0) {
                await window.indexedStorage.saveConversationMessages(conversationId, conversationData.messages);
            }
        } else {
            // 回退到 localStorage
            const allConversations = await this.getAllConversationsList();
            const existingIndex = allConversations.findIndex(c => c.id === conversationId);
            
            if (conversationData.metadata) {
                if (existingIndex >= 0) {
                    allConversations[existingIndex] = conversationData.metadata;
                } else {
                    allConversations.unshift(conversationData.metadata);
                }
                localStorage.setItem('molaChatList', JSON.stringify(allConversations));
            }
            
            if (conversationData.messages) {
                localStorage.setItem(`molaChat_${conversationId}`, JSON.stringify(conversationData.messages));
            }
        }
    }
}

// 创建全局实例
window.storageAdapter = new StorageAdapter();
