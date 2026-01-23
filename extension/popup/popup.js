/**
 * TranslateGemma Popup JavaScript
 * 處理使用者互動與設定
 */

// DOM 元素
const statusDot = document.querySelector('.status-dot');
const statusText = document.querySelector('.status-text');
const enableToggle = document.getElementById('enableToggle');
const translateBtn = document.getElementById('translateBtn');
const targetLang = document.getElementById('targetLang');
const showOriginal = document.getElementById('showOriginal');
const hoverTranslate = document.getElementById('hoverTranslate');

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
            translateBtn.disabled = false;
        } else {
            statusDot.classList.add('offline');
            statusDot.classList.remove('online');
            statusText.textContent = '伺服器離線';
            translateBtn.disabled = true;
        }
    } catch (error) {
        statusDot.classList.add('offline');
        statusText.textContent = '連線失敗';
        translateBtn.disabled = true;
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
        showOriginal.checked = settings.showOriginal;
        hoverTranslate.checked = settings.hoverTranslate !== false; // 預設開啟
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
        targetLang: targetLang.value,
        showOriginal: showOriginal.checked,
        hoverTranslate: hoverTranslate.checked
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
 * 翻譯當前頁面
 */
async function translateCurrentPage() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (tab) {
            await chrome.tabs.sendMessage(tab.id, { action: 'translatePage' });

            // 更新按鈕狀態
            translateBtn.textContent = '翻譯中...';
            translateBtn.disabled = true;

            setTimeout(() => {
                translateBtn.innerHTML = '<span class="btn-icon">📖</span> 翻譯此頁面';
                translateBtn.disabled = false;
            }, 2000);
        }
    } catch (error) {
        console.error('翻譯頁面失敗:', error);
    }
}

/**
 * 綁定事件
 */
function bindEvents() {
    // 翻譯按鈕
    translateBtn.addEventListener('click', translateCurrentPage);

    // 設定變更
    enableToggle.addEventListener('change', saveSettings);
    targetLang.addEventListener('change', saveSettings);
    showOriginal.addEventListener('change', saveSettings);
    hoverTranslate.addEventListener('change', saveSettings);

    // 設定連結
    document.getElementById('settingsLink').addEventListener('click', (e) => {
        e.preventDefault();
        chrome.runtime.openOptionsPage();
    });
}

// 初始化
init();
