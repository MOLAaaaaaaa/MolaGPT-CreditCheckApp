/**
 * models.js — MolaGPT 独立版模型管理
 * 用户可自行添加/删除模型 ID，持久化到 localStorage
 */
(function () {
    'use strict';

    const STORAGE_KEY = 'mola_standalone_models';

    // 默认预设（仅首次加载时使用）
    const DEFAULT_MODELS = [
        { id: 'qwen2.5:7b', thinking: false },
    ];

    function loadModels() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed) && parsed.length > 0) return parsed;
            }
        } catch (e) {}
        return DEFAULT_MODELS.map(m => ({ ...m }));
    }

    function saveModels(models) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(models));
    }

    // 全局查询
    window.modelSupportsThinking = function (modelName) {
        const models = loadModels();
        const m = models.find(x => x.id === modelName);
        return m ? !!m.thinking : false;
    };
    window.modelSupportsReasoningEffort = function () { return false; };

    // 同步 <select>（供 core.js 的 renderModelList 读取）
    function syncSelect(models) {
        const select = document.getElementById('model-select');
        if (!select) return;
        select.innerHTML = '';
        models.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.id;
            opt.textContent = m.id;
            opt.dataset.apiurl = '/api/chat';
            opt.dataset.temp = '0.7';
            select.appendChild(opt);
        });
    }

    function initModels() {
        const models = loadModels();
        syncSelect(models);

        // 设置当前模型
        const saved = localStorage.getItem('mola_standalone_settings');
        let savedModelName = '';
        if (saved) {
            try { savedModelName = JSON.parse(saved).modelName || ''; } catch (e) {}
        }
        const current = savedModelName || (models[0] ? models[0].id : '');
        window.modelName = current;
        window.apiUrl = '/api/chat';
        window.modelTemp = 0.7;

        const display = document.getElementById('current-model');
        if (display) display.textContent = current || '未配置模型';

        if (typeof updateThinkingToggleVisibility === 'function') {
            updateThinkingToggleVisibility();
        }
    }

    // 导出给 core.js 的模型管理 UI 使用
    window.ModelManager = {
        load: loadModels,
        save: saveModels,
        sync: function () {
            syncSelect(loadModels());
        },
        add: function (modelId, thinking) {
            if (!modelId || !modelId.trim()) return false;
            const models = loadModels();
            const id = modelId.trim();
            if (models.some(m => m.id === id)) return false; // 已存在
            models.push({ id, thinking: !!thinking });
            saveModels(models);
            syncSelect(models);
            return true;
        },
        remove: function (modelId) {
            let models = loadModels();
            models = models.filter(m => m.id !== modelId);
            saveModels(models);
            syncSelect(models);
            return true;
        },
        getAll: function () {
            return loadModels();
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initModels);
    } else {
        initModels();
    }
})();
