/**
 * TranslateGemma YouTube 翻譯腳本 v3.0
 * 功能：雙語字幕、標題翻譯、說明與留言翻譯
 */

// 設定
let ytSettings = {
    enabled: true,
    targetLang: 'zh-TW',
    translateTitle: true,
    translateComments: true
};

// 狀態
let subtitleObserver = null;
let commentObserver = null;
let translatedSubtitles = new Map();
let isProcessing = false;
let debounceTimer = null;

// 限制：最多同時進行的翻譯請求數
const MAX_CONCURRENT = 3;
let activeRequests = 0;

/**
 * 初始化
 */
async function initYouTube() {
    console.log('🎬 TranslateGemma YouTube 模組已載入');

    try {
        const response = await chrome.runtime.sendMessage({ action: 'getSettings' });
        ytSettings = { ...ytSettings, ...response };
    } catch (e) {
        // 使用預設值
    }

    addYouTubeStyles();

    // 啟動各項功能
    if (ytSettings.enabled) {
        waitForCaptionContainer();
        waitForTitleAndDescription();
        waitForComments();
    }
}

/**
 * 核心翻譯函式 (重用)
 */
async function translateText(text, targetLang = 'zh-TW') {
    if (!text || !text.trim()) return null;

    // 避免重複請求 (簡單快取)
    if (translatedSubtitles.has(text) && translatedSubtitles.get(text)) {
        return translatedSubtitles.get(text);
    }

    try {
        const response = await chrome.runtime.sendMessage({
            action: 'translate',
            text: text,
            sourceLang: 'auto', // 讓伺服器自動偵測
            targetLang: targetLang
        });

        if (response?.success && response.translation) {
            translatedSubtitles.set(text, response.translation);
            return response.translation;
        }
    } catch (e) {
        console.error('翻譯請求失敗:', e);
    }
    return null;
}

// ==========================================
// 1. 字幕翻譯
// ==========================================

function waitForCaptionContainer() {
    // 檢查影片播放器字幕容器
    const checkCaptions = setInterval(() => {
        const container = document.querySelector('.ytp-caption-window-container');
        if (container) {
            clearInterval(checkCaptions);
            setupSubtitleObserver(container);
        }
    }, 2000);
}

function setupSubtitleObserver(container) {
    if (subtitleObserver) subtitleObserver.disconnect();

    subtitleObserver = new MutationObserver(() => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(processSubtitles, 200);
    });

    subtitleObserver.observe(container, { childList: true, subtree: true, characterData: true });
}

async function processSubtitles() {
    if (isProcessing) return;
    isProcessing = true;

    try {
        const segments = document.querySelectorAll('.ytp-caption-segment');
        for (const segment of segments) {
            if (activeRequests >= MAX_CONCURRENT) await new Promise(r => setTimeout(r, 100));
            await translateSegment(segment);
        }
    } finally {
        isProcessing = false;
    }
}

async function translateSegment(segment) {
    const text = segment.textContent.trim();
    if (!text || segment.dataset.tgProcessed) return;

    segment.dataset.tgProcessed = 'true';
    activeRequests++;

    const translation = await translateText(text, ytSettings.targetLang);
    activeRequests--;

    if (translation) {
        showSubtitleTranslation(segment, translation);
    }
}

function showSubtitleTranslation(segment, translation) {
    if (!segment.parentElement) return;
    const existing = segment.parentElement.querySelector('.tg-yt-trans');
    if (existing) {
        existing.textContent = translation;
        return;
    }
    const el = document.createElement('div');
    el.className = 'tg-yt-trans';
    el.textContent = translation;
    segment.parentElement.appendChild(el);
}

// ==========================================
// 2. 標題與說明翻譯
// ==========================================

function waitForTitleAndDescription() {
    const checkTitle = setInterval(() => {
        const titleEl = document.querySelector('h1.ytd-video-primary-info-renderer');
        if (titleEl && titleEl.textContent.trim()) {
            clearInterval(checkTitle);
            processTitle(titleEl);
            processDescription();
        }
    }, 2000);
}

async function processTitle(titleEl) {
    if (titleEl.querySelector('.tg-title-trans') || titleEl.dataset.tgProcessed) return;

    titleEl.dataset.tgProcessed = 'true';
    const text = titleEl.textContent.trim();

    // 簡單檢測：如果是中文就不翻譯
    if (/[\u4e00-\u9fff]/.test(text)) return;

    const translation = await translateText(text, ytSettings.targetLang);
    if (translation) {
        const transEl = document.createElement('div');
        transEl.className = 'tg-title-trans';
        transEl.textContent = translation;
        titleEl.appendChild(transEl);
    }
}

async function processDescription() {
    // 雖然說明欄通常是縮起的，我們嘗試翻譯可見部分或等待展開
    // 這裡簡化處理：只翻譯說明欄的一開始部分
    const descEl = document.querySelector('#description-inline-expander');
    if (!descEl || descEl.dataset.tgProcessed) return;

    descEl.dataset.tgProcessed = 'true';
    // 說明欄內容較多且含 HTML，只取第一段純文字試作
    const text = descEl.innerText.trim().substring(0, 500);

    if (/[\u4e00-\u9fff]/.test(text)) return; // 略過中文

    const translation = await translateText(text, ytSettings.targetLang);
    if (translation) {
        const transEl = document.createElement('div');
        transEl.className = 'tg-desc-trans';
        transEl.textContent = `📝 ${translation}...`;
        // 插入在說明欄頂部
        descEl.insertBefore(transEl, descEl.firstChild);
    }
}

// ==========================================
// 3. 留言翻譯 (Lazy Load)
// ==========================================

