/**
 * TranslateGemma Popup JavaScript
 * 處理使用者互動與設定
 */

// DOM 元素
const statusDot = document.querySelector('.status-dot');
const statusText = document.querySelector('.status-text');
const enableToggle = document.getElementById('enableToggle');
const articleToggle = document.getElementById('articleToggle');
const wikipediaToggle = document.getElementById('wikipediaToggle');
const githubToggle = document.getElementById('githubToggle');
const targetLang = document.getElementById('targetLang');
const serverStatusText = document.getElementById('serverStatusText');
const serverToggle = document.getElementById('serverToggle');
const memoryStatusText = document.getElementById('memoryStatusText');

/**
 * 初始化
 */
async function init() {
    // 檢查伺服器狀態
    await checkServerStatus();
    await refreshControlStatus();

    // 載入設定
    await loadSettings();

    // 綁定事件
    bindEvents();

    // 定期刷新狀態
    setInterval(refreshControlStatus, 4000);
}

/**
 * 檢查伺服器狀態
 */
async function checkServerStatus() {
    try {
        const response = await chrome.runtime.sendMessage({ action: 'checkHealth' });

        if (response.healthy) {
            statusDot.classList.add('online');
            statusDot.classList.remove('offline');
            statusText.textContent = '伺服器運作中';
        } else {
            statusDot.classList.add('offline');
            statusDot.classList.remove('online');
            statusText.textContent = '伺服器離線';
        }
    } catch (error) {
        statusDot.classList.add('offline');
        statusText.textContent = '連線失敗';
    }
}

/**
 * 載入設定
 */
async function loadSettings() {
    try {
        const settings = await chrome.runtime.sendMessage({ action: 'getSettings' });

        enableToggle.checked = settings.enabled;
        articleToggle.checked = settings.articleEnabled !== false;
        wikipediaToggle.checked = settings.wikipediaEnabled !== false;
        githubToggle.checked = settings.githubEnabled !== false;
        targetLang.value = settings.targetLang || 'zh-TW';
    } catch (error) {
        console.error('載入設定失敗:', error);
    }
}

/**
 * 儲存設定
 */
async function saveSettings() {
    const settings = {
        enabled: enableToggle.checked,
        articleEnabled: articleToggle.checked,
        wikipediaEnabled: wikipediaToggle.checked,
        githubEnabled: githubToggle.checked,
        targetLang: targetLang.value
    };

    try {
        await chrome.runtime.sendMessage({
            action: 'saveSettings',
            settings
        });

        // 通知 content script 更新設定
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) {
            chrome.tabs.sendMessage(tab.id, {
                action: 'updateSettings',
                settings
            });
        }
    } catch (error) {
        console.error('儲存設定失敗:', error);
    }
}

/**
 * 取得 Launcher / 控制服務狀態
 */
async function refreshControlStatus() {
    if (!serverStatusText || !serverToggle) return;
    serverToggle.disabled = true;
    serverStatusText.textContent = '檢查中...';
    if (memoryStatusText) {
        memoryStatusText.textContent = '模型狀態檢查中...';
    }

    try {
        const response = await chrome.runtime.sendMessage({ action: 'getServerStatus' });
        if (!response?.ok) {
            serverStatusText.textContent = 'Launcher 未啟動';
            serverToggle.textContent = '啟動';
            serverToggle.classList.remove('stop');
            serverToggle.disabled = false;
            serverToggle.dataset.state = 'stopped';
            if (memoryStatusText) {
                memoryStatusText.textContent = '模型未載入';
            }
            return;
        }

        const data = response.data || {};
        const running = !!data.server_running;
        const ready = !!data.server_ready;
        const mode = data.mode ? ` (${data.mode})` : '';

        if (running) {
            serverStatusText.textContent = ready ? `運行中${mode}` : `啟動中${mode}`;
            serverToggle.textContent = '暫停';
            serverToggle.classList.add('stop');
            serverToggle.dataset.state = 'running';
            if (memoryStatusText) {
                memoryStatusText.textContent = ready ? '模型已載入' : '模型載入中...';
            }
        } else {
            serverStatusText.textContent = '已停止（預設關閉）';
            serverToggle.textContent = '啟動';
            serverToggle.classList.remove('stop');
            serverToggle.dataset.state = 'stopped';
            if (memoryStatusText) {
                memoryStatusText.textContent = '模型已卸載，記憶體已釋放';
            }
        }
        serverToggle.disabled = false;
    } catch (error) {
        serverStatusText.textContent = '狀態取得失敗';
        serverToggle.textContent = '啟動';
        serverToggle.classList.remove('stop');
        serverToggle.disabled = false;
        serverToggle.dataset.state = 'stopped';
        if (memoryStatusText) {
            memoryStatusText.textContent = '模型狀態未知';
        }
    }
}

async function handleServerToggle() {
    if (!serverToggle) return;
    serverToggle.disabled = true;
    const isRunning = serverToggle.dataset.state === 'running';

    if (isRunning) {
        await chrome.runtime.sendMessage({ action: 'stopServer' });
    } else {
        await chrome.runtime.sendMessage({ action: 'startServer' });
    }
    await refreshControlStatus();
    await checkServerStatus();
}

/**
 * 綁定事件
 */
function bindEvents() {
    // 設定變更
    enableToggle.addEventListener('change', saveSettings);
    articleToggle.addEventListener('change', saveSettings);
    wikipediaToggle.addEventListener('change', saveSettings);
    githubToggle.addEventListener('change', saveSettings);
    targetLang.addEventListener('change', saveSettings);
    if (serverToggle) {
        serverToggle.addEventListener('click', handleServerToggle);
    }

    // 設定連結
    const settingsLink = document.getElementById('settingsLink');
    if (settingsLink) {
        settingsLink.addEventListener('click', (e) => {
            e.preventDefault();
            chrome.runtime.openOptionsPage();
        });
    }
}

// 初始化
init();
