/**
 * core.js — MolaGPT 独立版核心
 * 基于 core241002.js 精简，保留 SSE 流式、对话管理、Markdown 渲染
 * 去掉云同步、深度研究、项目、分享、MCP 等
 */

// ======================== 全局状态 ========================
var conversationHistory = [
    { role: "system", content: "你是一位专业的 AI 助手。" }
];
var isStopped = false;
var accumulatedText = '';

window.modelName = '';
window.modelTemp = 0.7;

// ======================== 共享常量 ========================
const KATEX_DELIMITERS = [
    { left: '$$', right: '$$', display: true },
    { left: '$', right: '$', display: false },
    { left: '\\[', right: '\\]', display: true },
    { left: '\\(', right: '\\)', display: false },
];
const PURIFY_CONFIG = {
    ADD_TAGS: ['ref', 'div'],
    ADD_ATTR: ['onclick', 'data-math-content', 'data-code-content', 'data-think-id', 'data-open', 'data-finished', 'data-think-phase', 'data-start-time']
};
function renderMath(el) {
    if (!window.renderMathInElement) return;
    try { renderMathInElement(el, { delimiters: KATEX_DELIMITERS, throwOnError: false }); } catch (e) {}
}
function sanitizeHtml(html) {
    return window.DOMPurify ? DOMPurify.sanitize(html, PURIFY_CONFIG) : html;
}

// ======================== Markdown 渲染管线 ========================
function initMarkdownRenderer() {
    if (!window.markdownit) return null;
    const md = window.markdownit({
        html: true,
        linkify: true,
        typographer: true,
        breaks: true,
        highlight: function (str, lang) {
            if (lang && window.hljs && hljs.getLanguage(lang)) {
                try { return hljs.highlight(str, { language: lang, ignoreIllegals: true }).value; } catch (_) {}
            }
            if (window.hljs) {
                try { return hljs.highlightAuto(str).value; } catch (_) {}
            }
            return '';
        }
    });
    // 自定义 fence：加语言标签和复制按钮
    md.renderer.rules.fence = function (tokens, idx) {
        const token = tokens[idx];
        const lang = token.info.trim().split(/\s+/)[0] || '';
        const highlighted = md.options.highlight(token.content, lang) || md.utils.escapeHtml(token.content);
        const langLabel = lang || 'text';
        return `<div class="code-block-header"><span class="code-lang">${langLabel}</span><button class="code-copy-btn" onclick="copyCodeBlock(this)"><i class="far fa-copy"></i> 复制</button></div><pre data-code-content="1"><code class="hljs language-${langLabel}">${highlighted}</code></pre>`;
    };
    return md;
}

var mdRenderer = null;
document.addEventListener('DOMContentLoaded', function () {
    mdRenderer = initMarkdownRenderer();
});

function copyCodeBlock(btn) {
    const pre = btn.closest('.code-block-header')?.nextElementSibling;
    if (!pre) return;
    navigator.clipboard.writeText(pre.textContent).then(() => {
        btn.innerHTML = '<i class="fas fa-check"></i> 已复制';
        setTimeout(() => { btn.innerHTML = '<i class="far fa-copy"></i> 复制'; }, 2000);
    });
}

/**
 * processMathContent — 处理 Markdown + Think 标签
 * 参考原版同名函数，简化了 deep research 相关逻辑
 */
function processMathContent(text, savedThinkData) {
    if (!text) return '';

    // 处理 <think> 标签
    let thinkCounter = 0;
    text = text.replace(/<think>([\s\S]*?)(?:<\/think>|$)/gi, function (match, content, offset) {
        thinkCounter++;
        const thinkId = 'think-' + thinkCounter;
        const isComplete = match.includes('</think>');
        const saved = (savedThinkData || []).find(d => d.id === thinkId);
        const openState = saved ? saved.openState : (isComplete ? 'false' : 'true');
        const phase = isComplete ? 'completed' : 'thinking';
        const startTime = saved?.startTime || Date.now();

        let renderedContent = content.trim();
        if (mdRenderer) {
            renderedContent = mdRenderer.render(renderedContent);
        }

        const headerText = isComplete ? '思考完成' : '正在思考...';
        const expandedClass = openState === 'true' ? 'open' : '';

        return `<div class="think-container ${expandedClass}" data-think-id="${thinkId}" data-open="${openState}" data-finished="${isComplete}" data-think-phase="${phase}" data-start-time="${startTime}">
            <div class="think-header" onclick="toggleThinkBlock(this)">
                <i class="fas fa-chevron-right think-toggle-icon"></i>
                <span class="think-time">${headerText}</span>
            </div>
            <div class="think-content">${renderedContent}</div>
        </div>`;
    });

    // Markdown 渲染
    if (mdRenderer) {
        text = mdRenderer.render(text);
    }

    return text;
}

function toggleThinkBlock(header) {
    const container = header.closest('.think-container');
    if (!container) return;
    const isOpen = container.dataset.open === 'true';
    container.dataset.open = isOpen ? 'false' : 'true';
    container.classList.toggle('open', !isOpen);
}

/**
 * updateResponseContent — 更新响应容器 DOM
 */
function updateResponseContent(newHTML) {
    const container = document.getElementById("chatgpt-response");
    if (!container) return;

    // 保存光标位置信息
    const cursor = container.querySelector('#cursor');
    const hadCursor = !!cursor;

    container.innerHTML = newHTML;

    // 恢复光标
    if (hadCursor) {
        const newCursor = document.createElement('div');
        newCursor.id = 'cursor';
        container.appendChild(newCursor);
    }

    // KaTeX 渲染
    renderMath(container);

    // 代码高亮
    container.querySelectorAll('pre code:not(.hljs)').forEach(block => {
        if (window.hljs) hljs.highlightElement(block);
    });
}

function printMessage(message) {
    if (isStopped) return;
    const responseText = document.getElementById("chatgpt-response");
    if (!responseText) return;

    if (typeof message === 'string') {
        responseText.dataset.rawContent = message;
    }

    const processedHtml = processMathContent(message, []);
    const sanitizedHtml = sanitizeHtml(processedHtml);

    updateResponseContent(sanitizedHtml);
}

