/**
 * TranslateGemma GitHub Translation Module v1.0
 * GitHub 專用沉浸式翻譯 - README, Issue, PR
 */

// ============== 設定 ==============
let settings = {
    githubEnabled: true,
    targetLang: 'zh-TW',
    minChars: 30
};

// 並行控制
const MAX_CONCURRENT = 2;
let activeRequests = 0;
const pendingQueue = [];

// ============== GitHub 專用偵測 ==============

/**
 * 取得 README 內容區域
 */
function getContentAreas() {
    const areas = [];

    // README.md 內容
    const readme = document.querySelector('article.markdown-body');
    if (readme) areas.push(readme);

    // Issue/PR 內容
    const issueBody = document.querySelector('.js-comment-body');
    if (issueBody) areas.push(issueBody);

    // PR description
    const prDesc = document.querySelectorAll('.comment-body.markdown-body');
    prDesc.forEach(el => areas.push(el));

    return areas;
}

/**
 * 判斷是否為排除區域
 */
function isExcluded(el) {
    const excludedSelectors = [
        'pre',           // 程式碼區塊
        'code',          // 行內程式碼
        '.highlight',    // 語法高亮
        '.zeroclipboard-container', // 複製按鈕
        '.anchor',       // 錨點連結
        'nav',           // 導航
        '.file-navigation', // 檔案導航
        '.Box-header'    // 區塊標題
    ];

    for (const selector of excludedSelectors) {
        if (el.closest(selector)) return true;
    }

    return false;
}

/**
 * 收集可翻譯元素
 */
function collectElements() {
    const elements = [];
    const contentAreas = getContentAreas();

    if (contentAreas.length === 0) {
        console.log('🐙 找不到 GitHub 內容區域');
        return elements;
    }

    console.log(`🐙 找到 ${contentAreas.length} 個內容區域`);

    contentAreas.forEach(area => {
        // 段落
        const paragraphs = area.querySelectorAll('p');
        paragraphs.forEach(p => {
            if (!p.dataset.tgTranslated && !isExcluded(p)) {
                const text = p.textContent.trim();
                if (text.length >= settings.minChars) {
                    elements.push({ el: p, type: 'paragraph' });
                }
            }
        });

        // 標題 (h1-h3)
        const headings = area.querySelectorAll('h1, h2, h3');
        headings.forEach(h => {
            if (!h.dataset.tgTranslated && !isExcluded(h)) {
                const text = h.textContent.trim();
                if (text.length >= 3) {
                    elements.push({ el: h, type: 'heading' });
                }
            }
        });

        // 列表項目 (只翻譯長的)
        const listItems = area.querySelectorAll('li');
        listItems.forEach(li => {
            if (!li.dataset.tgTranslated && !isExcluded(li)) {
                const text = li.textContent.trim();
                if (text.length >= 50) {
                    elements.push({ el: li, type: 'list' });
                }
            }
        });
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
    loader.className = 'tg-github-loader';
    loader.textContent = ' ⏳';
    loader.style.cssText = 'opacity: 0.6;';
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

            // GitHub 風格樣式 - 使用綠色主題
            if (type === 'heading') {
                transEl.style.cssText = 'color: #333 !important; font-size: 0.75em !important; font-weight: normal !important; margin-top: 6px !important; padding: 6px 10px !important; border-left: 3px solid #238636 !important; background: rgba(35, 134, 54, 0.08) !important; border-radius: 0 4px 4px 0 !important;';
            } else {
                transEl.style.cssText = 'color: #333 !important; font-size: 0.9em !important; margin-top: 8px !important; margin-bottom: 12px !important; padding: 10px 14px !important; border-left: 3px solid #238636 !important; background: rgba(35, 134, 54, 0.08) !important; line-height: 1.6 !important; border-radius: 0 4px 4px 0 !important;';
            }

            transEl.textContent = response.translation;
            el.parentNode.insertBefore(transEl, el.nextSibling);
            el.dataset.tgTranslated = 'done';

            console.log(`✅ GitHub 翻譯完成: ${text.substring(0, 30)}...`);
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
    console.log('🐙 TranslateGemma GitHub 模組已載入');

    // 載入設定
    try {
        const response = await chrome.runtime.sendMessage({ action: 'getSettings' });
        settings = { ...settings, ...response };
    } catch (e) {
        // 使用預設值
    }

    if (!settings.githubEnabled) {
        console.log('🐙 GitHub 翻譯已停用');
        return;
    }

    // 收集元素
    const elements = collectElements();
    if (elements.length === 0) {
        console.log('🐙 未找到可翻譯內容');
        return;
    }

    console.log(`🐙 找到 ${elements.length} 個可翻譯元素`);
    setupObserver(elements);
}

// ============== 訊息監聯 ==============

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'updateSettings') {
        settings = { ...settings, ...request.settings };
        sendResponse({ success: true });
    }
});

// 延遲啟動 (等待 GitHub SPA 載入完成)
setTimeout(init, 1000);
