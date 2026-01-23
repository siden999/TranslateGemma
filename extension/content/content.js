/**
 * TranslateGemma Content Script v2.0
 * 沉浸式自動翻譯 - 頁面載入即自動翻譯
 */

// ============== 設定 ==============
let settings = {
    enabled: true,           // 預設啟用翻譯
    targetLang: 'zh-TW',
    showOriginal: true,
    autoTranslate: true      // 自動翻譯
};

// ============== 狀態管理 ==============
const translatedElements = new Set();
const translationCache = new Map();  // 快取：原文 -> 譯文
let isTranslating = false;
let pendingElements = [];

// ============== 初始化 ==============
async function init() {
    console.log('🌐 TranslateGemma 沉浸式翻譯已載入');

    // 載入設定
    try {
        const response = await chrome.runtime.sendMessage({ action: 'getSettings' });
        settings = { ...settings, ...response };
    } catch (e) {
        console.log('使用預設設定');
    }

    // 如果啟用且為自動翻譯模式，頁面載入後自動開始
    if (settings.enabled && settings.autoTranslate) {
        // 等待頁面穩定後開始翻譯
        if (document.readyState === 'complete') {
            startAutoTranslate();
        } else {
            window.addEventListener('load', () => {
                setTimeout(startAutoTranslate, 500);
            });
        }
    }

    // 監聽滾動，翻譯新出現的內容
    window.addEventListener('scroll', throttle(onScroll, 300));

    // 監聽 DOM 變化（動態載入的內容）
    observeDOMChanges();
}

// ============== 自動翻譯入口 ==============
function startAutoTranslate() {
    console.log('🚀 開始自動翻譯頁面...');
    document.body.classList.add('tg-enabled');
    translateVisibleElements();
}

// ============== 偵測語言 ==============
function detectLanguage(text) {
    const chineseRegex = /[\u4e00-\u9fff]/g;
    const chineseMatches = text.match(chineseRegex) || [];
    if (chineseMatches.length / text.length > 0.3) return 'zh';

    const japaneseRegex = /[\u3040-\u309f\u30a0-\u30ff]/g;
    if ((text.match(japaneseRegex) || []).length > 0) return 'ja';

    const koreanRegex = /[\uac00-\ud7af]/g;
    if ((text.match(koreanRegex) || []).length > 0) return 'ko';

    return 'en';
}

// ============== 收集可翻譯元素 ==============
function collectTranslatableElements() {
    const selectors = [
        'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'li', 'td', 'th', 'blockquote', 'figcaption',
        'article p', '.article-content p', '.post-content p',
        '[class*="content"] p', '[class*="article"] p'
    ].join(', ');

    const elements = document.querySelectorAll(selectors);
    const result = [];

    for (const element of elements) {
        // 跳過已處理的元素
        if (translatedElements.has(element)) continue;

        // 跳過隱藏元素
        if (element.offsetParent === null) continue;

        // 跳過太短的文字
        const text = element.textContent.trim();
        if (text.length < 15) continue;

        // 跳過已是目標語言
        const lang = detectLanguage(text);
        if (lang === settings.targetLang.split('-')[0]) continue;

        result.push({ element, text, lang });
    }

    return result;
}

// ============== 翻譯可視區域的元素 ==============
async function translateVisibleElements() {
    if (isTranslating) return;

    const allElements = collectTranslatableElements();

    // 篩選可視區域內的元素
    const visibleElements = allElements.filter(({ element }) => {
        const rect = element.getBoundingClientRect();
        return rect.top < window.innerHeight + 200 && rect.bottom > -200;
    });

    if (visibleElements.length === 0) return;

    console.log(`📝 找到 ${visibleElements.length} 個待翻譯段落`);

    // 批次處理翻譯
    await translateBatch(visibleElements);
}

