/**
 * TranslateGemma Reddit 翻譯模組
 * 支援帖子標題、內文、留言翻譯
 * Reddit 新版 UI 使用 Web Components (shreddit-post, shreddit-comment)
 * 列表頁標題: a[slot="full-post-link"]
 * 帖子內頁標題: h1[slot="title"]
 * 留言: shreddit-comment [slot="comment"] p
 */

// ============== 設定 ==============
let settings = {
    targetLang: 'zh-TW',
    redditEnabled: true,
    minChars: 30,
    translationMode: 'balanced',
    customGlossary: '',
    displayMode: 'dual'
};

const MAX_CONCURRENT = 1;
const BATCH_SIZE = 4;
let activeRequests = 0;
const pendingQueue = [];
let observer = null;
let debounceTimer = null;
let progressState = {
    site: 'reddit',
    label: 'Reddit 翻譯',
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
        site: 'reddit',
        label: 'Reddit 翻譯',
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
        detail: pending === 0 ? '目前頁面已翻譯完成' : `剩餘 ${pending} 段待翻譯`
    });
}

/**
 * 判斷是否在帖子內頁（CommentsPage）
 * 列表頁只翻譯標題，內頁翻譯全部
 */
function isDetailPage() {
    // 方法1: 檢查 shreddit-post 的 view-context 屬性
    const post = document.querySelector('shreddit-post[view-context="CommentsPage"]');
    if (post) return true;
    // 方法2: URL 包含 /comments/
    return /\/comments\//.test(location.pathname);
}

// ============== 初始化 ==============
async function init() {
    console.log('🔴 TranslateGemma Reddit 模組已載入');

    // 載入設定
    try {
        const response = await chrome.runtime.sendMessage({ action: 'getSettings' });
        if (response) {
            settings = { ...settings, ...response };
            window.TranslateGemmaDisplay?.apply(settings.displayMode);
        }
    } catch (e) {
        console.warn('⚠️ 設定載入失敗:', e);
    }

    if (!settings.redditEnabled) {
        console.log('🔴 Reddit 翻譯已停用');
        clearProgress();
        return;
    }

    // 初始翻譯（等 DOM 穩定）
    setTimeout(() => startTranslation(), 2000);

    // 監聽 SPA 動態載入
    setupMutationObserver();

    // 監聽設定更新
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'updateSettings') {
            settings = { ...settings, ...request.settings };
            window.TranslateGemmaDisplay?.apply(settings.displayMode);
            if (settings.redditEnabled) {
                startTranslation();
            } else {
                clearProgress();
            }
            sendResponse({ success: true });
        }
    });
}

// ============== DOM 選取器 ==============

/**
 * 取得帖子標題元素
 * 列表頁: a[slot="full-post-link"] 或 [slot="title"]
 * 內頁: h1[slot="title"]
 */
function getPostTitles() {
    const titles = [];
    const seen = new Set();

    document.querySelectorAll('shreddit-post').forEach(post => {
        // 內頁：h1[slot="title"]
        // 列表頁：a[slot="full-post-link"] 或 [slot="title"]
        const titleEl = post.querySelector('h1[slot="title"], a[slot="full-post-link"], [slot="title"]');
        if (titleEl && !titleEl.dataset.tgTranslated && !seen.has(titleEl)) {
            const text = titleEl.textContent.trim();
            if (text.length >= 10 && !isChinese(text)) {
                titles.push({ el: titleEl, type: 'title' });
                seen.add(titleEl);
            }
        }
    });

    return titles;
}

/**
 * 取得帖子內文段落
 * 使用 [slot="text-body"] 內的段落
 */
function getPostBodies() {
    const bodies = [];

    // shreddit-post 內的文字內容 (slot="text-body" 或 .md p)
    const selectors = [
        'shreddit-post [slot="text-body"] p',
        'shreddit-post .md p',
        'shreddit-post-text-body p'
    ];

    selectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(p => {
            if (!p.dataset.tgTranslated) {
                const text = p.textContent.trim();
                if (text.length >= settings.minChars && !isChinese(text)) {
                    // 避免重複加入
                    if (!bodies.some(b => b.el === p)) {
                        bodies.push({ el: p, type: 'paragraph' });
                    }
                }
            }
        });
    });

    return bodies;
}

/**
 * 取得留言元素
 * 留言內容在 shreddit-comment [slot="comment"] p
 */
function getComments() {
    const comments = [];

    // shreddit-comment 的留言內文 (slot="comment" 內的段落)
    const selectors = [
        'shreddit-comment [slot="comment"] p',
        'shreddit-comment .md p'
    ];

    selectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(p => {
            if (!p.dataset.tgTranslated) {
                const text = p.textContent.trim();
                if (text.length >= settings.minChars && !isChinese(text)) {
                    if (!comments.some(c => c.el === p)) {
                        comments.push({ el: p, type: 'comment' });
                    }
                }
            }
        });
    });

    return comments;
}

// ============== 翻譯功能 ==============