function createMainResponseControls() {
    const controlsDiv = document.createElement('div');
    controlsDiv.style.cssText = 'display:flex;align-items:center;gap:12px;margin-top:8px;padding-top:8px;border-top:1px solid var(--border-color, #e5e7eb)';

    const copyBtn = document.createElement('span');
    copyBtn.className = 'far fa-copy';
    copyBtn.title = '复制全部';
    copyBtn.style.cssText = 'cursor:pointer;font-size:16px;color:var(--text-secondary, #6b7280);padding:6px;border-radius:6px;transition:color 0.2s,background 0.2s';
    copyBtn.onmouseover = () => { copyBtn.style.color = 'var(--primary-color, #be727f)'; copyBtn.style.background = 'var(--bg-secondary, #f3f4f6)'; };
    copyBtn.onmouseout = () => { copyBtn.style.color = 'var(--text-secondary, #6b7280)'; copyBtn.style.background = 'none'; };
    copyBtn.onclick = function() { copyFullResponse(this); };

    const retryBtn = document.createElement('span');
    retryBtn.className = 'fas fa-sync-alt';
    retryBtn.title = '重新生成';
    retryBtn.style.cssText = 'cursor:pointer;font-size:16px;color:var(--text-secondary, #6b7280);padding:6px;border-radius:6px;transition:color 0.2s,background 0.2s';
    retryBtn.onmouseover = () => { retryBtn.style.color = 'var(--primary-color, #be727f)'; retryBtn.style.background = 'var(--bg-secondary, #f3f4f6)'; };
    retryBtn.onmouseout = () => { retryBtn.style.color = 'var(--text-secondary, #6b7280)'; retryBtn.style.background = 'none'; };
    retryBtn.onclick = function() { regenerateResponse(); };

    controlsDiv.appendChild(copyBtn);
    controlsDiv.appendChild(retryBtn);
    return controlsDiv;
}

function copyFullResponse(el) {
    const responseEl = document.getElementById("chatgpt-response");
    if (!responseEl) return;
    const raw = responseEl.dataset.rawContent || responseEl.textContent;
    navigator.clipboard.writeText(raw).then(() => {
        el.className = 'fas fa-check';
        el.style.color = 'var(--success-color, #10b981)';
        setTimeout(() => { el.className = 'far fa-copy'; el.style.color = 'var(--text-secondary, #6b7280)'; }, 2000);
    });
}

// ======================== 存储 key 前缀（隔离 v2） ========================
const STORAGE_PREFIX = 'mola_standalone_';

