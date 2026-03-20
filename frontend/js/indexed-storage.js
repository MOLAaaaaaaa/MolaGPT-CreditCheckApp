// 定义数据库结构
const db = new Dexie('MolaGPTDatabase');

db.version(1).stores({
    conversations: 'id, title, createdAt, updatedAt, model, projectId, *tags', // 对话元数据
    messages: '++id, conversationId, role, content, timestamp, *attachments', // 消息内容
    settings: 'key, value', // 设置信息
    favorites: 'conversationId', // 收藏的对话
    sync: 'key, value' // 云同步相关数据
});

const indexedStorage = {
    
    async init() {
        try {
            await db.open();
            console.log('IndexedDB 初始化成功');
            
            // 检查是否需要从 localStorage 迁移数据
            await this.migrateFromLocalStorage();
            
            return true;
        } catch (error) {
            console.error('IndexedDB 初始化失败:', error);
            // 如果 IndexedDB 不可用，回退到 localStorage
            return false;
        }
    },

    async migrateFromLocalStorage() {
        try {
            // 检查是否已经迁移过
            const migrationFlag = await this.getSetting('migration_completed');
            if (migrationFlag) {
                // 已迁移则清理 localStorage 中 molaChat_chat 开头的 item
                var arr = [];
                for (var i = 0; i < localStorage.length; i++) {
                    if (localStorage.key(i).startsWith('molaChat_chat')) {
                        arr.push(localStorage.key(i));
                    }
                }
                for (var i = 0; i < arr.length; i++) {
                    localStorage.removeItem(arr[i]);
                }
                // console.log('数据已迁移，跳过迁移过程');
                return;
            }
            
            // console.log('开始从 localStorage 迁移数据到 IndexedDB...');
            
            // 迁移对话列表
            const molaChatList = localStorage.getItem('molaChatList');
            if (molaChatList) {
                const conversations = JSON.parse(molaChatList);
                for (const conv of conversations) {
                    await this.saveConversationMetadata(conv);
                    
                    const messages = localStorage.getItem(`molaChat_${conv.id}`);
                    if (messages) {
                        const parsedMessages = JSON.parse(messages);
                        await this.saveConversationMessages(conv.id, parsedMessages);
                    }
                }
                console.log(`检测并迁移了 ${conversations.length} 个对话`);
            }
            
            // 迁移收藏列表
            const favorites = localStorage.getItem('molagpt_favorite_conversations');
            if (favorites) {
                const favoriteIds = JSON.parse(favorites);
                for (const id of favoriteIds) {
                    await db.favorites.put({ conversationId: id });
                }
                console.log(`检测并迁移了 ${favoriteIds.length} 个收藏`);
            }
            
            const uiSettings = localStorage.getItem('molagpt_ui_settings');
            if (uiSettings) {
                await this.setSetting('ui_settings', JSON.parse(uiSettings));
            }
            
            const syncMeta = localStorage.getItem('molasync_meta');
            if (syncMeta) {
                await this.setSetting('sync_meta', JSON.parse(syncMeta));
            }
            
            await this.setSetting('migration_completed', true);
            // console.log('数据迁移完成');

            var arr = [];
            for (var i = 0; i < localStorage.length; i++){
                if (localStorage.key(i).startsWith('molaChat_chat')) {
                    arr.push(localStorage.key(i));
                }
            }

            for (var i = 0; i < arr.length; i++) {
                localStorage.removeItem(arr[i]);
            }
            
        } catch (error) {
            console.error('数据迁移失败:', error);
        }
    },
    

    async saveConversationMetadata(conversation) {
        try {
            // 数据验证：确保ID存在
            if (!conversation || !conversation.id) {
                console.warn('对话元数据缺少ID，跳过保存:', conversation);
                return;
            }
            
            await db.conversations.put({
                id: conversation.id,
                title: conversation.title || '新对话',
                createdAt: conversation.time || conversation.createdAt || new Date().toISOString(),
                updatedAt: conversation.updated_at || conversation.updatedAt || new Date().toISOString(),
                model: conversation.model || 'glm-4.5',
                projectId: conversation.projectId || null,
                tags: conversation.tags || []
            });
        } catch (error) {
            console.error('保存对话元数据失败:', error);
            throw error;
        }
    },
    

    async saveConversationMessages(conversationId, messages) {
        try {
            await db.messages.where('conversationId').equals(conversationId).delete();
            
            // 添加新消息
            const messagesWithConvId = messages.map((msg, index) => ({
                conversationId: conversationId,
                role: msg.role,
                content: msg.content,
                timestamp: msg.timestamp || new Date().toISOString(),
                attachments: msg.attachments || [],
                meta: msg.meta || {} // 保存完整的meta信息，包括retry数据
            }));
            
            await db.messages.bulkAdd(messagesWithConvId);
        } catch (error) {
            console.error('保存对话消息失败:', error);
            throw error;
        }
    },
    
    /**
     * 获取所有对话列表
     */
    async getAllConversations() {
        try {
            const conversations = await db.conversations.orderBy('updatedAt').reverse().toArray();
            return conversations.map(conv => ({
                id: conv.id,
                title: conv.title,
                time: conv.createdAt,
                updated_at: conv.updatedAt,
                model: conv.model,
                projectId: conv.projectId || null
            }));
        } catch (error) {
            console.error('获取对话列表失败:', error);
            return [];
        }
    },
    
    /**
     * 获取对话消息详情
     */
    async getConversationMessages(conversationId) {
        try {
            const messages = await db.messages
                .where('conversationId')
                .equals(conversationId)
                .toArray();
            
            return messages.map(msg => ({
                role: msg.role,
                content: msg.content,
                timestamp: msg.timestamp,
                attachments: msg.attachments,
                meta: msg.meta || {} // 返回完整的meta信息，包括retry数据
            }));
        } catch (error) {
            console.error('获取对话消息失败:', error);
            return [];
        }
    },
    
    /**
     * 删除对话
     */
    async deleteConversation(conversationId) {
        try {
            await db.conversations.delete(conversationId);
            await db.messages.where('conversationId').equals(conversationId).delete();
            await db.favorites.where('conversationId').equals(conversationId).delete();
        } catch (error) {
            console.error('删除对话失败:', error);
            throw error;
        }
    },
    
    /**
     * 更新对话标题
     */
    async updateConversationTitle(conversationId, title) {
        try {
            await db.conversations.update(conversationId, { 
                title: title,
                updatedAt: new Date().toISOString()
            });
        } catch (error) {
            console.error('更新对话标题失败:', error);
            throw error;
        }
    },
    
    /**
     * 添加消息到对话
     */
    async addMessage(conversationId, message) {
        try {
            await db.messages.add({
                conversationId: conversationId,
                role: message.role,
                content: message.content,
                timestamp: message.timestamp || new Date().toISOString(),
                attachments: message.attachments || []
            });
            
            // 更新对话的更新时间
            await db.conversations.update(conversationId, {
                updatedAt: new Date().toISOString()
            });
        } catch (error) {
            console.error('添加消息失败:', error);
            throw error;
        }
    },
    
    /**
     * 获取/设置通用设置
     */
    async getSetting(key) {
        try {
            const setting = await db.settings.get(key);
            return setting ? setting.value : null;
        } catch (error) {
            console.error(`获取设置 ${key} 失败:`, error);
            return null;
        }
    },
    
    async setSetting(key, value) {
        try {
            await db.settings.put({ key, value });
        } catch (error) {
            console.error(`设置 ${key} 失败:`, error);
            throw error;
        }
    },
    
    /**
     * 收藏相关操作
     */
    async getFavorites() {
        try {
            const favorites = await db.favorites.toArray();
            return favorites.map(f => f.conversationId);
        } catch (error) {
            console.error('获取收藏列表失败:', error);
            return [];
        }
    },
    
    async addFavorite(conversationId) {
        try {
            await db.favorites.put({ conversationId });
        } catch (error) {
            console.error('添加收藏失败:', error);
            throw error;
        }
    },
    
    async removeFavorite(conversationId) {
        try {
            await db.favorites.where('conversationId').equals(conversationId).delete();
        } catch (error) {
            console.error('移除收藏失败:', error);
            throw error;
        }
    },
    
    /**
     * 云同步相关
     */
    /**
     * 获取指定对话的同步时间戳
     * @param {string} conversationId - 对话ID，如果未提供则返回全局同步时间戳（向后兼容）
     */
    async getLastSyncTimestamp(conversationId = null) {
        try {
            const syncMeta = await this.getSetting('sync_meta') || {};
            
            if (conversationId && syncMeta.conversation_sync_timestamps) {
                // 返回指定对话的同步时间戳
                return syncMeta.conversation_sync_timestamps[conversationId] || '1970-01-01T00:00:00.000Z';
            } else {
                // 向后兼容：返回全局同步时间戳
                return syncMeta.last_sync_timestamp || '1970-01-01T00:00:00.000Z';
            }
        } catch (error) {
            console.error('获取同步时间戳失败:', error);
            return '1970-01-01T00:00:00.000Z';
        }
    },
    
    /**
     * 设置指定对话的同步时间戳
     * @param {string} timestamp - 时间戳
     * @param {string} conversationId - 对话ID，如果未提供则设置全局同步时间戳（向后兼容）
     */
    async setLastSyncTimestamp(timestamp, conversationId = null) {
        try {
            const syncMeta = await this.getSetting('sync_meta') || {};
            
            if (conversationId) {
                // 设置特定对话的同步时间戳
                if (!syncMeta.conversation_sync_timestamps) {
                    syncMeta.conversation_sync_timestamps = {};
                }
                
                // 设置对话的同步时间戳
                syncMeta.conversation_sync_timestamps[conversationId] = timestamp;
                
                // 同时更新全局同步时间戳（用于向后兼容）
                syncMeta.last_sync_timestamp = timestamp;
            } else {
                // 向后兼容：设置全局同步时间戳
                syncMeta.last_sync_timestamp = timestamp;
            }
            
            await this.setSetting('sync_meta', syncMeta);
        } catch (error) {
            console.error('设置同步时间戳失败:', error);
            throw error;
        }
    },
    
    async resetSyncTimestamp() {
        try {
            await this.setSetting('sync_meta', null);
        } catch (error) {
            console.error('重置同步时间戳失败:', error);
            throw error;
        }
    },
    
    /**
     * 批量同步操作，兼容云同步
     */
    async syncConversations(conversationsData) {
        try {
            for (const convData of conversationsData) {
                if (convData.metadata) {
                    await this.saveConversationMetadata(convData.metadata);
                }
                if (convData.messages) {
                    await this.saveConversationMessages(convData.metadata.id, convData.messages);
                }
            }
        } catch (error) {
            console.error('批量同步对话失败:', error);
            throw error;
        }
    }
};

// 导出到全局
window.indexedStorage = indexedStorage;
