/**
 * TranslateGemma Popup JavaScript
 * 處理使用者互動與設定
 */

// DOM 元素
const statusDot = document.querySelector('.status-dot');
const statusText = document.querySelector('.status-text');
const enableToggle = document.getElementById('enableToggle');
const targetLang = document.getElementById('targetLang');

/**
 * 初始化
 */
async function init() {
    // 檢查伺服器狀態
    await checkServerStatus();

    // 載入設定
    await loadSettings();

    // 綁定事件
    bindEvents();
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
 * 綁定事件
 */
function bindEvents() {
    // 設定變更
    enableToggle.addEventListener('change', saveSettings);
    targetLang.addEventListener('change', saveSettings);

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
