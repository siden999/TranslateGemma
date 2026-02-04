/**
 * TranslateGemma Article Translation Module v1.0
 * 沉浸式文章翻譯 - 適用於新聞/文章網站
 */

// ============== 設定 ==============
let settings = {
    articleEnabled: true,
    targetLang: 'zh-TW',
    minChars: 50  // 最小字數門檻
};

// 並行控制
const MAX_CONCURRENT = 2;
let activeRequests = 0;
const pendingQueue = [];

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
            if (text.length >= 10) {  // 標題門檻較低
                elements.push({ el: h, type: 'heading' });
            }
        }
    });

    // 收集段落
    const paragraphs = contentArea.querySelectorAll('p');
    paragraphs.forEach(p => {
        if (!p.dataset.tgTranslated && !isInExcludedArea(p)) {
            const text = p.textContent.trim();
            if (text.length >= settings.minChars) {
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
        const task = pendingQueue.shift();
        translateElement(task.el, task.type);
    }
}

/**
 * 翻譯單一元素
 */
async function translateElement(el, type) {
    if (el.dataset.tgTranslated) return;

    const text = el.textContent.trim();
    if (!text) return;

    // 標記為處理中
    el.dataset.tgTranslated = 'pending';
    activeRequests++;

    // 加入載入指示器
    const loader = document.createElement('span');
    loader.className = 'tg-article-loader';
    loader.textContent = ' ⏳';
    el.appendChild(loader);

    try {
        const response = await chrome.runtime.sendMessage({
            action: 'translate',
            text: text,
            sourceLang: 'en',
            targetLang: settings.targetLang
        });

        // 移除載入指示器
        loader.remove();

        if (response?.success && response.translation) {
            // 建立翻譯元素
            const transEl = document.createElement('div');
            transEl.className = type === 'heading' ? 'tg-article-title-trans' : 'tg-article-trans';
            transEl.textContent = response.translation;

            // 插入到原文後面
            el.parentNode.insertBefore(transEl, el.nextSibling);
            el.dataset.tgTranslated = 'done';

            console.log(`✅ 翻譯完成: ${text.substring(0, 30)}...`);
        } else {
            el.dataset.tgTranslated = '';  // 重置，允許重試
            console.warn('❌ 翻譯失敗:', response?.error);
        }
    } catch (error) {
        loader.remove();
        el.dataset.tgTranslated = '';
        console.error('❌ 翻譯錯誤:', error);
    } finally {
        activeRequests--;
        processQueue();  // 處理下一個
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
    } catch (e) {
        // 使用預設值
    }

    // 檢查是否啟用
    if (!settings.articleEnabled) {
        console.log('📰 文章翻譯已停用');
        return;
    }

    // 尋找文章區域
    const contentArea = findContentArea();
    if (!contentArea) {
        console.log('📰 未偵測到文章區域，不執行翻譯');
        return;
    }

    // 收集可翻譯元素
    const elements = collectTranslatableElements(contentArea);
    if (elements.length === 0) {
        console.log('📰 未找到符合條件的內容');
        return;
    }

    console.log(`📰 找到 ${elements.length} 個可翻譯元素`);

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
        .tg-article-trans {
            color: #666;
            font-size: 0.95em;
            margin-top: 8px;
            margin-bottom: 16px;
            padding: 10px 14px;
            border-left: 3px solid #3ea6ff;
            background: rgba(62, 166, 255, 0.08);
            line-height: 1.7;
            border-radius: 0 4px 4px 0;
        }
        .tg-article-title-trans {
            color: #555;
            font-size: 0.8em;
            font-weight: normal;
            margin-top: 6px;
            margin-bottom: 12px;
            padding: 6px 10px;
            border-left: 3px solid #3ea6ff;
            background: rgba(62, 166, 255, 0.05);
        }
        .tg-article-loader {
            display: inline;
            animation: tg-pulse 1s infinite;
        }
        @keyframes tg-pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }

        /* 深色模式支援 */
        @media (prefers-color-scheme: dark) {
            .tg-article-trans {
                color: #bbb;
                background: rgba(62, 166, 255, 0.12);
            }
            .tg-article-title-trans {
                color: #aaa;
                background: rgba(62, 166, 255, 0.08);
            }
        }
    `;
    document.head.appendChild(style);
}

// ============== 訊息監聽 ==============

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'updateSettings') {
        settings = { ...settings, ...request.settings };
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