// ======================== 对话管理 ========================
var chatHistoryManager = {
    getCurrentConversationId() {
        return localStorage.getItem(STORAGE_PREFIX + 'currentChat');
    },
    setCurrentConversationId(id) {
        localStorage.setItem(STORAGE_PREFIX + 'currentChat', id);
        if (window.molagpt && window.molagpt.state) {
            window.molagpt.state.currentConversationId = id;
        }
    },
    generateConversationId() {
        return 'sconv_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    }
};

window.chatHistoryManager = chatHistoryManager;

// ======================== 设置管理 ========================
var appSettings = {
    apiUrl: '/api/chat',
    apiKey: '',
    modelName: 'qwen2.5:7b',
    temperature: 0.7,
    maxContext: 20,
    systemPrompt: '',
    licenseKey: '',
    machineCode: '',

    load() {
        try {
            const saved = localStorage.getItem(STORAGE_PREFIX + 'settings');
            if (saved) Object.assign(this, JSON.parse(saved));
        } catch (e) {}
        this.machineCode = this.generateMachineCode();
    },

    save() {
        try {
            localStorage.setItem(STORAGE_PREFIX + 'settings', JSON.stringify({
                apiUrl: this.apiUrl,
                apiKey: this.apiKey,
                modelName: this.modelName,
                temperature: this.temperature,
                maxContext: this.maxContext,
                systemPrompt: this.systemPrompt,
                licenseKey: this.licenseKey,
            }));
        } catch (e) {}
    },

    generateMachineCode() {
        let code = localStorage.getItem(STORAGE_PREFIX + 'machine_code');
        if (code) return code;
        const parts = [
            navigator.userAgent.length.toString(36),
            navigator.language || 'xx',
            screen.width + 'x' + screen.height,
            navigator.hardwareConcurrency || 0,
            new Date().getTimezoneOffset(),
        ];
        let hash = 0;
        const raw = parts.join('|');
        for (let i = 0; i < raw.length; i++) {
            hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
        }
        code = 'MC-' + Math.abs(hash).toString(16).toUpperCase().padStart(8, '0') + '-' +
            Date.now().toString(36).toUpperCase().slice(-6);
        localStorage.setItem(STORAGE_PREFIX + 'machine_code', code);
        return code;
    },

    getSystemPrompt() {
        return this.systemPrompt || conversationHistory[0]?.content || '你是一位专业的 AI 助手。';
    }
};

// ======================== 主发送流程 ========================
async function sendQuestion(isEditResubmit, prefilledUserMessage) {
    // 获取响应容器
    let responseText1 = document.getElementById("chatgpt-response");
    if (!responseText1) {
        const viewport = document.querySelector('.messages-viewport');
        if (!viewport) return;
        // 会在 addUserMessage 之后创建
    }

    // 获取用户消息
    let userMessage = '';
    if (isEditResubmit) {
        for (let i = conversationHistory.length - 1; i >= 0; i--) {
            if (conversationHistory[i].role === 'user') {
                const c = conversationHistory[i].content;
                userMessage = typeof c === 'string' ? c : c[0]?.text || '';
                break;
            }
        }
    } else if (typeof prefilledUserMessage === 'string' && prefilledUserMessage.length > 0) {
        userMessage = prefilledUserMessage;
    } else {
        userMessage = document.getElementById("chat-gpt-input").value;
    }

    if (!userMessage || !userMessage.trim()) return;

    // 清空输入框
    if (!isEditResubmit && !prefilledUserMessage) {
        document.getElementById("chat-gpt-input").value = '';
        if (window.molagpt && window.molagpt.ui) {
            window.molagpt.ui.autoResizeTextarea();
            window.molagpt.ui.updateSendButtonState();
        }
    }

    // 确保有对话 ID
    let conversationId = chatHistoryManager.getCurrentConversationId();
    if (!conversationId) {
        conversationId = chatHistoryManager.generateConversationId();
        chatHistoryManager.setCurrentConversationId(conversationId);
    }

    // 添加用户消息到 history
    if (!isEditResubmit) {
        conversationHistory.push({ role: "user", content: userMessage.trim() });
    }

    // 添加用户消息气泡
    addUserMessageBubble(userMessage.trim());

    // 移除旧的 chatgpt-response ID，防止冲突
    const oldResponse = document.getElementById('chatgpt-response');
    if (oldResponse) oldResponse.removeAttribute('id');

    // 创建 assistant 响应区
    createAssistantResponseArea();
    responseText1 = document.getElementById("chatgpt-response");
    responseText1.innerHTML = "<div id='loading' style='border: 4px solid var(--primary-color, #be727f); border-top-color: transparent;'></div>";

    var Cursor = document.createElement('div');
    Cursor.id = 'cursor';

    var stopButton = document.getElementById('stop-button');
    var sendButton = document.getElementById('send-question');
    const controller = new AbortController();
    const signal = controller.signal;
    isStopped = false;
    accumulatedText = '';

    stopButton.style.display = 'inline';
    sendButton.style.display = 'none';

    stopButton.onclick = function () {
        isStopped = true;
        controller.abort();
        stopButton.style.display = 'none';
        sendButton.style.display = 'inline';
        const cursor = responseText1?.querySelector('#cursor');
        if (cursor) cursor.remove();

        if (!responseText1.querySelector('.termination-message')) {
            const msg = document.createElement('div');
            msg.className = 'termination-message';
            msg.textContent = '回答已由用户终止。';
            msg.style.cssText = 'color: var(--text-secondary); margin-top: 1em; font-size: 0.9em;';
            responseText1.appendChild(msg);
        }
    };

    // 构建请求消息
    const maxCtx = appSettings.maxContext * 2; // 轮数 → 消息数
    let messages = [];
    const systemPrompt = appSettings.getSystemPrompt();
    messages.push({ role: 'system', content: systemPrompt });

    // 裁剪上下文
    const userAssistantMsgs = conversationHistory.filter(m => m.role !== 'system');
    const trimmed = userAssistantMsgs.slice(-maxCtx);
    messages = messages.concat(trimmed);

    const chatApiUrl = window.apiUrl || appSettings.apiUrl || '/api/chat';
    const model = window.modelName || appSettings.modelName || 'qwen2.5:7b';
    const temperature = parseFloat(window.modelTemp || appSettings.temperature || 0.7);

    const requestBody = {
        model: model,
        messages: messages,
        temperature: temperature,
        stream: true,
    };

    const data = JSON.stringify(requestBody);

    // 发送请求
    const timeout = setTimeout(() => {
        if (!isStopped) {
            controller.abort();
            printMessage("<span style='color: var(--error-color);'>请求超时，请检查模型服务是否运行。</span>");
            stopButton.style.display = 'none';
            sendButton.style.display = 'inline';
        }
    }, 120000);

    try {
        const headers = { "Content-Type": "application/json" };

        const response = await fetch(chatApiUrl, {
            method: "POST",
            headers: headers,
            body: data,
            signal: signal
        });
        clearTimeout(timeout);

        if (!response.ok) {
            const errorContent = `<span style='color: var(--error-color);'>请求失败: ${response.status} ${response.statusText}</span>`;
            printMessage(errorContent);
            stopButton.style.display = 'none';
            sendButton.style.display = 'inline';
            return;
        }

        processResponse(response);
    } catch (err) {
        clearTimeout(timeout);
        if (err && err.name !== 'AbortError') {
            printMessage(`<span style='color: var(--error-color);'>网络错误: ${err.message}</span>`);
        }
        stopButton.style.display = 'none';
        sendButton.style.display = 'inline';
    }

    // 处理流式响应
    function processResponse(response) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = '';
        let streamDone = false;
        let currentState = 'IDLE';

        responseText1.innerHTML = '';
        responseText1.appendChild(Cursor);

        const controls = createMainResponseControls();

        // 渲染节流
        let pendingRender = null;
        let lastRenderTime = 0;
        const MIN_RENDER_INTERVAL = 50;

        function scheduleRender() {
            if (pendingRender) return;
            const now = Date.now();
            const elapsed = now - lastRenderTime;
            if (elapsed >= MIN_RENDER_INTERVAL) {
                doRender();
            } else {
                pendingRender = setTimeout(() => {
                    pendingRender = null;
                    doRender();
                }, MIN_RENDER_INTERVAL - elapsed);
            }
        }

        function doRender() {
            lastRenderTime = Date.now();
            printMessage(accumulatedText);
            if (!streamDone) {
                const cursor = responseText1.querySelector('#cursor');
                if (!cursor) {
                    const c = document.createElement('div');
                    c.id = 'cursor';
                    responseText1.appendChild(c);
                }
            }
            scrollToBottom();
        }

        function scrollToBottom() {
            const container = document.getElementById('messages-container');
            if (container) {
                requestAnimationFrame(() => {
                    container.scrollTop = container.scrollHeight;
                });
            }
        }

        function processSSELine(line) {
            const trimmed = line.trim();
            if (!trimmed) return;

            if (trimmed.startsWith('data:')) {
                const dataStr = trimmed.slice(5).trim();
                if (dataStr === '[DONE]') {
                    streamDone = true;
                    return;
                }
                try {
                    const json = JSON.parse(dataStr);
                    const delta = json.choices?.[0]?.delta;
                    if (!delta) return;

                    // 推理内容 (DeepSeek/Qwen 格式)
                    if (delta.reasoning_content) {
                        if (currentState !== 'THINKING') {
                            accumulatedText += '<think>';
                            currentState = 'THINKING';
                        }
                        accumulatedText += delta.reasoning_content;
                        scheduleRender();
                    }
                    // 普通内容
                    if (delta.content) {
                        if (currentState === 'THINKING') {
                            accumulatedText += '</think>';
                            currentState = 'CONTENT';
                        }
                        accumulatedText += delta.content;
                        scheduleRender();
                    }
                } catch (e) {
                    // 非 JSON，跳过
                }
            }
        }

        function readStream() {
            reader.read().then(({ done, value }) => {
                if (done || isStopped) {
                    finishStream();
                    return;
                }

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    processSSELine(line);
                }

                readStream();
            }).catch(err => {
                if (err.name !== 'AbortError') {
                    console.error('Stream read error:', err);
                }
                finishStream();
            });
        }

        function finishStream() {
            streamDone = true;
            if (pendingRender) {
                clearTimeout(pendingRender);
                pendingRender = null;
            }

            // 关闭未闭合的 think 标签
            if (currentState === 'THINKING') {
                accumulatedText += '</think>';
            }

            // 最终渲染
            printMessage(accumulatedText);
            const cursor = responseText1.querySelector('#cursor');
            if (cursor) cursor.remove();

            // 添加控制按钮
            responseText1.appendChild(controls);

            // 保存 assistant 消息
            if (accumulatedText.trim()) {
                conversationHistory.push({ role: "assistant", content: accumulatedText });
            }

            // 保存对话
            saveCurrentConversation();

            // 更新 UI
            stopButton.style.display = 'none';
            sendButton.style.display = 'inline';

            // 更新侧边栏
            if (window.molagpt && window.molagpt.ui) {
                window.molagpt.ui.renderConversationList();
            }
        }

        readStream();
    }
}

