/**
 * TranslateGemma Article Translation Module v1.0
 * 沉浸式文章翻譯 - 適用於新聞/文章網站
 */

// ============== 設定 ==============
let settings = {
    articleEnabled: true,
    targetLang: 'zh-TW',
    minChars: 50,  // 最小字數門檻
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
    site: 'article',
    label: '文章翻譯',
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
        site: 'article',
        label: '文章翻譯',
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
        detail: pending === 0 ? '本頁翻譯完成' : `剩餘 ${pending} 段待翻譯`
    });
}

// ============== 輔助函數 ==============

/**
 * 尋找文章主內容區域
 */
function findContentArea() {
    const selectors = [
        'article',
        'main',
        '[role="main"]',
        '.post-content',
        '.article-content',
        '.entry-content',
        '.story-body',
        '#content',
        '.content'
    ];

    for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (el) {
            console.log(`📰 找到文章區域: ${selector}`);
            return el;
        }
    }

    return null;
}

/**
 * 判斷元素是否在排除區域內
 */
function isInExcludedArea(el) {
    const excludedTags = ['NAV', 'ASIDE', 'FOOTER', 'HEADER'];
    const excludedClasses = ['sidebar', 'menu', 'navigation', 'footer', 'header', 'ad', 'advertisement'];

    let parent = el.parentElement;
    while (parent) {
        if (excludedTags.includes(parent.tagName)) return true;
        if (parent.className && typeof parent.className === 'string') {
            const classes = parent.className.toLowerCase();
            if (excludedClasses.some(c => classes.includes(c))) return true;
        }
        parent = parent.parentElement;
    }
    return false;
}

/**
 * 收集可翻譯的元素
 */
function collectTranslatableElements(contentArea) {
    const elements = [];

    // 收集標題
    const headings = contentArea.querySelectorAll('h1, h2');
    headings.forEach(h => {
        if (!h.dataset.tgTranslated && !isInExcludedArea(h)) {
            const text = h.textContent.trim();
            if (text.length >= 10 && !isChinese(text)) {  // 標題門檻較低
                elements.push({ el: h, type: 'heading' });
            }
        }
    });

    // 收集段落
    const paragraphs = contentArea.querySelectorAll('p');
    paragraphs.forEach(p => {
        if (!p.dataset.tgTranslated && !isInExcludedArea(p)) {
            const text = p.textContent.trim();
            if (text.length >= settings.minChars && !isChinese(text)) {
                elements.push({ el: p, type: 'paragraph' });
            }
        }
    });

    return elements;
}

// ============== 翻譯功能 ==============

/**
 * 處理翻譯佇列
 */
function processQueue() {
    while (activeRequests < MAX_CONCURRENT && pendingQueue.length > 0) {
        const tasks = pendingQueue.splice(0, BATCH_SIZE);
        activeRequests++;
        translateBatch(tasks);
    }
}

function createLoader(el) {
    const loader = document.createElement('span');
    loader.className = 'tg-article-loader';
    loader.textContent = ' ⏳';
    el.appendChild(loader);
    return loader;
}

function insertTranslation(el, type, translation, text) {
    const transEl = document.createElement('div');
    const colors = getTranslationColors('#3ea6ff');

    if (type === 'heading') {
        transEl.style.cssText = `color: ${colors.textColor} !important; font-size: 0.9em !important; font-weight: normal !important; margin-top: 6px !important; margin-bottom: 12px !important; padding: 6px 10px !important; border-left: 3px solid ${colors.borderColor} !important; background: ${colors.bgColor} !important; border-radius: 0 4px 4px 0 !important;`;
    } else {
        transEl.style.cssText = `color: ${colors.textColor} !important; font-size: 0.95em !important; margin-top: 8px !important; margin-bottom: 16px !important; padding: 10px 14px !important; border-left: 3px solid ${colors.borderColor} !important; background: ${colors.bgColor} !important; line-height: 1.7 !important; border-radius: 0 4px 4px 0 !important;`;
    }

    window.TranslateGemmaDisplay?.markOriginal(el);
    window.TranslateGemmaDisplay?.markTranslation(transEl);
    transEl.textContent = translation;
    el.parentNode.insertBefore(transEl, el.nextSibling);
    el.dataset.tgTranslated = 'done';
    console.log(`✅ 翻譯完成: ${text.substring(0, 30)}...`);
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
                site: 'article',
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

/**
 * 將元素加入翻譯佇列
 */
function queueTranslation(el, type) {
    if (el.dataset.tgTranslated) return;

    pendingQueue.push({ el, type });
    processQueue();
}

// ============== 觀察器 ==============

/**
 * 設置可視範圍觀察器
 */
function setupIntersectionObserver(elements) {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const el = entry.target;
                const type = el.dataset.tgType;
                queueTranslation(el, type);
                observer.unobserve(el);
            }
        });
    }, {
        rootMargin: '100px'  // 提前 100px 開始翻譯
    });

    elements.forEach(({ el, type }) => {
        el.dataset.tgType = type;
        observer.observe(el);
    });

    return observer;
}

// ============== 初始化 ==============

async function init() {
    console.log('📰 TranslateGemma 文章翻譯模組已載入');

    // 載入設定
    try {
        const response = await chrome.runtime.sendMessage({ action: 'getSettings' });
        settings = { ...settings, ...response };
        window.TranslateGemmaDisplay?.apply(settings.displayMode);
    } catch (e) {
        // 使用預設值
    }

    // 檢查是否啟用
    if (!settings.articleEnabled) {
        console.log('📰 文章翻譯已停用');
        clearProgress();
        return;
    }

    // 尋找文章區域
    const contentArea = findContentArea();
    if (!contentArea) {
        console.log('📰 未偵測到文章區域，不執行翻譯');
        clearProgress();
        return;
    }

    // 收集可翻譯元素
    const elements = collectTranslatableElements(contentArea);
    if (elements.length === 0) {
        console.log('📰 未找到符合條件的內容');
        clearProgress();
        return;
    }

    console.log(`📰 找到 ${elements.length} 個可翻譯元素`);
    reportProgress({
        status: 'queued',
        total: elements.length,
        completed: 0,
        failed: 0,
        pending: elements.length,
        detail: `待翻譯 ${elements.length} 段內容`
    });

    // 設置觀察器
    setupIntersectionObserver(elements);

    // 添加樣式
    addStyles();
}

/**
 * 添加翻譯樣式
 */
function addStyles() {
    if (document.getElementById('tg-article-style')) return;

    const style = document.createElement('style');
    style.id = 'tg-article-style';
    style.textContent = `
        .tg-article-loader {
            display: inline;
            animation: tg-pulse 1s infinite;
        }
        @keyframes tg-pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }
    `;
    document.head.appendChild(style);
}

// ============== 訊息監聽 ==============

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'updateSettings') {
        settings = { ...settings, ...request.settings };
        window.TranslateGemmaDisplay?.apply(settings.displayMode);
        if (!settings.articleEnabled) {
            clearProgress();
        }
        sendResponse({ success: true });
    }

    if (request.action === 'toggleArticleTranslation') {
        settings.articleEnabled = !settings.articleEnabled;
        if (settings.articleEnabled) {
            init();
        }
        sendResponse({ enabled: settings.articleEnabled });
    }
});

// 延遲啟動，確保頁面載入完成
setTimeout(init, 1000);
