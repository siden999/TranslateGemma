/**
 * TranslateGemma Content Script
 * 負責網頁內容擷取與雙語顯示
 */

// 設定
let settings = {
    enabled: true,
    targetLang: 'zh-TW',
    showOriginal: true
};

// 翻譯狀態
let translationEnabled = false;
let translatedElements = new Set();

/**
 * 初始化
 */
async function init() {
    // 載入設定
    const response = await chrome.runtime.sendMessage({ action: 'getSettings' });
    settings = { ...settings, ...response };

    console.log('TranslateGemma Content Script 已載入');
}

/**
 * 偵測語言（簡化版，根據字符判斷）
 */
function detectLanguage(text) {
    // 簡單判斷：如果包含大量中文字符，則為中文
    const chineseRegex = /[\u4e00-\u9fff]/g;
    const chineseMatches = text.match(chineseRegex) || [];
    const chineseRatio = chineseMatches.length / text.length;

    if (chineseRatio > 0.3) {
        return 'zh';
    }

    // 日文
    const japaneseRegex = /[\u3040-\u309f\u30a0-\u30ff]/g;
    const japaneseMatches = text.match(japaneseRegex) || [];
    if (japaneseMatches.length > 0) {
        return 'ja';
    }

    // 韓文
    const koreanRegex = /[\uac00-\ud7af]/g;
    const koreanMatches = text.match(koreanRegex) || [];
    if (koreanMatches.length > 0) {
        return 'ko';
    }

    // 預設英文
    return 'en';
}

/**
 * 翻譯單一段落
 */
async function translateElement(element) {
    if (translatedElements.has(element)) {
        return;
    }

    const originalText = element.textContent.trim();
    if (!originalText || originalText.length < 5) {
        return;
    }

    // 偵測語言
    const sourceLang = detectLanguage(originalText);

    // 如果已經是目標語言，跳過
    if (sourceLang === settings.targetLang.split('-')[0]) {
        return;
    }

    try {
        // 標記為處理中
        translatedElements.add(element);
        element.classList.add('tg-translating');

        // 呼叫翻譯 API
        const response = await chrome.runtime.sendMessage({
            action: 'translate',
            text: originalText,
            sourceLang: sourceLang,
            targetLang: settings.targetLang
        });

        if (response.success) {
            // 插入翻譯結果
            insertTranslation(element, response.translation);
        }

        element.classList.remove('tg-translating');
        element.classList.add('tg-translated');

    } catch (error) {
        console.error('翻譯元素失敗:', error);
        element.classList.remove('tg-translating');
        translatedElements.delete(element);
    }
}

/**
 * 插入翻譯結果（雙語對照）
 */
function insertTranslation(element, translation) {
    // 建立翻譯容器
    const container = document.createElement('div');
    container.className = 'tg-translation-container';

    // 翻譯文字
    const translationEl = document.createElement('div');
    translationEl.className = 'tg-translation';
    translationEl.textContent = translation;

    container.appendChild(translationEl);

    // 插入到原文後面
    element.insertAdjacentElement('afterend', container);
}

/**
 * 翻譯頁面上的段落
 */
async function translatePage() {
    // 選取可能需要翻譯的元素
    const selectors = 'p, h1, h2, h3, h4, h5, h6, li, td, th, blockquote, .article-content, article p';
    const elements = document.querySelectorAll(selectors);

    // 過濾並翻譯
    for (const element of elements) {
        // 跳過已翻譯、隱藏、或太短的元素
        if (translatedElements.has(element)) continue;
        if (element.offsetParent === null) continue;
        if (element.textContent.trim().length < 10) continue;

        // 檢查是否在可視區域
        const rect = element.getBoundingClientRect();
        const inViewport = rect.top < window.innerHeight && rect.bottom > 0;

        if (inViewport) {
            await translateElement(element);
        }
    }
}

/**
 * 切換翻譯顯示
 */
function toggleTranslation() {
    translationEnabled = !translationEnabled;

    if (translationEnabled) {
        translatePage();
        document.body.classList.add('tg-enabled');
    } else {
        // 隱藏翻譯
        document.querySelectorAll('.tg-translation-container').forEach(el => {
            el.style.display = 'none';
        });
        document.body.classList.remove('tg-enabled');
    }
}

/**
 * 顯示/隱藏已翻譯的內容
 */
function showTranslations(show) {
    document.querySelectorAll('.tg-translation-container').forEach(el => {
        el.style.display = show ? 'block' : 'none';
    });
}

/**
 * 監聽來自 background 的訊息
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'toggleTranslation') {
        toggleTranslation();
        sendResponse({ enabled: translationEnabled });
    }

    if (request.action === 'translatePage') {
        translationEnabled = true;
        document.body.classList.add('tg-enabled');
        translatePage();
        sendResponse({ success: true });
    }

    if (request.action === 'updateSettings') {
        settings = { ...settings, ...request.settings };
        sendResponse({ success: true });
    }
});

// 初始化
init();

// 滾動時翻譯新出現的內容
let scrollTimeout;
window.addEventListener('scroll', () => {
    if (!translationEnabled) return;

    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(translatePage, 500);
});