// ======================== UI 辅助 ========================
function addUserMessageBubble(text) {
    const viewport = document.querySelector('.messages-viewport');
    if (!viewport) return;

    // 隐藏欢迎界面
    const welcome = document.getElementById('centered-welcome-header');
    if (welcome) welcome.style.display = 'none';

    const messageDiv = document.createElement('div');
    messageDiv.className = 'message user';

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.innerHTML = '<i class="fas fa-user"></i>';

    const messageContentWrapper = document.createElement('div');
    messageContentWrapper.className = 'message-content';

    const messageText = document.createElement('div');
    messageText.className = 'message-text markdown-body';
    const cleanedText = escapeHtml(text).replace(/\n/g, '<br>');
    messageText.innerHTML = window.DOMPurify ? DOMPurify.sanitize(cleanedText, { ALLOWED_TAGS: ['br'], ALLOWED_ATTR: [] }) : cleanedText;
    messageText.dataset.rawContent = text;

    messageContentWrapper.appendChild(messageText);
    messageDiv.appendChild(avatar);
    messageDiv.appendChild(messageContentWrapper);
    viewport.appendChild(messageDiv);

    // 滚动到底部
    const container = document.getElementById('messages-container');
    if (container) container.scrollTop = container.scrollHeight;
}

function createAssistantResponseArea() {
    const viewport = document.querySelector('.messages-viewport');
    if (!viewport) return;

    const messageDiv = document.createElement('div');
    messageDiv.className = 'message assistant';

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.innerHTML = '<i class="fas fa-robot"></i>';

    const messageContentWrapper = document.createElement('div');
    messageContentWrapper.className = 'message-content';

    const messageText = document.createElement('div');
    messageText.className = 'message-text markdown-body';
    messageText.id = 'chatgpt-response';

    messageContentWrapper.appendChild(messageText);
    messageDiv.appendChild(avatar);
    messageDiv.appendChild(messageContentWrapper);
    viewport.appendChild(messageDiv);
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function regenerateResponse() {
    // 移除最后一条 assistant 消息
    for (let i = conversationHistory.length - 1; i >= 0; i--) {
        if (conversationHistory[i].role === 'assistant') {
            conversationHistory.splice(i, 1);
            break;
        }
    }
    // 重新发送
    sendQuestion(true);
}

// ======================== 对话存储 ========================
async function saveCurrentConversation() {
    const convId = chatHistoryManager.getCurrentConversationId();
    if (!convId) return;

    // 生成标题（取第一条用户消息的前25字）
    let title = '新对话';
    for (const msg of conversationHistory) {
        if (msg.role === 'user') {
            const text = typeof msg.content === 'string' ? msg.content : '';
            title = text.slice(0, 25) + (text.length > 25 ? '...' : '');
            break;
        }
    }

    const convData = {
        id: convId,
        title: title,
        messages: conversationHistory.filter(m => m.role !== 'system'),
        updated: Date.now(),
        model: window.modelName || appSettings.modelName,
    };

    try {
        const all = JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'conversations') || '{}');
        all[convId] = convData;
        localStorage.setItem(STORAGE_PREFIX + 'conversations', JSON.stringify(all));
    } catch (e) {
        console.warn('Save conversation failed:', e);
    }

    // 更新 UI 列表
    updateUIConversationsList(convId, title);
}

function updateUIConversationsList(convId, title) {
    let uiConvs = [];
    try {
        uiConvs = JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'ui_conversations') || '[]');
    } catch (e) { uiConvs = []; }

    const existing = uiConvs.findIndex(c => c.id === convId);
    const entry = { id: convId, title: title, updated: Date.now(), model: window.modelName || '' };

    if (existing >= 0) {
        uiConvs[existing] = entry;
    } else {
        uiConvs.unshift(entry);
    }

    localStorage.setItem(STORAGE_PREFIX + 'ui_conversations', JSON.stringify(uiConvs));
}

async function loadConversation(convId) {
    let data = null;
    try {
        const all = JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'conversations') || '{}');
        data = all[convId];
    } catch (e) {}
    return data;
}

async function deleteConversation(convId) {
    try {
        const all = JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'conversations') || '{}');
        delete all[convId];
        localStorage.setItem(STORAGE_PREFIX + 'conversations', JSON.stringify(all));
    } catch (e) {}

    let uiConvs = JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'ui_conversations') || '[]');
    uiConvs = uiConvs.filter(c => c.id !== convId);
    localStorage.setItem(STORAGE_PREFIX + 'ui_conversations', JSON.stringify(uiConvs));
}

// ======================== AppState ========================
class AppState {
    constructor() {
        this.currentConversationId = null;
        this.uiConversations = [];
        this.isLoading = false;
        this.darkMode = false;
        this.autoTheme = true;
        this.uploadedFile = null;
        this.favoriteConversations = [];
        this.searchQuery = '';
        this.searchFilters = { title: true, content: true, favoritesOnly: false };
        this.filteredConversations = [];
        this.centeredLayoutMode = false;
    }

    async loadFromStorage() {
        try {
            const savedUiConversations = localStorage.getItem(STORAGE_PREFIX + 'ui_conversations');
            if (savedUiConversations) this.uiConversations = JSON.parse(savedUiConversations);

            if (!this.currentConversationId && this.uiConversations.length === 0) {
                this.centeredLayoutMode = true;
            }

            const savedSettings = localStorage.getItem('mola_standalone_ui_settings');
            if (savedSettings) {
                const settings = JSON.parse(savedSettings);
                this.darkMode = settings.darkMode || false;
                this.autoTheme = settings.autoTheme !== undefined ? settings.autoTheme : true;
            }
        } catch (error) {
            console.error('加载UI设置失败:', error);
        }
    }

    async saveToStorage() {
        try {
            localStorage.setItem(STORAGE_PREFIX + 'ui_conversations', JSON.stringify(this.uiConversations));
            const settings = { darkMode: this.darkMode, autoTheme: this.autoTheme };
            localStorage.setItem('mola_standalone_ui_settings', JSON.stringify(settings));
        } catch (error) {
            console.error('保存UI设置失败:', error);
        }
    }
}

// ======================== UIController ========================
class UIController {
    constructor(state) {
        this.state = state;
        this.elements = this.cacheElements();
        this.systemThemeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        this.bindEvents();
        this.initializeUI().catch(error => console.error('UI初始化失败:', error));
    }

