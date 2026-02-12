/**
 * TranslateGemma Wikipedia Translation Module v1.0
 * Wikipedia 專用沉浸式翻譯
 */

// ============== 設定 ==============
let settings = {
    wikipediaEnabled: true,
    targetLang: 'zh-TW',
    minChars: 50
};

// 並行控制
const MAX_CONCURRENT = 2;
let activeRequests = 0;
const pendingQueue = [];

// ============== Wikipedia 專用偵測 ==============

/**
 * 取得 Wikipedia 內容區域
 */
function getContentArea() {
    return document.querySelector('#mw-content-text .mw-parser-output');
}

/**
 * 取得頁面標題
 */
function getPageTitle() {
    return document.querySelector('#firstHeading');
}

/**
 * 判斷是否為排除區域
 */
function isExcluded(el) {
    // Wikipedia 特有的排除區域 - 使用更精準的 class 名稱
    const excludedSelectors = [
        '.infobox',
        '.navbox',
        '.sidebar',
        '.toc',
        '.mw-editsection',
        '.reflist',
        '.thumb',
        '.metadata',
        '.noprint',
        '.hatnote',  // "此條目..."說明
        '.mw-empty-elt'  // 空元素
    ];

    // 檢查元素本身和父元素是否匹配排除選擇器
    for (const selector of excludedSelectors) {
        if (el.closest(selector)) {
            return true;
        }
    }

    // 如果在表格內，排除
    if (el.closest('table')) {
        return true;
    }

    return false;
}

/**
 * 收集可翻譯元素
 */
function collectElements() {
    const elements = [];

    // 嘗試多個選擇器找內容區域
    let contentArea = document.querySelector('#mw-content-text .mw-parser-output');
    if (!contentArea) {
        contentArea = document.querySelector('#mw-content-text');
    }
    if (!contentArea) {
        contentArea = document.querySelector('#bodyContent');
    }

    if (!contentArea) {
        console.log('📚 找不到 Wikipedia 內容區域');
        return elements;
    }

    console.log('📚 找到內容區域:', contentArea.className || contentArea.id);

    // 標題
    const title = getPageTitle();
    if (title && !title.dataset.tgTranslated) {
        elements.push({ el: title, type: 'title' });
    }

    // 段落 - 直接用更簡單的選擇器
    const paragraphs = contentArea.querySelectorAll('p');
    console.log(`📚 找到 ${paragraphs.length} 個段落標籤`);

    paragraphs.forEach((p, index) => {
        const text = p.textContent.trim();
        const excluded = isExcluded(p);

        // 只對前5個段落輸出 debug
        if (index < 5) {
            console.log(`📚 段落 ${index}: 長度=${text.length}, 排除=${excluded}`);
        }

        if (!p.dataset.tgTranslated && !excluded && text.length >= settings.minChars) {
            elements.push({ el: p, type: 'paragraph' });
        }
    });

    // 章節標題 (h2, h3)
    const headings = contentArea.querySelectorAll('h2 .mw-headline, h3 .mw-headline');
    headings.forEach(h => {
        if (!h.dataset.tgTranslated && !isExcluded(h)) {
            const text = h.textContent.trim();
            if (text.length >= 2) {
                elements.push({ el: h, type: 'heading' });
            }
        }
    });

    return elements;
}

// ============== 翻譯功能 ==============

function processQueue() {
    while (activeRequests < MAX_CONCURRENT && pendingQueue.length > 0) {
        const task = pendingQueue.shift();
        translateElement(task.el, task.type);
    }
}

async function translateElement(el, type) {
    if (el.dataset.tgTranslated) return;

    const text = el.textContent.trim();
    if (!text) return;

    el.dataset.tgTranslated = 'pending';
    activeRequests++;

    // 載入指示器
    const loader = document.createElement('span');
    loader.className = 'tg-wiki-loader';
    loader.textContent = ' ⏳';
    el.appendChild(loader);

    try {
        const response = await chrome.runtime.sendMessage({
            action: 'translate',
            text: text,
            sourceLang: 'auto',
            targetLang: settings.targetLang
        });

        loader.remove();

        if (response?.success && response.translation) {
            const transEl = document.createElement('div');
            const colors = getTranslationColors('#3366cc');

            // 根據類型設定樣式（自動適配深色模式）
            if (type === 'title') {
                transEl.style.cssText = `color: ${colors.textColor} !important; font-size: 0.7em !important; font-weight: normal !important; margin-top: 8px !important; padding: 8px 12px !important; border-left: 3px solid ${colors.borderColor} !important; background: ${colors.bgColor} !important; border-radius: 0 4px 4px 0 !important;`;
            } else if (type === 'heading') {
                transEl.style.cssText = `color: ${colors.textColor} !important; font-size: 0.85em !important; font-weight: normal !important; margin-top: 4px !important; padding: 4px 8px !important; border-left: 2px solid ${colors.borderColor} !important; background: ${colors.bgColor} !important; display: inline-block !important;`;
            } else {
                transEl.style.cssText = `color: ${colors.textColor} !important; font-size: 0.95em !important; margin-top: 8px !important; margin-bottom: 12px !important; padding: 10px 14px !important; border-left: 3px solid ${colors.borderColor} !important; background: ${colors.bgColor} !important; line-height: 1.7 !important; border-radius: 0 4px 4px 0 !important;`;
            }

            transEl.textContent = response.translation;
            el.parentNode.insertBefore(transEl, el.nextSibling);
            el.dataset.tgTranslated = 'done';

            console.log(`✅ Wikipedia 翻譯完成: ${text.substring(0, 30)}...`);
        } else {
            el.dataset.tgTranslated = '';
            console.warn('❌ 翻譯失敗:', response?.error);
        }
    } catch (error) {
        loader.remove();
        el.dataset.tgTranslated = '';
        console.error('❌ 翻譯錯誤:', error);
    } finally {
        activeRequests--;
        processQueue();
    }
}

function queueTranslation(el, type) {
    if (el.dataset.tgTranslated) return;
    pendingQueue.push({ el, type });
    processQueue();
}

// ============== 觀察器 ==============

function setupObserver(elements) {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const el = entry.target;
                const type = el.dataset.tgType;
                queueTranslation(el, type);
                observer.unobserve(el);
            }
        });
    }, { rootMargin: '100px' });

    elements.forEach(({ el, type }) => {
        el.dataset.tgType = type;
        observer.observe(el);
    });

    return observer;
}

// ============== 初始化 ==============

async function init() {
    console.log('📚 TranslateGemma Wikipedia 模組已載入');

    // 載入設定
    try {
        const response = await chrome.runtime.sendMessage({ action: 'getSettings' });
        settings = { ...settings, ...response };
    } catch (e) {
        // 使用預設值
    }

    if (!settings.wikipediaEnabled) {
        console.log('📚 Wikipedia 翻譯已停用');
        return;
    }

    // 收集元素
    const elements = collectElements();
    if (elements.length === 0) {
        console.log('📚 未找到可翻譯內容');
        return;
    }

    console.log(`📚 找到 ${elements.length} 個可翻譯元素`);
    setupObserver(elements);
}

// ============== 訊息監聽 ==============

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'updateSettings') {
        settings = { ...settings, ...request.settings };
        sendResponse({ success: true });
    }
});

// 延遲啟動
setTimeout(init, 800);
