/**
 * TranslateGemma Background Service Worker
 * 負責與本地翻譯 API 伺服器通訊 + 右鍵選單翻譯
 */

const API_BASE_URL = 'http://localhost:8080';

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

    if (request.action === 'getSettings') {
        chrome.storage.sync.get({
            enabled: true,
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