    cacheElements() {
        return {
            sidebar: document.getElementById('sidebar'),
            messagesContainer: document.getElementById('messages-container'),
            messagesViewport: document.getElementById('messages-container')?.querySelector('.messages-viewport'),
            conversationList: document.getElementById('conversation-list'),
            messageInput: document.getElementById('chat-gpt-input'),
            sendBtn: document.getElementById('send-question'),
            stopBtn: document.getElementById('stop-button'),
            uploadBtnLabel: document.getElementById('upload-btn'),
            fileInput: document.getElementById('image-upload'),
            fileUploadStatus: document.getElementById('file-upload-status'),
            clearAllFilesBtn: document.getElementById('clear-all-files'),
            newChatBtn: document.getElementById('clear-conversation'),
            sidebarOverlay: document.getElementById('sidebar-overlay'),
            mobileMenuBtn: document.getElementById('mobile-menu-btn'),
            modelSelectorTrigger: document.getElementById('model-selector-trigger'),
            currentModelDisplay: document.getElementById('current-model'),
            actualModelSelect: document.getElementById('model-select'),
            settingsBtn: document.getElementById('settings-btn'),
            darkModeBtn: document.getElementById('dark-mode-btn'),
            themePopup: document.getElementById('theme-popup'),
            themeOptions: document.querySelectorAll('.theme-option'),
            historyBtn: document.getElementById('history-btn'),
            modelDropdown: document.getElementById('model-dropdown'),
            modelList: document.getElementById('model-list'),
            settingsModal: document.getElementById('settings-modal'),
            closeSettingsModal: document.getElementById('close-settings-modal'),
            temperatureSlider: document.getElementById('temperature-slider'),
            temperatureValue: document.getElementById('temperature-value'),
            saveSettings: document.getElementById('save-settings'),
            cancelSettings: document.getElementById('cancel-settings'),
            scrollToBottomBtn: document.getElementById('scroll-to-bottom-btn'),
            pageLoader: document.getElementById('page-loader'),
            mainContent: document.querySelector('main'),
        };
    }

