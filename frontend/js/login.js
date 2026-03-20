/**
 * login.js — MolaGPT 独立版认证
 * 本地部署版：无需远程登录，通过 Go 后端管理许可证
 */
(function () {
    'use strict';

    class AuthManager {
        constructor() {
            this.user = null;
            this.token = null;
            this.licenseStatus = null;
            this.loadFromStorage();
        }

        loadFromStorage() {
            try {
                const saved = localStorage.getItem('molagpt_standalone_auth');
                if (saved) {
                    const data = JSON.parse(saved);
                    this.user = data.user;
                    this.token = data.token;
                }
            } catch (e) {}
        }

        saveToStorage() {
            try {
                localStorage.setItem('molagpt_standalone_auth', JSON.stringify({
                    user: this.user,
                    token: this.token,
                }));
            } catch (e) {}
        }

        isLoggedIn() {
            return !!this.user;
        }

        getToken() {
            return this.token || 'local';
        }

        getUsername() {
            return this.user?.username || '本地用户';
        }

        /**
         * 本地快速登录（不需要密码验证，直接设置用户名）
         */
        async login(username) {
            this.user = { username: username || '本地用户' };
            this.token = 'local_' + Date.now().toString(36);
            this.saveToStorage();
            return { success: true };
        }

        logout() {
            this.user = null;
            this.token = null;
            localStorage.removeItem('molagpt_standalone_auth');
            this.updateUI();
        }

        /**
         * 从 Go 后端获取许可证状态
         */
        async checkLicense() {
            try {
                const resp = await fetch('/api/license/status');
                const data = await resp.json();
                this.licenseStatus = data;
                return data;
            } catch (e) {
                // 后端未运行时回退
                this.licenseStatus = { activated: false, machine_code: 'N/A' };
                return this.licenseStatus;
            }
        }

        /**
         * 向 Go 后端提交激活码
         */
        async activate(licenseKey) {
            try {
                const resp = await fetch('/api/license/activate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ license_key: licenseKey }),
                });
                const data = await resp.json();
                if (data.success) {
                    this.licenseStatus = { activated: true };
                }
                return data;
            } catch (e) {
                return { success: false, message: '无法连接服务端' };
            }
        }

        updateUI() {
            const userBtn = document.getElementById('user-btn');
            const indicator = document.getElementById('user-status-indicator');
            if (this.isLoggedIn()) {
                if (indicator) indicator.classList.add('logged-in');
                if (userBtn) userBtn.title = `用户: ${this.getUsername()}`;
            } else {
                if (indicator) indicator.classList.remove('logged-in');
                if (userBtn) userBtn.title = '用户中心';
            }
        }
    }

    // 初始化
    const authManager = new AuthManager();
    window.authManager = authManager;

    document.addEventListener('DOMContentLoaded', function () {
        // 本地版自动登录
        if (!authManager.isLoggedIn()) {
            authManager.login('本地用户');
        }
        authManager.updateUI();

        // 检查许可证并更新设置面板中的信息
        authManager.checkLicense().then(status => {
            const machineCodeInput = document.getElementById('setting-machine-code');
            const licenseStatus = document.getElementById('license-status');
            if (machineCodeInput && status.machine_code) {
                machineCodeInput.value = status.machine_code;
            }
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

        // 用户按钮点击
        const userBtn = document.getElementById('user-btn');
        if (userBtn) {
            userBtn.addEventListener('click', () => {
                const name = authManager.getUsername();
                const activated = authManager.licenseStatus?.activated ? '已激活' : '未激活';
                alert(`用户: ${name}\n许可证: ${activated}`);
            });
        }
    });
})();
