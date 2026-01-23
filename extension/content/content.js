/**
 * TranslateGemma Content Script v2.0
 * 沉浸式自動翻譯 - 頁面載入即自動翻譯
 */

// ============== 設定 ==============
let settings = {
    enabled: true,           // 啟用整頁翻譯
    targetLang: 'zh-TW',
    autoTranslate: true,     // 自動翻譯
    hoverTranslate: true     // 滑鼠懸停翻譯
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

    // 滑鼠懸停翻譯
    if (settings.hoverTranslate) {
        setupHoverTranslation();
    }

    // 反白選取翻譯（永遠啟用）
    setupSelectionTranslation();
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
// 需要排除的選擇器（廣告、腳本、導航等）
const EXCLUDE_SELECTORS = [
    // 腳本和樣式
    'script', 'style', 'noscript', 'iframe', 'canvas', 'svg',
    'code', 'pre', 'textarea', 'input', 'button', 'select', 'option',

    // 導航元素（只排除標籤本身）
    'nav', 'menu', 'menuitem',
    '[role="navigation"]', '[role="menu"]', '[role="menubar"]', '[role="menuitem"]',
    '[role="button"]', '[role="tab"]', '[role="tablist"]',

    // 廣告
    '[class*="ad-"]', '[class*="ads-"]', '[class*="advert"]',
    '[id*="ad-"]', '[id*="ads-"]', '[id*="advert"]',
    '[class*="sponsor"]', '[class*="banner"]',
    '[data-ad]', '[data-ads]', '[data-advertisement]',
    '.ad', '.ads', '.advertisement', '.sponsored',
    '.google-ad', '.dfp-ad', '.taboola', '.outbrain',

    // 其他
    '[aria-hidden="true"]'
].join(', ');

function collectTranslatableElements() {
    // 優先從語義區域收集（article, main）
    const contentAreas = document.querySelectorAll('article, main, [role="main"], [role="article"], .content, .post, .entry');

    // 如果沒有語義區域，則從 body 收集
    const searchAreas = contentAreas.length > 0 ? contentAreas : [document.body];

    // 基本的內容選擇器
    const contentSelectors = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, figcaption';

    const result = [];

    for (const area of searchAreas) {
        const elements = area.querySelectorAll(contentSelectors);

        for (const element of elements) {
            // 跳過已處理的元素
            if (translatedElements.has(element)) continue;

            // 跳過隱藏元素
            if (element.offsetParent === null) continue;

            // 跳過廣告區塊
            if (element.closest(EXCLUDE_SELECTORS)) continue;
            if (element.matches && element.matches(EXCLUDE_SELECTORS)) continue;

            // 🔑 核心過濾：智能內容偵測
            if (!isTranslatableContent(element)) continue;

            const text = element.textContent.trim();
            const lang = detectLanguage(text);

            // 跳過已是目標語言
            if (lang === settings.targetLang.split('-')[0]) continue;

            result.push({ element, text, lang });
        }
    }

    return result;
}

// ============== 智能內容偵測 ==============
function isTranslatableContent(element) {
    const text = element.textContent.trim();

    // 1. 文字長度過濾（太短可能是按鈕或導航）
    if (text.length < 25) return false;
    if (text.length > 5000) return false; // 太長可能是整個區塊

    // 2. 排除互動元素
    if (element.closest('button, [role="button"]')) return false;
    if (element.tagName === 'A' || element.closest('a')) {
        // 如果是短連結，跳過
        if (text.length < 50) return false;
    }

    // 3. 排除導航區域
    if (element.closest('nav, [role="navigation"], header, footer')) return false;

    // 4. 排除高連結密度區域（導航欄特徵）
    const links = element.querySelectorAll('a');
    const linkTextLength = Array.from(links).reduce((sum, a) => sum + a.textContent.length, 0);
    if (text.length > 0 && linkTextLength / text.length > 0.7) return false;

    // 5. 排除程式碼內容
    if (isCodeLikeContent(text)) return false;

    return true;
}

// 檢測是否為程式碼內容
function isCodeLikeContent(text) {
    // 常見的程式碼特徵
    const codePatterns = [
        /\bfunction\s*\(/,           // function(
        /\bvar\s+\w+\s*=/,           // var x =
        /\bconst\s+\w+\s*=/,         // const x =
        /\blet\s+\w+\s*=/,           // let x =
        /document\.\w+\(/,           // document.write(
        /Math\.\w+\(/,               // Math.random(
        /\{\s*[\w"']:\s*/,           // { key:
        /<scr[^\>]*>/i,              // <script>
        /src\s*=\s*['"]/,            // src="
        /\(\s*function\s*\(/,        // (function(
        /=>\s*\{/,                   // =>  {
        /\$\(['"]/,                  // $(" or $('
        /https?:\/\/[^\s]+\.js/,     // .js URLs
    ];

    return codePatterns.some(pattern => pattern.test(text));
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

    // 建立骨架載入效果（內聯版）
    const skeleton = document.createElement('span');
    skeleton.className = 'tg-translation-skeleton';
    skeleton.innerHTML = `
        <span class="tg-skeleton-line" style="width: 90%"></span>
        <span class="tg-skeleton-line" style="width: 75%"></span>
        <span class="tg-skeleton-line" style="width: 60%"></span>
    `;
    element.appendChild(skeleton);
}

// ============== 移除載入狀態 ==============
function removeLoadingState(element) {
    element.classList.remove('tg-translating');
    const skeleton = element.querySelector('.tg-translation-skeleton');
    if (skeleton) {
        skeleton.remove();
    }
}

// ============== 插入翻譯結果 ==============
function insertTranslation(element, translation) {
    // 移除載入骨架
    removeLoadingState(element);

    element.classList.add('tg-translated');

    // 建立翻譯容器 - 放在原文元素內部以避免破壞 flex/grid 佈局
    const container = document.createElement('span');
    container.className = 'tg-translation-inline';

    const translationEl = document.createElement('span');
    translationEl.className = 'tg-translation';
    translationEl.textContent = translation;

    container.appendChild(translationEl);

    // 插入到元素內部末尾（而非作為兄弟元素）
    element.appendChild(container);
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
        const oldHoverSetting = settings.hoverTranslate;
        settings = { ...settings, ...request.settings };

        if (settings.enabled && settings.autoTranslate) {
            startAutoTranslate();
        }

        // 動態啟用/停用懸停翻譯
        if (settings.hoverTranslate && !oldHoverSetting) {
            setupHoverTranslation();
        } else if (!settings.hoverTranslate && oldHoverSetting) {
            removeHoverListeners();
        }

        sendResponse({ success: true });
    }

    // 右鍵選單翻譯結果顯示
    if (request.action === 'showSelectionTranslation') {
        showSelectionPopup(request.originalText, request.translation, request.isError);
        sendResponse({ success: true });
    }
});

// ============== 選取翻譯彈出框 ==============
function showSelectionPopup(originalText, translation, isError = false) {
    // 移除已存在的彈出框
    removeSelectionPopup();

    // 取得選取的位置
    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    // 建立彈出框
    const popup = document.createElement('div');
    popup.className = 'tg-selection-popup';
    popup.id = 'tg-selection-popup';

    popup.innerHTML = `
        <div class="tg-popup-header">
            <span class="tg-popup-icon">${isError ? '⚠️' : '🌐'}</span>
            <span class="tg-popup-title">TranslateGemma</span>
            <button class="tg-popup-close" onclick="this.parentElement.parentElement.remove()">✕</button>
        </div>
        <div class="tg-popup-content ${isError ? 'tg-popup-error' : ''}">
            ${translation}
        </div>
    `;

    // 定位彈出框
    popup.style.position = 'fixed';
    popup.style.left = `${Math.min(rect.left, window.innerWidth - 350)}px`;
    popup.style.top = `${rect.bottom + 10}px`;
    popup.style.zIndex = '2147483647';

    document.body.appendChild(popup);

    // 點擊其他地方關閉
    setTimeout(() => {
        document.addEventListener('click', handleClickOutside);
    }, 100);
}

function removeSelectionPopup() {
    const existing = document.getElementById('tg-selection-popup');
    if (existing) existing.remove();
    document.removeEventListener('click', handleClickOutside);
}

function handleClickOutside(e) {
    const popup = document.getElementById('tg-selection-popup');
    if (popup && !popup.contains(e.target)) {
        removeSelectionPopup();
    }
}

// ============== 反白選取翻譯 ==============
function setupSelectionTranslation() {
    console.log('📝 反白選取翻譯已啟用');
    document.addEventListener('mouseup', handleTextSelection);
    document.addEventListener('keyup', handleTextSelection);
}

function handleTextSelection(e) {
    // 延遲處理，確保選取完成
    setTimeout(async () => {
        const selection = window.getSelection();
        const selectedText = selection.toString().trim();

        // 檢查是否有有效選取
        if (!selectedText || selectedText.length < 2 || selectedText.length > 2000) {
            return;
        }

        // 檢查是否點擊在我們的元素上
        if (e.target?.closest('.tg-selection-popup, .tg-hover-tooltip')) {
            return;
        }

        // 跳過看起來像代碼的內容
        if (isCodeLikeContent(selectedText)) {
            return;
        }

        // 檢查語言（如果已經是目標語言就不翻譯）
        const lang = detectLanguage(selectedText);
        if (lang === settings.targetLang.split('-')[0]) {
            return;
        }

        // 直接自動翻譯
        await translateSelection(selectedText);
    }, 100);  // 稍微延長等待時間確保選取穩定
}

async function translateSelection(text) {
    // 移除舊的彈出框
    removeSelectionPopup();

    // 顯示載入中
    showSelectionPopup(text, '翻譯中...', false);

    try {
        const response = await chrome.runtime.sendMessage({
            action: 'translate',
            text: text,
            sourceLang: detectLanguage(text),
            targetLang: settings.targetLang
        });

        if (response?.success && response.translation) {
            showSelectionPopup(text, response.translation, false);
        } else {
            showSelectionPopup(text, '翻譯失敗', true);
        }
    } catch (e) {
        console.error('選取翻譯失敗:', e);
        showSelectionPopup(text, '翻譯失敗: ' + e.message, true);
    }
}

// ============== 滑鼠懸停翻譯 ==============
let hoverTimeout = null;
let currentHoverElement = null;
let hoverTooltip = null;

function setupHoverTranslation() {
    console.log('🖱️ 滑鼠懸停翻譯已啟用');

    document.addEventListener('mouseover', handleMouseOver);
    document.addEventListener('mouseout', handleMouseOut);
}

function removeHoverListeners() {
    console.log('🖱️ 滑鼠懸停翻譯已停用');
    document.removeEventListener('mouseover', handleMouseOver);
    document.removeEventListener('mouseout', handleMouseOut);
    removeHoverTooltip();
}

function handleMouseOver(e) {
    // 懸停翻譯獨立於整頁翻譯開關
    if (!settings.hoverTranslate) return;

    // 找到最近的可翻譯元素
    const element = findTranslatableParent(e.target);
    if (!element || element === currentHoverElement) return;

    // 清除之前的計時器
    clearTimeout(hoverTimeout);
    removeHoverTooltip();

    currentHoverElement = element;

    // 延遲 500ms 後顯示翻譯（避免滑鼠快速移動時頻繁觸發）
    hoverTimeout = setTimeout(async () => {
        await showHoverTranslation(element);
    }, 500);
}

function handleMouseOut(e) {
    // 檢查是否移動到 tooltip 上
    if (hoverTooltip && hoverTooltip.contains(e.relatedTarget)) {
        return;
    }

    clearTimeout(hoverTimeout);

    // 延遲移除 tooltip（讓用戶有時間將滑鼠移到 tooltip 上）
    setTimeout(() => {
        if (!hoverTooltip?.matches(':hover')) {
            removeHoverTooltip();
        }
    }, 300);

    currentHoverElement = null;
}

function findTranslatableParent(element) {
    // 向上查找可翻譯的父元素
    const translatableTags = ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'TD', 'TH', 'BLOCKQUOTE', 'FIGCAPTION', 'SPAN', 'DIV'];

    let current = element;
    while (current && current !== document.body) {
        // 跳過我們自己的元素
        if (current.classList?.contains('tg-translation-container') ||
            current.classList?.contains('tg-hover-tooltip') ||
            current.classList?.contains('tg-selection-popup')) {
            return null;
        }

        // 跳過廣告和腳本區塊
        if (current.closest(EXCLUDE_SELECTORS)) {
            return null;
        }

        if (translatableTags.includes(current.tagName) ||
            current.hasAttribute('data-testid') ||  // Twitter
            current.hasAttribute('slot') ||         // Reddit
            current.hasAttribute('lang')) {         // 有語言標記的元素
            const text = current.textContent.trim();
            // 確保有足夠的文字且不是目標語言
            if (text.length >= 10 && text.length <= 2000) {
                // 跳過看起來像代碼的內容
                if (isCodeLikeContent(text)) {
                    return null;
                }

                const lang = detectLanguage(text);
                if (lang !== settings.targetLang.split('-')[0]) {
                    return current;
                }
            }
        }
        current = current.parentElement;
    }
    return null;
}

async function showHoverTranslation(element) {
    const text = element.textContent.trim();
    if (!text) return;

    // 檢查快取
    const cacheKey = `hover:${settings.targetLang}:${text.substring(0, 100)}`;
    let translation = translationCache.get(cacheKey);

    if (!translation) {
        // 顯示載入中
        showHoverTooltip(element, '翻譯中...', true);

        try {
            const response = await chrome.runtime.sendMessage({
                action: 'translate',
                text: text.substring(0, 1000), // 限制長度
                sourceLang: detectLanguage(text),
                targetLang: settings.targetLang
            });

            if (response?.success && response.translation) {
                translation = response.translation;
                translationCache.set(cacheKey, translation);
            } else {
                removeHoverTooltip();
                return;
            }
        } catch (e) {
            console.error('懸停翻譯失敗:', e);
            removeHoverTooltip();
            return;
        }
    }

    // 顯示翻譯結果
    showHoverTooltip(element, translation, false);
}

function showHoverTooltip(element, content, isLoading) {
    removeHoverTooltip();

    const rect = element.getBoundingClientRect();

    hoverTooltip = document.createElement('div');
    hoverTooltip.className = 'tg-hover-tooltip';
    hoverTooltip.id = 'tg-hover-tooltip';

    if (isLoading) {
        hoverTooltip.innerHTML = `<div class="tg-hover-loading">⏳ ${content}</div>`;
    } else {
        hoverTooltip.innerHTML = `
            <div class="tg-hover-header">
                <span>🌐 TranslateGemma</span>
                <button class="tg-hover-close" onclick="this.parentElement.parentElement.remove()">✕</button>
            </div>
            <div class="tg-hover-content">${content}</div>
        `;
    }

    // 計算位置（在元素下方）
    let top = rect.bottom + window.scrollY + 8;
    let left = rect.left + window.scrollX;

    // 確保不超出視窗
    const maxLeft = window.innerWidth - 360;
    if (left > maxLeft) left = maxLeft;
    if (left < 10) left = 10;

    hoverTooltip.style.cssText = `
        position: absolute;
        top: ${top}px;
        left: ${left}px;
        z-index: 2147483646;
    `;

    document.body.appendChild(hoverTooltip);

    // 監聽 tooltip 的滑鼠離開事件
    hoverTooltip.addEventListener('mouseleave', () => {
        setTimeout(removeHoverTooltip, 200);
    });
}

function removeHoverTooltip() {
    if (hoverTooltip) {
        hoverTooltip.remove();
        hoverTooltip = null;
    }
    const existing = document.getElementById('tg-hover-tooltip');
    if (existing) existing.remove();
}

// 啟動
init();

