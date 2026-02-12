/**
 * TranslateGemma Background Service Worker
 * 負責與本地翻譯 API 伺服器通訊 + 右鍵選單翻譯
 */

const API_BASE_URL = 'http://127.0.0.1:8080';
const CONTROL_BASE_URL = 'http://127.0.0.1:18181';

// 翻譯快取
const translationCache = new Map();

// 右鍵選單已移除

/**
 * 檢查 API 伺服器是否運作中
 */
async function checkServerHealth() {
    try {
        const response = await fetch(`${API_BASE_URL}/health`);
        const data = await response.json();
        return data.status === 'ok' && data.model_loaded;
    } catch (error) {
        console.error('伺服器健康檢查失敗:', error);
        return false;
    }
}

/**
 * 檢查 Launcher / 控制服務狀態
 */
async function getControlStatus() {
    try {
        const response = await fetch(`${CONTROL_BASE_URL}/status`);
        const data = await response.json();
        return { ok: true, data };
    } catch (error) {
        console.error('控制服務狀態取得失敗:', error);
        return { ok: false, error: error.message };
    }
}

async function startServer() {
    try {
        const response = await fetch(`${CONTROL_BASE_URL}/start`, { method: 'POST' });
        const data = await response.json();
        return { ok: true, data };
    } catch (error) {
        console.error('啟動伺服器失敗:', error);
        return { ok: false, error: error.message };
    }
}

async function stopServer() {
    try {
        const response = await fetch(`${CONTROL_BASE_URL}/stop`, { method: 'POST' });
        const data = await response.json();
        return { ok: true, data };
    } catch (error) {
        console.error('停止伺服器失敗:', error);
        return { ok: false, error: error.message };
    }
}

function broadcastServerStarted() {
    chrome.tabs.query({ url: ['*://*.youtube.com/*'] }, (tabs) => {
        if (chrome.runtime.lastError) {
            console.warn('無法取得分頁清單:', chrome.runtime.lastError.message);
            return;
        }
        tabs.forEach(tab => {
            if (!tab?.id) return;
            chrome.tabs.sendMessage(tab.id, { action: 'serverStarted' }, () => {
                // 忽略未注入 content script 的分頁錯誤
                if (chrome.runtime.lastError) {
                    return;
                }
            });
        });
    });
}

/**
 * 呼叫翻譯 API
 */
async function translateText(text, sourceLang = 'en', targetLang = 'zh-TW') {
    // 檢查快取
    const cacheKey = `${sourceLang}:${targetLang}:${text}`;
    if (translationCache.has(cacheKey)) {
        return translationCache.get(cacheKey);
    }

    try {
        const response = await fetch(`${API_BASE_URL}/translate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                text: text,
                source_lang: sourceLang,
                target_lang: targetLang
            })
        });

        if (!response.ok) {
            throw new Error(`API 錯誤: ${response.status}`);
        }

        const data = await response.json();

        // 儲存到快取
        translationCache.set(cacheKey, data.translation);

        return data.translation;
    } catch (error) {
        console.error('翻譯失敗:', error);
        throw error;
    }
}

/**
 * 監聽來自 content script 的訊息
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'translate') {
        translateText(request.text, request.sourceLang, request.targetLang)
            .then(translation => {
                sendResponse({ success: true, translation });
            })
            .catch(error => {
                sendResponse({ success: false, error: error.message });
            });
        return true; // 非同步回應
    }

    if (request.action === 'checkHealth') {
        checkServerHealth()
            .then(healthy => {
                sendResponse({ healthy });
            });
        return true;
    }

    if (request.action === 'getServerStatus') {
        getControlStatus().then(result => {
            sendResponse(result);
        });
        return true;
    }

    if (request.action === 'startServer') {
        startServer().then(result => {
            if (result?.ok) {
                broadcastServerStarted();
            }
            sendResponse(result);
        });
        return true;
    }

    if (request.action === 'stopServer') {
        stopServer().then(result => {
            sendResponse(result);
        });
        return true;
    }

    if (request.action === 'getSettings') {
        chrome.storage.sync.get({
            enabled: true,
            articleEnabled: true,
            wikipediaEnabled: true,
            githubEnabled: true,
            targetLang: 'zh-TW',
            autoTranslate: true
        }, (settings) => {
            sendResponse(settings);
        });
        return true;
    }

    if (request.action === 'saveSettings') {
        chrome.storage.sync.set(request.settings, () => {
            sendResponse({ success: true });
        });
        return true;
    }
});

/**
 * 監聽快捷鍵
 */
chrome.commands.onCommand.addListener((command) => {
    if (command === 'toggle-translation') {
        // 發送訊息給當前分頁的 content script
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, { action: 'toggleTranslation' });
            }
        });
    }
});

console.log('TranslateGemma Background Service Worker 已啟動');
