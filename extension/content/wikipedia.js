/**
 * TranslateGemma Wikipedia Translation Module v1.0
 * Wikipedia 專用沉浸式翻譯
 */

// ============== 設定 ==============
let settings = {
    wikipediaEnabled: true,
    targetLang: 'zh-TW',
    minChars: 50,
    translationMode: 'balanced',
    customGlossary: '',
    displayMode: 'dual'
};

// 並行控制
const MAX_CONCURRENT = 1;
const BATCH_SIZE = 4;
let activeRequests = 0;
const pendingQueue = [];
let progressState = {
    site: 'wikipedia',
    label: 'Wikipedia 翻譯',
    status: 'idle',
    total: 0,
    completed: 0,
    failed: 0,
    pending: 0,
    detail: ''
};

function parseGlossary() {
    return String(settings.customGlossary || '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);
}

function reportProgress(patch = {}) {
    progressState = { ...progressState, ...patch };
    chrome.runtime.sendMessage({
        action: 'updatePageProgress',
        progress: progressState
    }, () => {
        void chrome.runtime.lastError;
    });
}

function clearProgress() {
    progressState = {
        site: 'wikipedia',
        label: 'Wikipedia 翻譯',
        status: 'idle',
        total: 0,
        completed: 0,
        failed: 0,
        pending: 0,
        detail: ''
    };
    chrome.runtime.sendMessage({ action: 'clearPageProgress' }, () => {
        void chrome.runtime.lastError;
    });
}

function applyBatchProgress(completedDelta, failedDelta) {
    const completed = progressState.completed + completedDelta;
    const failed = progressState.failed + failedDelta;
    const pending = Math.max(0, progressState.total - completed - failed);
    reportProgress({
        completed,
        failed,
        pending,
        status: pending === 0 ? 'complete' : 'running',
        detail: pending === 0 ? 'Wikipedia 頁面翻譯完成' : `剩餘 ${pending} 段待翻譯`
    });
}

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
    if (title && !title.dataset.tgTranslated && !isChinese(title.textContent.trim())) {
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

        if (!p.dataset.tgTranslated && !excluded && text.length >= settings.minChars && !isChinese(text)) {
            elements.push({ el: p, type: 'paragraph' });
        }
    });

    // 章節標題 (h2, h3)
    const headings = contentArea.querySelectorAll('h2 .mw-headline, h3 .mw-headline');
    headings.forEach(h => {
        if (!h.dataset.tgTranslated && !isExcluded(h)) {
            const text = h.textContent.trim();
            if (text.length >= 2 && !isChinese(text)) {
                elements.push({ el: h, type: 'heading' });
            }
        }
    });

    return elements;
}

// ============== 翻譯功能 ==============

function processQueue() {
    while (activeRequests < MAX_CONCURRENT && pendingQueue.length > 0) {
        const tasks = pendingQueue.splice(0, BATCH_SIZE);
        activeRequests++;
        translateBatch(tasks);
    }
}

function createLoader(el) {
    const loader = document.createElement('span');
    loader.className = 'tg-wiki-loader';
    loader.textContent = ' ⏳';
    el.appendChild(loader);
    return loader;
}

function insertTranslation(el, type, translation, text) {
    const transEl = document.createElement('div');
    const colors = getTranslationColors('#3366cc');

    if (type === 'title') {
        transEl.style.cssText = `color: ${colors.textColor} !important; font-size: 0.7em !important; font-weight: normal !important; margin-top: 8px !important; padding: 8px 12px !important; border-left: 3px solid ${colors.borderColor} !important; background: ${colors.bgColor} !important; border-radius: 0 4px 4px 0 !important;`;
    } else if (type === 'heading') {
        transEl.style.cssText = `color: ${colors.textColor} !important; font-size: 0.85em !important; font-weight: normal !important; margin-top: 4px !important; padding: 4px 8px !important; border-left: 2px solid ${colors.borderColor} !important; background: ${colors.bgColor} !important; display: inline-block !important;`;
    } else {
        transEl.style.cssText = `color: ${colors.textColor} !important; font-size: 0.95em !important; margin-top: 8px !important; margin-bottom: 12px !important; padding: 10px 14px !important; border-left: 3px solid ${colors.borderColor} !important; background: ${colors.bgColor} !important; line-height: 1.7 !important; border-radius: 0 4px 4px 0 !important;`;
    }

    window.TranslateGemmaDisplay?.markOriginal(el);
    window.TranslateGemmaDisplay?.markTranslation(transEl);
    transEl.textContent = translation;
    el.parentNode.insertBefore(transEl, el.nextSibling);
    el.dataset.tgTranslated = 'done';
    console.log(`✅ Wikipedia 翻譯完成: ${text.substring(0, 30)}...`);
}

async function translateBatch(tasks) {
    const batch = [];

    tasks.forEach(({ el, type }) => {
        if (el.dataset.tgTranslated) return;

        const text = el.textContent.trim();
        if (!text || isChinese(text)) return;

        el.dataset.tgTranslated = 'pending';
        batch.push({ el, type, text, loader: createLoader(el) });
    });

    if (batch.length === 0) {
        activeRequests--;
        processQueue();
        return;
    }

    try {
        const response = await chrome.runtime.sendMessage({
            action: 'translateBatch',
            texts: batch.map(item => item.text),
            sourceLang: 'auto',
            targetLang: settings.targetLang,
            options: {
                site: 'wikipedia',
                contentTypes: batch.map(item => item.type),
                translationMode: settings.translationMode,
                glossary: parseGlossary()
            }
        });

        let completedCount = 0;
        let failedCount = 0;
        batch.forEach((item, index) => {
            item.loader.remove();
            const translation = response?.success ? response.translations?.[index] : null;
            if (translation) {
                insertTranslation(item.el, item.type, translation, item.text);
                completedCount++;
            } else {
                item.el.dataset.tgTranslated = '';
                failedCount++;
            }
        });

        applyBatchProgress(completedCount, failedCount);

        if (!response?.success) {
            console.warn('❌ 批次翻譯失敗:', response?.error);
        }
    } catch (error) {
        batch.forEach((item) => {
            item.loader.remove();
            item.el.dataset.tgTranslated = '';
        });
        applyBatchProgress(0, batch.length);
        console.error('❌ 批次翻譯錯誤:', error);
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
        window.TranslateGemmaDisplay?.apply(settings.displayMode);
    } catch (e) {
        // 使用預設值
    }

    if (!settings.wikipediaEnabled) {
        console.log('📚 Wikipedia 翻譯已停用');
        clearProgress();
        return;
    }

    // 收集元素
    const elements = collectElements();
    if (elements.length === 0) {
        console.log('📚 未找到可翻譯內容');
        clearProgress();
        return;
    }

    console.log(`📚 找到 ${elements.length} 個可翻譯元素`);
    reportProgress({
        status: 'queued',
        total: elements.length,
        completed: 0,
        failed: 0,
        pending: elements.length,
        detail: `待翻譯 ${elements.length} 段條目內容`
    });
    setupObserver(elements);
}

// ============== 訊息監聽 ==============

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'updateSettings') {
        settings = { ...settings, ...request.settings };
        window.TranslateGemmaDisplay?.apply(settings.displayMode);
        if (!settings.wikipediaEnabled) {
            clearProgress();
        }
        sendResponse({ success: true });
    }
});

// 延遲啟動
setTimeout(init, 800);