// ============== 批次翻譯 ==============
async function translateBatch(items) {
    isTranslating = true;

    // 先顯示載入狀態
    for (const { element } of items) {
        if (!translatedElements.has(element)) {
            translatedElements.add(element);
            showLoadingState(element);
        }
    }

    // 並行翻譯（最多 3 個同時）
    const concurrency = 3;
    const chunks = [];
    for (let i = 0; i < items.length; i += concurrency) {
        chunks.push(items.slice(i, i + concurrency));
    }

    for (const chunk of chunks) {
        await Promise.all(chunk.map(item => translateSingleElement(item)));
    }

    isTranslating = false;

    // 檢查是否有更多待翻譯的內容
    setTimeout(translateVisibleElements, 100);
}

// ============== 翻譯單一元素 ==============
async function translateSingleElement({ element, text, lang }) {
    // 檢查快取
    const cacheKey = `${lang}:${settings.targetLang}:${text.substring(0, 100)}`;
    if (translationCache.has(cacheKey)) {
        insertTranslation(element, translationCache.get(cacheKey));
        return;
    }

    try {
        const response = await chrome.runtime.sendMessage({
            action: 'translate',
            text: text,
            sourceLang: lang,
            targetLang: settings.targetLang
        });

        if (response.success && response.translation) {
            // 存入快取
            translationCache.set(cacheKey, response.translation);
            // 插入翻譯
            insertTranslation(element, response.translation);
        } else {
            removeLoadingState(element);
        }
    } catch (error) {
        console.error('翻譯失敗:', error);
        removeLoadingState(element);
    }
}

// ============== 顯示載入狀態 ==============
function showLoadingState(element) {
    element.classList.add('tg-translating');

    // 建立骨架載入效果
    const skeleton = document.createElement('div');
    skeleton.className = 'tg-translation-skeleton';
    skeleton.innerHTML = `
        <div class="tg-skeleton-line" style="width: 90%"></div>
        <div class="tg-skeleton-line" style="width: 75%"></div>
        <div class="tg-skeleton-line" style="width: 60%"></div>
    `;
    element.insertAdjacentElement('afterend', skeleton);
}

// ============== 移除載入狀態 ==============
function removeLoadingState(element) {
    element.classList.remove('tg-translating');
    const skeleton = element.nextElementSibling;
    if (skeleton && skeleton.classList.contains('tg-translation-skeleton')) {
        skeleton.remove();
    }
}

// ============== 插入翻譯結果 ==============
function insertTranslation(element, translation) {
    // 移除載入骨架
    removeLoadingState(element);

    element.classList.add('tg-translated');

    // 建立翻譯容器
    const container = document.createElement('div');
    container.className = 'tg-translation-container';

    const translationEl = document.createElement('div');
    translationEl.className = 'tg-translation';
    translationEl.textContent = translation;

    container.appendChild(translationEl);
    element.insertAdjacentElement('afterend', container);
}

// ============== 滾動處理 ==============
function onScroll() {
    if (settings.enabled && settings.autoTranslate) {
        translateVisibleElements();
    }
}

// ============== 監聽 DOM 變化 ==============
function observeDOMChanges() {
    const observer = new MutationObserver(throttle(() => {
        if (settings.enabled && settings.autoTranslate) {
            translateVisibleElements();
        }
    }, 1000));

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
}

// ============== 切換翻譯顯示 ==============
function toggleTranslation() {
    settings.enabled = !settings.enabled;

    if (settings.enabled) {
        document.body.classList.add('tg-enabled');
        startAutoTranslate();
    } else {
        document.body.classList.remove('tg-enabled');
        document.querySelectorAll('.tg-translation-container, .tg-translation-skeleton').forEach(el => {
            el.style.display = 'none';
        });
    }

    return settings.enabled;
}

// ============== 工具函數 ==============
function throttle(func, limit) {
    let inThrottle;
    return function (...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// ============== 訊息監聽 ==============
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'toggleTranslation') {
        const enabled = toggleTranslation();
        sendResponse({ enabled });
    }

    if (request.action === 'translatePage') {
        settings.enabled = true;
        startAutoTranslate();
        sendResponse({ success: true });
    }

    if (request.action === 'updateSettings') {
        settings = { ...settings, ...request.settings };
        if (settings.enabled && settings.autoTranslate) {
            startAutoTranslate();
        }
        sendResponse({ success: true });
    }
});

// 啟動
init();