function waitForComments() {
    const commentsSection = document.querySelector('ytd-comments');
    if (!commentsSection) {
        setTimeout(waitForComments, 3000);
        return;
    }

    // 使用 IntersectionObserver 實現滾動加載
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const commentBody = entry.target.querySelector('#content-text');
                if (commentBody) {
                    translateComment(commentBody);
                    observer.unobserve(entry.target); // 只翻譯一次
                }
            }
        });
    }, { rootMargin: '100px' });

    // 監聽新留言的加入
    if (commentObserver) commentObserver.disconnect();
    commentObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            mutation.addedNodes.forEach(node => {
                if (node.nodeName === 'YTD-COMMENT-THREAD-RENDERER') {
                    observer.observe(node);
                }
            });
        }
    });

    const contents = commentsSection.querySelector('#contents');
    if (contents) {
        commentObserver.observe(contents, { childList: true });

        // 初始已存在的留言
        document.querySelectorAll('ytd-comment-thread-renderer').forEach(node => observer.observe(node));
    }
}

async function translateComment(commentEl) {
    if (commentEl.dataset.tgProcessed) return;
    commentEl.dataset.tgProcessed = 'true';

    const text = commentEl.textContent.trim();
    if (!text || /[\u4e00-\u9fff]/.test(text)) return; // 略過中文

    // 加入翻譯按鈕而非直接翻譯，或是直接翻譯但樣式區隔
    // 為求簡潔，直接顯示翻譯在下方
    const translation = await translateText(text, ytSettings.targetLang);

    if (translation) {
        const transEl = document.createElement('div');
        transEl.className = 'tg-comment-trans';
        transEl.textContent = translation;
        commentEl.appendChild(transEl);
    }
}

// ==========================================
// 4. 右側推薦影片翻譯
// ==========================================

function waitForRelatedVideos() {
    const secondary = document.querySelector('#secondary');
    if (!secondary) {
        setTimeout(waitForRelatedVideos, 3000);
        return;
    }

    // 使用 IntersectionObserver 比較高效
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                translateRelatedVideo(entry.target);
                observer.unobserve(entry.target);
            }
        });
    }, { rootMargin: '200px' });

    // 監聽新載入的推薦影片
    const relatedObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            mutation.addedNodes.forEach(node => {
                if (node.nodeName === 'YTD-COMPACT-VIDEO-RENDERER') {
                    observer.observe(node);
                }
            });
        }
    });

    const itemsContainer = secondary.querySelector('#items');
    if (itemsContainer) {
        relatedObserver.observe(itemsContainer, { childList: true, subtree: true });
    }

    // 初始影片
    document.querySelectorAll('ytd-compact-video-renderer').forEach(node => observer.observe(node));
}

async function translateRelatedVideo(element) {
    if (element.dataset.tgProcessed) return;
    element.dataset.tgProcessed = 'true';

    const titleEl = element.querySelector('#video-title');
    if (!titleEl) return;

    const text = titleEl.textContent.trim();
    if (!text || /[\u4e00-\u9fff]/.test(text)) return; // 略過中文

    // 翻譯
    const translation = await translateText(text, ytSettings.targetLang);
    if (translation) {
        const transEl = document.createElement('div');
        transEl.className = 'tg-related-title-trans';
        transEl.textContent = translation;

        // 插入到標題下方
        titleEl.parentElement.insertBefore(transEl, titleEl.nextSibling);
    }
}

// ==========================================
// 樣式與工具
// ==========================================

function addYouTubeStyles() {
    if (document.getElementById('tg-yt-style')) return;
    const style = document.createElement('style');
    style.id = 'tg-yt-style';
    style.textContent = `
        /* 字幕樣式 */
        .tg-yt-trans {
            color: #ffeb3b !important;
            font-size: 24px !important;
            margin-top: 8px !important;
            background: rgba(0,0,0,0.85) !important;
            padding: 4px 12px !important;
            border-radius: 4px !important;
            display: inline-block !important;
            line-height: 1.4 !important;
        }
        /* 標題翻譯 */
        .tg-title-trans {
            color: #aaa;
            font-size: 1.6rem;
            margin-top: 8px;
            font-weight: 400;
            line-height: normal;
            border-bottom: 1px dashed #444;
            padding-bottom: 8px;
        }
        /* 說明翻譯 */
        .tg-desc-trans {
            color: #aaa;
            font-size: 1.4rem;
            margin-bottom: 12px;
            background: #222;
            padding: 8px;
            border-radius: 8px;
        }
        /* 留言翻譯 */
        .tg-comment-trans {
            color: #888;
            font-size: 1.3rem;
            margin-top: 6px;
            padding-left: 10px;
            border-left: 2px solid #555;
        }
        /* 推薦影片標題翻譯 */
        .tg-related-title-trans {
            color: #999;
            font-size: 1.2rem;
            margin-top: 4px;
            margin-bottom: 4px;
            line-height: 1.3;
            display: block;
        }
    `;
    document.head.appendChild(style);
}

// 初始化
initYouTube();

// SPA 導航處理
let lastUrl = location.href;
setInterval(() => {
    if (location.href !== lastUrl) {
        lastUrl = location.href;
        // 清除狀態
        translatedSubtitles.clear();
        // 重新偵測各區塊 (給一點時間讓 DOM 載入)
        setTimeout(() => {
            waitForCaptionContainer();
            waitForTitleAndDescription();
            waitForComments();
            waitForRelatedVideos();
        }, 2000);
    }
}, 2000);

// 訊息監聽
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'updateSettings') {
        ytSettings = { ...ytSettings, ...request.settings };
        sendResponse({ success: true });
    }
});
