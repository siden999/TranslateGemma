/**
 * TranslateGemma Reddit 翻譯模組
 * 支援帖子標題、內文、留言翻譯
 * Reddit 新版 UI 使用 Web Components (shreddit-post, shreddit-comment)
 */

// ============== 設定 ==============
let settings = {
    targetLang: 'zh-TW',
    redditEnabled: true,
    minChars: 30
};

const MAX_CONCURRENT = 3;
let activeRequests = 0;
const pendingQueue = [];
let observer = null;
let intersectionObserver = null;

// ============== 初始化 ==============
async function init() {
    console.log('🔴 TranslateGemma Reddit 模組已載入');

    // 載入設定
    try {
        const response = await chrome.runtime.sendMessage({ action: 'getSettings' });
        if (response) {
            settings = { ...settings, ...response };
        }
    } catch (e) {
        console.warn('⚠️ 設定載入失敗:', e);
    }

    if (!settings.redditEnabled) {
        console.log('🔴 Reddit 翻譯已停用');
        return;
    }

    // 初始翻譯
    setTimeout(() => startTranslation(), 2000);

    // 監聽 SPA 動態載入
    setupMutationObserver();

    // 監聽設定更新
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'updateSettings') {
            settings = { ...settings, ...request.settings };
            if (settings.redditEnabled) {
                startTranslation();
            }
            sendResponse({ success: true });
        }
    });
}

// ============== DOM 選取器 ==============

/**
 * 取得帖子標題元素
 */
function getPostTitles() {
    const titles = [];

    // 新版 shreddit-post 的標題
    document.querySelectorAll('shreddit-post').forEach(post => {
        // slot="title" 或 a[slot="title"]
        const titleEl = post.querySelector('a[slot="title"], [slot="title"]');
        if (titleEl && !titleEl.dataset.tgTranslated) {
            const text = titleEl.textContent.trim();
            if (text.length >= 10 && !isChinese(text)) {
                titles.push({ el: titleEl, type: 'title' });
            }
        }
    });

    // fallback: 如果有 post title links
    document.querySelectorAll('a[data-click-id="body"] h3, a.SQnoC3ObvgnGjWt90zD9Z').forEach(el => {
        if (!el.dataset.tgTranslated) {
            const text = el.textContent.trim();
            if (text.length >= 10 && !isChinese(text)) {
                titles.push({ el, type: 'title' });
            }
        }
    });

    return titles;
}

/**
 * 取得帖子內文段落
 */
function getPostBodies() {
    const bodies = [];

    // shreddit-post 內的 markdown 段落
    document.querySelectorAll('shreddit-post .md p, [data-click-id="text"] .md p').forEach(p => {
        if (!p.dataset.tgTranslated) {
            const text = p.textContent.trim();
            if (text.length >= settings.minChars && !isChinese(text)) {
                bodies.push({ el: p, type: 'paragraph' });
            }
        }
    });

    // 單篇帖子頁面的內文
    document.querySelectorAll('[data-test-id="post-content"] .md p, .Post .md p').forEach(p => {
        if (!p.dataset.tgTranslated) {
            const text = p.textContent.trim();
            if (text.length >= settings.minChars && !isChinese(text)) {
                bodies.push({ el: p, type: 'paragraph' });
            }
        }
    });

    return bodies;
}

/**
 * 取得留言元素
 */
function getComments() {
    const comments = [];

    // shreddit-comment 的留言內文
    document.querySelectorAll('shreddit-comment .md p').forEach(p => {
        if (!p.dataset.tgTranslated) {
            const text = p.textContent.trim();
            if (text.length >= settings.minChars && !isChinese(text)) {
                comments.push({ el: p, type: 'comment' });
            }
        }
    });

    // fallback: 舊版留言結構
    document.querySelectorAll('.Comment .md p, [data-testid="comment"] .md p').forEach(p => {
        if (!p.dataset.tgTranslated) {
            const text = p.textContent.trim();
            if (text.length >= settings.minChars && !isChinese(text)) {
                comments.push({ el: p, type: 'comment' });
            }
        }
    });

    return comments;
}

// ============== 翻譯功能 ==============

function startTranslation() {
    if (!settings.redditEnabled) return;

    const titles = getPostTitles();
    const bodies = getPostBodies();
    const comments = getComments();
    const all = [...titles, ...bodies, ...comments];

    console.log(`🔴 Reddit 找到 ${all.length} 個可翻譯元素 (標題:${titles.length}, 內文:${bodies.length}, 留言:${comments.length})`);

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
        const task = pendingQueue.shift();
        translateElement(task.el, task.type);
    }
}

async function translateElement(el, type) {
    if (el.dataset.tgTranslated) return;

    const text = el.textContent.trim();
    if (!text) return;
    if (isChinese(text)) return;

    el.dataset.tgTranslated = 'pending';
    activeRequests++;

    // 載入指示器
    const loader = document.createElement('span');
    loader.textContent = ' ⏳';
    loader.style.cssText = 'opacity: 0.6; font-size: 0.9em;';
    el.appendChild(loader);

    try {
        const response = await chrome.runtime.sendMessage({
            action: 'translate',
            text: text,
            sourceLang: 'en',
            targetLang: settings.targetLang
        });

        loader.remove();

        if (response?.success && response.translation) {
            const transEl = document.createElement('div');
            const colors = getTranslationColors('#ff4500'); // Reddit 橘色

            if (type === 'title') {
                transEl.style.cssText = `color: ${colors.textColor} !important; font-size: 0.85em !important; font-weight: normal !important; margin-top: 4px !important; padding: 4px 8px !important; border-left: 3px solid ${colors.borderColor} !important; background: ${colors.bgColor} !important; border-radius: 0 4px 4px 0 !important; line-height: 1.5 !important;`;
            } else {
                transEl.style.cssText = `color: ${colors.textColor} !important; font-size: 0.95em !important; margin-top: 6px !important; margin-bottom: 8px !important; padding: 8px 12px !important; border-left: 3px solid ${colors.borderColor} !important; background: ${colors.bgColor} !important; line-height: 1.6 !important; border-radius: 0 4px 4px 0 !important;`;
            }

            transEl.textContent = response.translation;
            el.parentNode.insertBefore(transEl, el.nextSibling);
            el.dataset.tgTranslated = 'done';

            console.log(`✅ Reddit 翻譯完成: ${text.substring(0, 30)}...`);
        } else {
            el.dataset.tgTranslated = '';
            console.warn('❌ Reddit 翻譯失敗:', response?.error);
        }
    } catch (error) {
        loader.remove();
        el.dataset.tgTranslated = '';
        console.error('❌ Reddit 翻譯錯誤:', error);
    } finally {
        activeRequests--;
        processQueue();
    }
}

// ============== 動態載入監聽 ==============

function setupMutationObserver() {
    observer = new MutationObserver((mutations) => {
        let hasNewContent = false;
        for (const mutation of mutations) {
            if (mutation.addedNodes.length > 0) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        // 偵測新帖子或留言
                        if (node.tagName === 'SHREDDIT-POST' ||
                            node.tagName === 'SHREDDIT-COMMENT' ||
                            node.querySelector?.('shreddit-post, shreddit-comment, .md')) {
                            hasNewContent = true;
                            break;
                        }
                    }
                }
            }
            if (hasNewContent) break;
        }

        if (hasNewContent && settings.redditEnabled) {
            // 延遲處理，等 DOM 穩定
            setTimeout(() => startTranslation(), 500);
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
}

// 啟動
init();
