/**
 * TranslateGemma Content Script v4.0
 * 極簡模式：僅負責設定同步 (右鍵選單功能已移除)
 */

// ============== 設定 ==============
let settings = {
    targetLang: 'zh-TW'
};

// ============== 初始化 ==============
async function init() {
    console.log('🌐 TranslateGemma 內容腳本已載入 (極簡模式)');

    // 載入設定
    try {
        const response = await chrome.runtime.sendMessage({ action: 'getSettings' });
        settings = { ...settings, ...response };
    } catch (e) {
        // 設定載入失敗不影響功能
    }
}

// ============== 訊息監聽 ==============
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // 1. 更新設定
    if (request.action === 'updateSettings') {
        settings = { ...settings, ...request.settings };
        sendResponse({ success: true });
    }
});

// 啟動
init();