function startTranslation() {
    if (!settings.redditEnabled) return;

    const onDetail = isDetailPage();
    const titles = getPostTitles();
    // 列表頁只翻譯標題，避免在截斷容器內插入內容導致重疊
    const bodies = onDetail ? getPostBodies() : [];
    const comments = onDetail ? getComments() : [];
    const all = [...titles, ...bodies, ...comments];

    if (all.length === 0) {
        clearProgress();
        return;
    }

    console.log(`🔴 Reddit [${onDetail ? '內頁' : '列表'}] 找到 ${all.length} 個可翻譯元素 (標題:${titles.length}, 內文:${bodies.length}, 留言:${comments.length})`);
    reportProgress({
        status: 'queued',
        total: all.length,
        completed: 0,
        failed: 0,
        pending: all.length,
        detail: onDetail ? '帖子與留言待翻譯中' : '帖子標題待翻譯中'
    });

    // 加入佇列
    all.forEach(item => {
        if (!pendingQueue.some(q => q.el === item.el)) {
            pendingQueue.push(item);
        }
    });

    processQueue();
}

function processQueue() {
    while (activeRequests < MAX_CONCURRENT && pendingQueue.length > 0) {
        const tasks = pendingQueue.splice(0, BATCH_SIZE);
        activeRequests++;
        translateBatch(tasks);
    }
}

function createLoader(el) {
    const loader = document.createElement('span');
    loader.textContent = ' ⏳';
    loader.style.cssText = 'opacity: 0.6; font-size: 0.9em;';
    el.appendChild(loader);
    return loader;
}

function insertTranslation(el, type, translation, text) {
    const transEl = document.createElement('div');
    const colors = getTranslationColors('#ff4500');

    if (type === 'title') {
        transEl.style.cssText = `display: block !important; color: ${colors.textColor} !important; font-size: 0.85em !important; font-weight: normal !important; margin-top: 4px !important; padding: 4px 8px !important; border-left: 3px solid ${colors.borderColor} !important; background: ${colors.bgColor} !important; border-radius: 0 4px 4px 0 !important; line-height: 1.5 !important; clear: both !important; position: relative !important;`;
    } else {
        transEl.style.cssText = `display: block !important; color: ${colors.textColor} !important; font-size: 0.95em !important; margin-top: 6px !important; margin-bottom: 8px !important; padding: 8px 12px !important; border-left: 3px solid ${colors.borderColor} !important; background: ${colors.bgColor} !important; line-height: 1.6 !important; border-radius: 0 4px 4px 0 !important; clear: both !important; position: relative !important;`;
    }

    window.TranslateGemmaDisplay?.markOriginal(el);
    window.TranslateGemmaDisplay?.markTranslation(transEl);
    transEl.textContent = translation;
    el.parentNode.insertBefore(transEl, el.nextSibling);
    el.dataset.tgTranslated = 'done';
    console.log(`✅ Reddit 翻譯完成: ${text.substring(0, 30)}...`);
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
                site: 'reddit',
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
            console.warn('❌ Reddit 批次翻譯失敗:', response?.error);
        }
    } catch (error) {
        batch.forEach((item) => {
            item.loader.remove();
            item.el.dataset.tgTranslated = '';
        });
        applyBatchProgress(0, batch.length);
        console.error('❌ Reddit 批次翻譯錯誤:', error);
    } finally {
        activeRequests--;
        processQueue();
    }
}

// ============== 動態載入監聽 ==============

function setupMutationObserver() {
    // 防抖翻譯：任何 DOM 變動後 800ms 才翻譯
    function debouncedTranslate() {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            if (settings.redditEnabled) {
                startTranslation();
            }
        }, 800);
    }

    observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.addedNodes.length > 0) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        // 偵測任何可能包含新內容的元素
                        if (node.tagName === 'SHREDDIT-POST' ||
                            node.tagName === 'SHREDDIT-COMMENT' ||
                            node.tagName === 'SHREDDIT-POST-TEXT-BODY' ||
                            node.querySelector?.('shreddit-post, shreddit-comment, .md, [slot="comment"], [slot="text-body"]')) {
                            debouncedTranslate();
                            return;
                        }
                        // SPA 導航：偵測大型容器更新
                        if (node.id === 'main-content' ||
                            node.id === 'comment-tree' ||
                            node.tagName === 'MAIN' ||
                            node.getAttribute?.('slot') === 'comment') {
                            debouncedTranslate();
                            return;
                        }
                    }
                }
            }
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    // 監聽 URL 變化（SPA 路由切換）
    let lastUrl = location.href;
    const urlObserver = new MutationObserver(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            console.log('🔴 Reddit URL 變化:', lastUrl);
            // URL 變化時重新掃描
            setTimeout(() => startTranslation(), 1500);
        }
    });
    urlObserver.observe(document.querySelector('head > title') || document.head, {
        childList: true,
        subtree: true,
        characterData: true
    });
}

// 啟動
init();