    bindEvents() {
        // 发送按钮
        this.elements.sendBtn.addEventListener('click', () => {
            sendQuestion(false);
        });

        // Enter 键
        this.elements.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                const enterMode = localStorage.getItem('mola_standalone_enter_mode') || 'newline';
                if (enterMode === 'send') {
                    e.preventDefault();
                    sendQuestion(false);
                }
            }
        });

        // Enter 模式切换
        this._applyEnterMode(localStorage.getItem('mola_standalone_enter_mode') || 'newline');
        const enterModeIndicator = document.getElementById('enter-mode-indicator');
        if (enterModeIndicator) {
            enterModeIndicator.addEventListener('click', () => {
                const current = localStorage.getItem('mola_standalone_enter_mode') || 'newline';
                const next = current === 'newline' ? 'send' : 'newline';
                localStorage.setItem('mola_standalone_enter_mode', next);
                this._applyEnterMode(next);
            });
        }

        // 输入框自适应
        this.elements.messageInput.addEventListener('input', () => {
            this.autoResizeTextarea();
            this.updateSendButtonState();
        });

        // 滚动
        this.elements.messagesContainer.addEventListener('scroll', () => this.handleScroll());
        this.elements.scrollToBottomBtn.addEventListener('click', () => this.scrollToBottom());

        // 文件上传
        this.elements.uploadBtnLabel.addEventListener('click', (e) => {
            e.preventDefault();
            this.elements.fileInput.click();
        });
        this.elements.fileInput.addEventListener('change', () => this.handleFileChange());
        if (this.elements.clearAllFilesBtn) {
            this.elements.clearAllFilesBtn.addEventListener('click', () => this.removeUploadedFile());
        }

        // 侧边栏
        this.elements.mobileMenuBtn.addEventListener('click', () => this.toggleSidebar());
        if (this.elements.sidebarOverlay) {
            this.elements.sidebarOverlay.addEventListener('click', () => this.closeSidebar());
        }

        // 新建对话
        this.elements.newChatBtn.addEventListener('click', () => this.startNewConversation());

        // 搜索按钮
        const searchBtn = document.getElementById('search-conversations-btn');
        const searchPanel = document.getElementById('search-panel');
        if (searchBtn && searchPanel) {
            searchBtn.addEventListener('click', () => {
                searchPanel.classList.toggle('hidden');
                if (!searchPanel.classList.contains('hidden')) {
                    document.getElementById('search-input')?.focus();
                }
            });
        }
        const clearSearchBtn = document.getElementById('clear-search-btn');
        if (clearSearchBtn) {
            clearSearchBtn.addEventListener('click', () => {
                const input = document.getElementById('search-input');
                if (input) input.value = '';
                if (searchPanel) searchPanel.classList.add('hidden');
                this.renderConversationList();
            });
        }
        // 搜索输入
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                this.filterConversations(searchInput.value.trim());
            });
        }

        // 收藏按钮 (暂显示提示)
        const favBtn = document.getElementById('favorites-btn');
        if (favBtn) {
            favBtn.addEventListener('click', () => {
                this.showNotification('收藏功能即将推出', 'info');
            });
        }

        // 批量管理
        const batchManageBtn = document.getElementById('batch-manage-btn');
        const batchPanel = document.getElementById('batch-actions-panel');
        if (batchManageBtn && batchPanel) {
            batchManageBtn.addEventListener('click', () => {
                batchPanel.classList.toggle('hidden');
            });
        }
        const cancelBatchBtn = document.getElementById('cancel-batch-btn');
        if (cancelBatchBtn && batchPanel) {
            cancelBatchBtn.addEventListener('click', () => {
                batchPanel.classList.add('hidden');
            });
        }

        // 窗口缩放
        let resizeTimer = null;
        let lastWindowWidth = window.innerWidth;
        window.addEventListener('resize', () => {
            const currentWidth = window.innerWidth;
            if (currentWidth === lastWindowWidth) return;
            lastWindowWidth = currentWidth;
            document.body.classList.add('resize-animation-stopper');
            if (resizeTimer) clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                document.body.classList.remove('resize-animation-stopper');
            }, 100);
        });

        // 模型选择
        this.elements.modelSelectorTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleModelDropdown();
        });
        document.addEventListener('click', (e) => {
            if (!this.elements.modelDropdown.contains(e.target) &&
                !this.elements.modelSelectorTrigger.contains(e.target)) {
                this.hideModelDropdown();
            }
        });

        // 设置
        this.elements.settingsBtn.addEventListener('click', () => this.showSettingsModal());
        this.elements.closeSettingsModal.addEventListener('click', () => this.hideModal('settings'));
        this.elements.cancelSettings.addEventListener('click', () => this.hideModal('settings'));
        this.elements.saveSettings.addEventListener('click', () => this.saveSettings());
        this.elements.temperatureSlider.addEventListener('input', (e) => {
            this.elements.temperatureValue.textContent = e.target.value;
        });

        // 主题
        this.elements.darkModeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleThemePopup();
        });
        this.elements.themeOptions.forEach(option => {
            option.addEventListener('click', (e) => {
                e.stopPropagation();
                this.setTheme(option.dataset.theme);
                this.hideThemePopup();
            });
        });
        document.addEventListener('click', () => this.hideThemePopup());
    }

    _applyEnterMode(mode) {
        const indicator = document.getElementById('enter-mode-indicator');
        const input = this.elements.messageInput;
        if (mode === 'send') {
            if (indicator) { indicator.textContent = '⏎'; indicator.title = 'Enter 发送（点击切换）'; }
            if (input) input.placeholder = '输入消息，按 Enter 发送...';
        } else {
            if (indicator) { indicator.textContent = '↵'; indicator.title = 'Enter 换行（点击切换）'; }
            if (input) input.placeholder = '输入消息...';
        }
    }

    autoResizeTextarea() {
        const ta = this.elements.messageInput;
        if (!ta) return;
        ta.style.height = 'auto';
        ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
    }

    updateSendButtonState() {
        const hasText = this.elements.messageInput.value.trim().length > 0;
        this.elements.sendBtn.style.opacity = hasText ? '1' : '0.5';
    }

    handleScroll() {
        const mc = this.elements.messagesContainer;
        const isNearBottom = mc.scrollHeight - mc.scrollTop - mc.clientHeight < 100;
        this.elements.scrollToBottomBtn.style.display = isNearBottom ? 'none' : 'flex';
    }

    scrollToBottom() {
        const mc = this.elements.messagesContainer;
        mc.scrollTo({ top: mc.scrollHeight, behavior: 'smooth' });
    }

    handleFileChange() {
        const files = this.elements.fileInput.files;
        if (!files || files.length === 0) return;

        // 读取文本文件并附加到输入
        Array.from(files).forEach(file => {
            if (file.type === 'text/plain' || file.name.endsWith('.txt') ||
                file.name.endsWith('.py') || file.name.endsWith('.js') || file.name.endsWith('.c')) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const content = e.target.result;
                    this.elements.messageInput.value += '\n\n```\n' + content + '\n```';
                    this.autoResizeTextarea();
                    this.updateSendButtonState();
                };
                reader.readAsText(file);
            }
        });
        this.elements.fileInput.value = '';
    }

    removeUploadedFile() {
        this.elements.fileInput.value = '';
        this.elements.fileUploadStatus.classList.add('hidden');
    }

    // 侧边栏
    toggleSidebar() {
        document.body.classList.toggle('sidebar-open');
    }
    closeSidebar() {
        document.body.classList.remove('sidebar-open');
    }
    isMobile() {
        return window.innerWidth <= 768;
    }

    // 新建对话
    startNewConversation() {
        conversationHistory = [
            { role: "system", content: appSettings.getSystemPrompt() }
        ];
        const newId = chatHistoryManager.generateConversationId();
        chatHistoryManager.setCurrentConversationId(newId);

        // 清空消息区
        if (this.elements.messagesViewport) {
            this.elements.messagesViewport.innerHTML = '';
        }

        // 显示欢迎
        const welcome = document.getElementById('centered-welcome-header');
        if (welcome) welcome.style.display = '';

        this.state.centeredLayoutMode = true;
        this.renderConversationList();
        this.closeSidebar();
    }

    // 加载对话
    async switchToConversation(convId) {
        const data = await loadConversation(convId);
        if (!data) return;

        chatHistoryManager.setCurrentConversationId(convId);

        // 重建 conversationHistory
        conversationHistory = [
            { role: "system", content: appSettings.getSystemPrompt() }
        ];
        if (data.messages) {
            conversationHistory = conversationHistory.concat(data.messages);
        }

        // 重新渲染消息
        this.renderConversationMessages(data.messages || []);
        this.state.centeredLayoutMode = false;

        const welcome = document.getElementById('centered-welcome-header');
        if (welcome) welcome.style.display = 'none';

        this.renderConversationList();
        this.closeSidebar();
    }

    renderConversationMessages(messages) {
        const viewport = this.elements.messagesViewport;
        if (!viewport) return;
        viewport.innerHTML = '';

        const lastAssistantIdx = messages.reduce((acc, m, i) => m.role === 'assistant' ? i : acc, -1);

        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];
            if (msg.role === 'user') {
                addUserMessageBubble(typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content));
            } else if (msg.role === 'assistant') {
                // 构建 assistant 消息 DOM（与原版一致的结构）
                const messageDiv = document.createElement('div');
                messageDiv.className = 'message assistant';

                const avatar = document.createElement('div');
                avatar.className = 'message-avatar';
                avatar.innerHTML = '<i class="fas fa-robot"></i>';

                const messageContentWrapper = document.createElement('div');
                messageContentWrapper.className = 'message-content';

                const messageText = document.createElement('div');
                messageText.className = 'message-text markdown-body';
                // 只有最后一条 assistant 消息才使用 chatgpt-response ID
                if (i === lastAssistantIdx) {
                    messageText.id = 'chatgpt-response';
                }

                const html = processMathContent(msg.content || '', []);
                messageText.innerHTML = sanitizeHtml(html);
                messageText.dataset.rawContent = msg.content || '';
                messageText.appendChild(createMainResponseControls());

                renderMath(messageText);

                messageContentWrapper.appendChild(messageText);
                messageDiv.appendChild(avatar);
                messageDiv.appendChild(messageContentWrapper);
                viewport.appendChild(messageDiv);
            }
        }

        // 滚动到底部
        this.scrollToBottom();
    }

    // 对话列表渲染
    renderConversationList() {
        const list = this.elements.conversationList;
        if (!list) return;

        let uiConvs = [];
        try {
            uiConvs = JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'ui_conversations') || '[]');
        } catch (e) {}

        const currentId = chatHistoryManager.getCurrentConversationId();

        // 按 updated 排序
        uiConvs.sort((a, b) => (b.updated || 0) - (a.updated || 0));

        list.innerHTML = uiConvs.map(conv => `
            <div class="conversation-item ${conv.id === currentId ? 'active' : ''}" data-id="${conv.id}">
                <div class="conversation-info">
                    <span class="conversation-title">${escapeHtml(conv.title || '新对话')}</span>
                </div>
                <div class="conversation-actions">
                    <button class="delete-conversation-btn" data-id="${conv.id}" title="删除">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </div>
            </div>
        `).join('');

        // 绑定点击
        list.querySelectorAll('.conversation-item').forEach(el => {
            el.addEventListener('click', (e) => {
                if (e.target.closest('.delete-conversation-btn')) return;
                this.switchToConversation(el.dataset.id);
            });
        });

        // 绑定删除
        list.querySelectorAll('.delete-conversation-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                if (!confirm('确定要删除这个对话吗？')) return;
                await deleteConversation(id);
                if (chatHistoryManager.getCurrentConversationId() === id) {
                    this.startNewConversation();
                }
                this.renderConversationList();
            });
        });

        // 更新 state
        this.state.uiConversations = uiConvs;
    }

    // 搜索过滤
    filterConversations(query) {
        if (!query) {
            this.renderConversationList();
            return;
        }
        const list = this.elements.conversationList;
        if (!list) return;
        const q = query.toLowerCase();
        list.querySelectorAll('.conversation-item').forEach(item => {
            const title = item.querySelector('.conversation-title')?.textContent?.toLowerCase() || '';
            item.style.display = title.includes(q) ? '' : 'none';
        });
    }

    // 模型下拉
    toggleModelDropdown() {
        const dd = this.elements.modelDropdown;
        if (dd.classList.contains('show')) {
            this.hideModelDropdown();
        } else {
            this.renderModelList();
            // 定位到 trigger 下方
            const trigger = this.elements.modelSelectorTrigger;
            const rect = trigger.getBoundingClientRect();
            dd.style.top = (rect.bottom + 8) + 'px';
            dd.style.left = Math.max(8, rect.left + rect.width / 2 - 160) + 'px';
            dd.classList.add('show');
        }
    }

    hideModelDropdown() {
        this.elements.modelDropdown.classList.remove('show');
    }

    renderModelList() {
        const list = this.elements.modelList;
        if (!list || !window.ModelManager) return;
        const currentModel = window.modelName || appSettings.modelName;
        const models = window.ModelManager.getAll();

        list.innerHTML = '';

        // 模型列表
        models.forEach(m => {
            const item = document.createElement('div');
            item.className = 'model-item' + (m.id === currentModel ? ' active' : '');
            item.innerHTML = `
                <div class="model-icon"><i class="fas fa-robot"></i></div>
                <span class="model-name" style="flex:1;">${m.id}</span>
                ${m.thinking ? '<span style="font-size:11px;color:var(--text-secondary);margin-right:4px;">思考</span>' : ''}
                ${m.id === currentModel ? '<i class="fas fa-check" style="color:var(--primary-color);"></i>' : ''}
                <button class="model-delete-btn" data-model-id="${m.id}" title="删除" style="margin-left:4px;padding:4px 6px;border:none;background:none;color:var(--text-secondary);cursor:pointer;border-radius:4px;">
                    <i class="fas fa-times" style="font-size:11px;"></i>
                </button>
            `;
            // 点击选中
            item.addEventListener('click', (e) => {
                if (e.target.closest('.model-delete-btn')) return;
                switchModel(m.id);
                this.elements.currentModelDisplay.textContent = m.id;
                appSettings.modelName = m.id;
                appSettings.save();
                this.hideModelDropdown();
                if (typeof updateThinkingToggleVisibility === 'function') updateThinkingToggleVisibility();
            });
            list.appendChild(item);
        });

        // 删除按钮事件
        list.querySelectorAll('.model-delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.modelId;
                if (models.length <= 1) {
                    this.showNotification('至少保留一个模型', 'error');
                    return;
                }
                window.ModelManager.remove(id);
                if (window.modelName === id) {
                    const remaining = window.ModelManager.getAll();
                    if (remaining.length > 0) {
                        switchModel(remaining[0].id);
                        this.elements.currentModelDisplay.textContent = remaining[0].id;
                    }
                }
                this.renderModelList();
            });
        });

        // 添加模型入口
        const addRow = document.createElement('div');
        addRow.style.cssText = 'padding:8px;border-top:1px solid var(--border-color);';
        addRow.innerHTML = `
            <div style="display:flex;gap:6px;align-items:center;">
                <input type="text" id="add-model-input" placeholder="输入模型 ID，如 qwen2.5:7b" style="flex:1;padding:6px 10px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);font-size:13px;outline:none;">
                <label style="display:flex;align-items:center;gap:4px;font-size:12px;color:var(--text-secondary);white-space:nowrap;cursor:pointer;">
                    <input type="checkbox" id="add-model-thinking"> 思考
                </label>
                <button id="add-model-btn" style="padding:6px 12px;background:var(--primary-color);color:white;border:none;border-radius:6px;font-size:13px;cursor:pointer;white-space:nowrap;">添加</button>
            </div>
        `;
        list.appendChild(addRow);

        // 添加事件
        const addBtn = list.querySelector('#add-model-btn');
        const addInput = list.querySelector('#add-model-input');
        const addThinking = list.querySelector('#add-model-thinking');
        if (addBtn && addInput) {
            const doAdd = () => {
                const val = addInput.value.trim();
                if (!val) return;
                if (window.ModelManager.add(val, addThinking?.checked)) {
                    this.renderModelList();
                    this.showNotification(`已添加模型 ${val}`, 'success');
                } else {
                    this.showNotification('模型已存在', 'error');
                }
            };
            addBtn.addEventListener('click', doAdd);
            addInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); doAdd(); }
            });
        }
    }

    // 设置弹窗
    showSettingsModal() {
        const modal = this.elements.settingsModal;
        modal.classList.add('active');

        // 先用本地缓存回填
        document.getElementById('setting-api-url').value = appSettings.apiUrl || '';
        document.getElementById('setting-api-key').value = appSettings.apiKey || '';
        document.getElementById('setting-system-prompt').value = appSettings.systemPrompt || '';
        document.getElementById('setting-max-context').value = appSettings.maxContext || 20;
        this.elements.temperatureSlider.value = appSettings.temperature;
        this.elements.temperatureValue.textContent = appSettings.temperature;
        document.getElementById('setting-machine-code').value = '加载中...';
        document.getElementById('setting-license-key').value = appSettings.licenseKey || '';

        // 从 Go 后端取最新配置回填（覆盖本地缓存）
        fetch('/api/config').then(r => r.json()).then(cfg => {
            if (cfg.ollama?.base_url) {
                document.getElementById('setting-api-url').value = cfg.ollama.base_url;
                appSettings.apiUrl = cfg.ollama.base_url;
            }
        }).catch(() => {});

        // 从 Go 后端获取真实机器码和激活状态
        if (window.authManager?.checkLicense) {
            window.authManager.checkLicense().then(status => {
                document.getElementById('setting-machine-code').value = status.machine_code || 'N/A';
                const licenseStatus = document.getElementById('license-status');
                if (licenseStatus) {
                    if (status.activated) {
                        licenseStatus.textContent = '已激活';
                        licenseStatus.style.color = 'var(--success-color, #10b981)';
                    } else {
                        licenseStatus.textContent = '未激活';
                        licenseStatus.style.color = 'var(--error-color, #ef4444)';
                    }
                }
            });
        }

        const enterMode = localStorage.getItem('mola_standalone_enter_mode') || 'newline';
        document.getElementById('enter-mode-newline').checked = (enterMode === 'newline');
        document.getElementById('enter-mode-send').checked = (enterMode === 'send');
    }

    saveSettings() {
        const apiUrl = document.getElementById('setting-api-url').value.trim();
        const apiKey = document.getElementById('setting-api-key').value.trim();
        appSettings.systemPrompt = document.getElementById('setting-system-prompt').value.trim();
        appSettings.temperature = parseFloat(this.elements.temperatureSlider.value) || 0.7;
        appSettings.maxContext = parseInt(document.getElementById('setting-max-context').value) || 20;
        const licenseKey = document.getElementById('setting-license-key').value.trim();

        // Enter 模式
        const enterModeRadio = document.querySelector('input[name="enter-mode"]:checked');
        if (enterModeRadio) {
            localStorage.setItem('mola_standalone_enter_mode', enterModeRadio.value);
            this._applyEnterMode(enterModeRadio.value);
        }

        // 同步全局变量
        window.modelTemp = appSettings.temperature;

        // 更新系统提示词
        if (conversationHistory[0]?.role === 'system') {
            conversationHistory[0].content = appSettings.getSystemPrompt();
        }

        appSettings.save();

        // 同步 API 配置到前端缓存和 Go 后端
        appSettings.apiUrl = apiUrl;
        appSettings.apiKey = apiKey;
        if (apiUrl) {
            window.apiUrl = apiUrl;
        }

        fetch('/api/config', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ollama: { base_url: apiUrl || undefined, api_key: apiKey || undefined },
            }),
        }).catch(() => {});

        // 如果填了新的激活码，走后端激活
        if (licenseKey && licenseKey !== appSettings.licenseKey) {
            appSettings.licenseKey = licenseKey;
            appSettings.save();
            window.authManager?.activate(licenseKey).then(result => {
                const statusEl = document.getElementById('license-status');
                if (result.success) {
                    if (statusEl) { statusEl.textContent = '激活成功'; statusEl.style.color = 'var(--success-color, #10b981)'; }
                    this.showNotification('许可证激活成功', 'success');
                } else {
                    if (statusEl) { statusEl.textContent = result.message || '激活失败'; statusEl.style.color = 'var(--error-color, #ef4444)'; }
                    this.showNotification(result.message || '激活码无效', 'error');
                }
            });
        }

        this.hideModal('settings');
        this.showNotification('设置已保存', 'success');
    }

    hideModal(type) {
        if (type === 'settings') {
            this.elements.settingsModal.classList.remove('active');
        }
    }

    // 主题
    toggleThemePopup() {
        const popup = this.elements.themePopup;
        popup.style.display = popup.style.display === 'block' ? 'none' : 'block';
    }

    hideThemePopup() {
        this.elements.themePopup.style.display = 'none';
    }

    setTheme(theme) {
        if (theme === 'auto') {
            this.state.autoTheme = true;
            const prefersDark = this.systemThemeMediaQuery.matches;
            this.applyDarkMode(prefersDark);
        } else {
            this.state.autoTheme = false;
            this.applyDarkMode(theme === 'dark');
        }
        this.state.saveToStorage();

        // 更新选中状态
        this.elements.themeOptions.forEach(opt => {
            opt.classList.toggle('active', opt.dataset.theme === theme);
        });
    }

    applyDarkMode(isDark) {
        this.state.darkMode = isDark;
        document.body.classList.toggle('dark-theme', isDark);
        const icon = this.elements.darkModeBtn.querySelector('i');
        if (icon) {
            icon.className = isDark ? 'fas fa-sun' : 'fas fa-moon';
        }
    }

    initializeSystemThemeDetection() {
        this.systemThemeMediaQuery.addEventListener('change', (e) => {
            if (this.state.autoTheme) {
                this.applyDarkMode(e.matches);
            }
        });
    }

    // 通知
    showNotification(message, type = 'info') {
        let container = document.getElementById('notification-stack');
        if (!container) {
            container = document.createElement('div');
            container.id = 'notification-stack';
            document.body.appendChild(container);
        }
        const notif = document.createElement('div');
        notif.className = `notification notification-${type}`;
        notif.textContent = message;
        container.appendChild(notif);
        setTimeout(() => { notif.remove(); }, 3000);
    }

    // 初始化
    async initializeUI() {
        await this.state.loadFromStorage();

        // 主题
        if (this.state.autoTheme) {
            this.applyDarkMode(this.systemThemeMediaQuery.matches);
        } else {
            this.applyDarkMode(this.state.darkMode);
        }
        this.initializeSystemThemeDetection();

        // 加载设置
        appSettings.load();
        window.modelTemp = appSettings.temperature;

        // 渲染对话列表
        this.renderConversationList();

        // 如果有当前对话，加载它
        const currentId = chatHistoryManager.getCurrentConversationId();
        if (currentId) {
            const data = await loadConversation(currentId);
            if (data && data.messages && data.messages.length > 0) {
                conversationHistory = [{ role: "system", content: appSettings.getSystemPrompt() }].concat(data.messages);
                this.renderConversationMessages(data.messages);
                this.state.centeredLayoutMode = false;
                const welcome = document.getElementById('centered-welcome-header');
                if (welcome) welcome.style.display = 'none';
            }
        }

        // 隐藏加载器
        setTimeout(() => {
            const loader = this.elements.pageLoader;
            if (loader) {
                loader.style.opacity = '0';
                setTimeout(() => { loader.style.display = 'none'; }, 300);
            }
            document.body.classList.remove('page-enter');
        }, 500);
    }
}

// ======================== 初始化 ========================
document.addEventListener('DOMContentLoaded', function () {
    const state = new AppState();
    const ui = new UIController(state);

    window.molagpt = {
        state: state,
        ui: ui,
    };

    // 全局辅助函数
    window.renderConversationList = function () {
        ui.renderConversationList();
    };
});
