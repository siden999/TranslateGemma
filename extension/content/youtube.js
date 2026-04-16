/**
 * TranslateGemma YouTube 翻譯腳本 v3.1
 * 功能：雙語字幕、標題翻譯、說明與留言翻譯、推薦影片翻譯 (全域偵測版)
 */

// 設定
let ytSettings = {
    enabled: true,
    targetLang: 'zh-TW',
    translateTitle: true,
    translateComments: true,
    translationMode: 'balanced',
    customGlossary: '',
    displayMode: 'dual'
};

// 狀態
let subtitleObserver = null;
let commentObserver = null;
let translatedSubtitles = new Map();
let isProcessing = false;
let debounceTimer = null;
let spaTimer = null;
let contextInvalidated = false;
let captionFallbackTimer = null;
let captionCheckAttempts = 0;
let lastErrorBannerAt = 0;

const TG_RELOAD_KEY = 'tgAutoReloadedAt';

// 限制：最多同時進行的翻譯請求數
const MAX_CONCURRENT = 3;
const SUBTITLE_BATCH_SIZE = 3;
let activeRequests = 0;
let progressState = {
    site: 'youtube',
    label: 'YouTube 翻譯',
    status: 'idle',
    total: 0,
    completed: 0,
    failed: 0,
    pending: 0,
    detail: ''
};

function parseGlossary() {
    return String(ytSettings.customGlossary || '')
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
        site: 'youtube',
        label: 'YouTube 翻譯',
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

function updateSubtitleProgress(completedDelta, failedDelta) {
    const completed = progressState.completed + completedDelta;
    const failed = progressState.failed + failedDelta;
    const pending = Math.max(0, progressState.total - completed - failed);
    reportProgress({
        completed,
        failed,
        pending,
        status: pending === 0 ? 'complete' : 'running',
        detail: pending === 0 ? '目前字幕已翻譯完成' : `字幕剩餘 ${pending} 段`
    });
}

function isInvalidatedError(error) {
    const message = (error && error.message) ? error.message : String(error || '');
    return message.includes('Extension context invalidated') ||
        message.includes('context invalidated') ||
        message.includes('The message port closed') ||
        message.includes('Receiving end does not exist');
}

function showReloadBanner(text, allowManual = false) {
    if (document.getElementById('tg-reload-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'tg-reload-banner';
    banner.textContent = text || 'TranslateGemma 更新中，正在恢復…';
    if (allowManual) {
        const button = document.createElement('button');
        button.textContent = '重新載入';
        button.addEventListener('click', () => location.reload());
        banner.appendChild(button);
    }
    document.body.appendChild(banner);
    requestAnimationFrame(() => banner.classList.add('show'));
}

function stopObservers() {
    try { subtitleObserver?.disconnect(); } catch (e) {}
    try { commentObserver?.disconnect(); } catch (e) {}
    try { sidebarIntersectionObserver?.disconnect(); } catch (e) {}
    if (sidebarScanTimer) {
        clearInterval(sidebarScanTimer);
        sidebarScanTimer = null;
    }
    if (spaTimer) {
        clearInterval(spaTimer);
        spaTimer = null;
    }
    if (captionFallbackTimer) {
        clearInterval(captionFallbackTimer);
        captionFallbackTimer = null;
    }
}

function handleContextInvalidated(reason) {
    if (contextInvalidated) return;
    contextInvalidated = true;
    stopObservers();

    let lastReload = 0;
    try {
        lastReload = parseInt(sessionStorage.getItem(TG_RELOAD_KEY) || '0', 10);
    } catch (e) {}

    const now = Date.now();
    const canReload = !lastReload || (now - lastReload > 30000);

    if (canReload) {
        try { sessionStorage.setItem(TG_RELOAD_KEY, String(now)); } catch (e) {}
        showReloadBanner('TranslateGemma 更新中，正在自動恢復…');
        setTimeout(() => location.reload(), 800);
    } else {
        showReloadBanner('TranslateGemma 更新中，請手動重新載入', true);
    }
    if (reason) {
        console.warn('TranslateGemma context invalidated:', reason);
    }
}

/**
 * 初始化
 */
async function initYouTube() {
    console.log('🎬 TranslateGemma YouTube 模組已載入');

    try {
        if (!chrome.runtime?.id) {
            handleContextInvalidated('runtime missing');
            return;
        }
        const response = await chrome.runtime.sendMessage({ action: 'getSettings' });
        ytSettings = { ...ytSettings, ...response };
        window.TranslateGemmaDisplay?.apply(ytSettings.displayMode);
    } catch (e) {
        if (isInvalidatedError(e)) {
            handleContextInvalidated(e.message || 'settings failed');
            return;
        }
        // 使用預設值
    }

    addYouTubeStyles();

    // 啟動各項功能
    if (ytSettings.enabled) {
        waitForCaptionContainer();
        waitForTitleAndDescription();
        waitForComments();
        waitForRelatedVideos();
    } else {
        clearProgress();
    }
}

/**
 * 核心翻譯函式 (重用)
 */
async function translateText(text, targetLang = 'zh-TW', options = {}) {
    if (!text || !text.trim()) return null;
    if (contextInvalidated) return null;
    if (!chrome.runtime?.id) {
        handleContextInvalidated('runtime missing');
        return null;
    }

    // 避免重複請求 (簡單快取)
    if (translatedSubtitles.has(text) && translatedSubtitles.get(text)) {
        return translatedSubtitles.get(text);
    }

    try {
        const response = await chrome.runtime.sendMessage({
            action: 'translate',
            text: text,
            sourceLang: 'auto', // 讓伺服器自動偵測
            targetLang: targetLang,
            options: {
                site: 'youtube',
                translationMode: ytSettings.translationMode,
                glossary: parseGlossary(),
                ...options
            }
        });

        if (response?.success && response.translation) {
            translatedSubtitles.set(text, response.translation);
            return response.translation;
        }
        if (response?.success === false) {
            const now = Date.now();
            if (now - lastErrorBannerAt > 5000) {
                lastErrorBannerAt = now;
                showReloadBanner(`翻譯失敗：${response.error || '未知錯誤'}`, false);
            }
            console.warn('翻譯回應失敗:', response?.error);
        }
    } catch (e) {
        if (isInvalidatedError(e)) {
            handleContextInvalidated(e.message || 'translate failed');
            return null;
        }
        console.error('翻譯請求失敗:', e);
    }
    return null;
}

async function translateTextBatch(texts, targetLang = 'zh-TW', options = {}) {
    const normalizedTexts = texts
        .map(text => String(text || '').trim())
        .filter(Boolean);
    if (normalizedTexts.length === 0) return [];

    const results = new Array(normalizedTexts.length).fill(null);
    const pendingTexts = [];
    const pendingIndexes = [];

    normalizedTexts.forEach((text, index) => {
        if (translatedSubtitles.has(text) && translatedSubtitles.get(text)) {
            results[index] = translatedSubtitles.get(text);
            return;
        }
        pendingTexts.push(text);
        pendingIndexes.push(index);
    });

    if (pendingTexts.length > 0) {
        try {
            const response = await chrome.runtime.sendMessage({
                action: 'translateBatch',
                texts: pendingTexts,
                sourceLang: 'auto',
                targetLang,
                options: {
                    site: 'youtube',
                    translationMode: ytSettings.translationMode,
                    glossary: parseGlossary(),
                    ...options
                }
            });

            if (response?.success && Array.isArray(response.translations)) {
                pendingIndexes.forEach((resultIndex, batchIndex) => {
                    const translation = response.translations[batchIndex] || null;
                    if (translation) {
                        translatedSubtitles.set(normalizedTexts[resultIndex], translation);
                    }
                    results[resultIndex] = translation;
                });
            }
        } catch (e) {
            if (isInvalidatedError(e)) {
                handleContextInvalidated(e.message || 'translate batch failed');
                return results;
            }
            console.error('批次翻譯請求失敗:', e);
        }
    }

    return results;
}

// ==========================================
// 1. 字幕翻譯
// ==========================================

function waitForCaptionContainer() {
    // 檢查影片播放器字幕容器
    const checkCaptions = setInterval(() => {
        const container = document.querySelector('.ytp-caption-window-container');
        captionCheckAttempts += 1;
        if (container) {
            clearInterval(checkCaptions);
            setupSubtitleObserver(container);
            processSubtitles();
        } else if (captionCheckAttempts >= 10 && !captionFallbackTimer) {
            // 找不到字幕容器時的保底：定期掃描字幕片段
            captionFallbackTimer = setInterval(processSubtitles, 1000);
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
        const pendingSegments = [];
        const segments = document.querySelectorAll('.ytp-caption-segment');
        for (const segment of segments) {
            const text = segment.textContent.trim();
            if (!text) continue;
            const now = Date.now();
            const retryAt = parseInt(segment.dataset.tgRetryAt || '0', 10);
            if (retryAt && now < retryAt) continue;
            if (segment.dataset.tgLastText === text && segment.dataset.tgTranslated === 'true') continue;
            segment.dataset.tgLastText = text;
            pendingSegments.push({ segment, text });
        }

        if (pendingSegments.length === 0) {
            if (progressState.status === 'running') {
                reportProgress({
                    status: 'complete',
                    pending: 0,
                    detail: '目前字幕已同步'
                });
            }
            return;
        }

        reportProgress({
            status: 'running',
            total: pendingSegments.length,
            completed: 0,
            failed: 0,
            pending: pendingSegments.length,
            detail: `字幕待翻譯 ${pendingSegments.length} 段`
        });

        for (let i = 0; i < pendingSegments.length; i += SUBTITLE_BATCH_SIZE) {
            if (activeRequests >= MAX_CONCURRENT) await new Promise(r => setTimeout(r, 100));
            await translateSegmentBatch(pendingSegments.slice(i, i + SUBTITLE_BATCH_SIZE));
        }
    } finally {
        isProcessing = false;
    }
}

async function translateSegmentBatch(items) {
    if (!items.length) return;
    activeRequests++;
    const translations = await translateTextBatch(items.map(item => item.text), ytSettings.targetLang, {
        contentTypes: items.map(() => 'subtitle')
    });
    activeRequests--;

    let completedCount = 0;
    let failedCount = 0;
    items.forEach((item, index) => {
        const translation = translations[index];
        if (translation) {
            showSubtitleTranslation(item.segment, translation);
            item.segment.dataset.tgTranslated = 'true';
            item.segment.dataset.tgRetryAt = '0';
            completedCount++;
        } else {
            item.segment.dataset.tgTranslated = 'false';
            item.segment.dataset.tgRetryAt = String(Date.now() + 1500);
            failedCount++;
        }
    });
    updateSubtitleProgress(completedCount, failedCount);
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
    window.TranslateGemmaDisplay?.markOriginal(segment);
    window.TranslateGemmaDisplay?.markTranslation(el);
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
    const text = titleEl.textContent.trim();
    if (!text) return;

    // 簡單檢測：如果是中文就不翻譯
    if (/[\u4e00-\u9fff]/.test(text)) return;

    if (titleEl.dataset.tgLastText === text && titleEl.parentElement?.querySelector('.tg-title-trans')) return;
    titleEl.dataset.tgLastText = text;

    const translation = await translateText(text, ytSettings.targetLang, { contentType: 'title' });
    if (translation) {
        let transEl = titleEl.parentElement?.querySelector('.tg-title-trans');
        if (!transEl) {
            transEl = document.createElement('div');
            transEl.className = 'tg-title-trans';
        }
        window.TranslateGemmaDisplay?.markOriginal(titleEl);
        window.TranslateGemmaDisplay?.markTranslation(transEl);
        transEl.textContent = translation;
        if (!transEl.parentElement) {
            titleEl.insertAdjacentElement('afterend', transEl);
        }
    } else {
        // 失敗時稍後再試一次
        setTimeout(() => processTitle(titleEl), 1500);
    }
}

async function processDescription() {
    // 雖然說明欄通常是縮起的，我們嘗試翻譯可見部分或等待展開
    // 這裡簡化處理：只翻譯說明欄的一開始部分
    const descEl = document.querySelector('#description-inline-expander');
    if (!descEl) return;
    // 說明欄內容較多且含 HTML，只取第一段純文字試作
    const text = descEl.innerText.trim().substring(0, 500);
    if (!text) return;

    if (/[\u4e00-\u9fff]/.test(text)) return; // 略過中文

    if (descEl.dataset.tgLastText === text && descEl.parentElement?.querySelector('.tg-desc-trans')) return;
    descEl.dataset.tgLastText = text;

    const translation = await translateText(text, ytSettings.targetLang, { contentType: 'paragraph' });
    if (translation) {
        let transEl = descEl.parentElement?.querySelector('.tg-desc-trans');
        if (!transEl) {
            transEl = document.createElement('div');
            transEl.className = 'tg-desc-trans';
        }
        window.TranslateGemmaDisplay?.markOriginal(descEl);
        window.TranslateGemmaDisplay?.markTranslation(transEl);
        transEl.textContent = `📝 ${translation}...`;
        if (!transEl.parentElement) {
            descEl.insertAdjacentElement('beforebegin', transEl);
        }
    } else {
        setTimeout(() => processDescription(), 1500);
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
    const text = commentEl.textContent.trim();
    if (!text || /[\u4e00-\u9fff]/.test(text)) return; // 略過中文

    const retryAt = parseInt(commentEl.dataset.tgRetryAt || '0', 10);
    if (retryAt && Date.now() < retryAt) return;
    if (commentEl.dataset.tgLastText === text && commentEl.nextElementSibling?.classList?.contains('tg-comment-trans')) return;
    commentEl.dataset.tgLastText = text;

    // 加入翻譯按鈕而非直接翻譯，或是直接翻譯但樣式區隔
    // 為求簡潔，直接顯示翻譯在下方
    const translation = await translateText(text, ytSettings.targetLang, { contentType: 'comment' });

    if (translation) {
        let transEl = commentEl.nextElementSibling?.classList?.contains('tg-comment-trans')
            ? commentEl.nextElementSibling
            : null;
        if (!transEl) {
            transEl = document.createElement('div');
            transEl.className = 'tg-comment-trans';
        }
        window.TranslateGemmaDisplay?.markOriginal(commentEl);
        window.TranslateGemmaDisplay?.markTranslation(transEl);
        transEl.textContent = translation;
        if (!transEl.parentElement) {
            commentEl.insertAdjacentElement('afterend', transEl);
        }
        commentEl.dataset.tgRetryAt = '0';
    } else {
        const retryCount = parseInt(commentEl.dataset.tgRetryCount || '0', 10);
        if (retryCount < 3) {
            commentEl.dataset.tgRetryCount = String(retryCount + 1);
            commentEl.dataset.tgRetryAt = String(Date.now() + 2000);
            setTimeout(() => translateComment(commentEl), 2000);
        }
    }
}

// ==========================================
// 4. 右側推薦影片翻譯
// ==========================================

// 右側推薦卡片選擇器 (涵蓋常見類型)
const SIDEBAR_ITEM_SELECTOR = [
    'ytd-compact-video-renderer',
    'ytd-compact-playlist-renderer',
    'ytd-compact-radio-renderer',
    'ytd-compact-movie-renderer',
    'ytd-compact-grid-video-renderer'
].join(',');

const SIDEBAR_TITLE_SELECTOR = [
    '#video-title',
    'a#video-title',
    'yt-formatted-string#video-title',
    '#video-title-link',
    '#title',
    'a#title',
    'yt-formatted-string#title',
    'a[title][href*="watch"]',
    'a[aria-label][href*="watch"]'
].join(',');

function findSidebarContainer() {
    return document.querySelector('#secondary') ||
        document.querySelector('#related') ||
        document.querySelector('ytd-watch-next-secondary-results-renderer') ||
        document.body;
}

function enqueueSidebarElement(el) {
    if (!el || !el.matches || !el.matches(SIDEBAR_ITEM_SELECTOR)) return;
    sidebarIntersectionObserver.observe(el);
}

// 用來檢測元素可見性的 Observer (共用)
const sidebarIntersectionObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        if (entry.target.dataset.tgProcessing === 'true') return;
        translateRelatedVideo(entry.target);
    });
}, { rootMargin: '200px' });

let sidebarScanTimer = null;

function startSidebarTitleScanner() {
    if (sidebarScanTimer) return;
    sidebarScanTimer = setInterval(() => {
        const container = findSidebarContainer();
        if (!container || container === document.body) return;
        container.querySelectorAll(SIDEBAR_TITLE_SELECTOR).forEach(titleEl => {
            if (titleEl.closest && titleEl.closest(SIDEBAR_ITEM_SELECTOR)) {
                enqueueSidebarElement(titleEl.closest(SIDEBAR_ITEM_SELECTOR));
            } else {
                translateSidebarTitleElement(titleEl);
            }
        });
    }, 2500);
}

function waitForRelatedVideos() {
    const root = findSidebarContainer();
    // 改為全域監聽，因為 #secondary 不一定存在 (例如劇院模式或某些版面)
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.type === 'characterData') {
                const parent = mutation.target.parentElement;
                const card = parent && parent.closest ? parent.closest(SIDEBAR_ITEM_SELECTOR) : null;
                if (card) enqueueSidebarElement(card);
                continue;
            }
            mutation.addedNodes.forEach(node => {
                if (node.nodeType !== 1) return;
                // 1. 直接是影片卡片
                if (node.matches && node.matches(SIDEBAR_ITEM_SELECTOR)) enqueueSidebarElement(node);
                // 2. 或是容器內包含影片卡片 (例如 AJAX 載入了一整塊內容)
                if (node.querySelectorAll) {
                    node.querySelectorAll(SIDEBAR_ITEM_SELECTOR).forEach(child => {
                        enqueueSidebarElement(child);
                    });
                }
            });
        }
    });

    observer.observe(root, { childList: true, subtree: true, characterData: true });

    // 處理當前已經存在的元素
    document.querySelectorAll(SIDEBAR_ITEM_SELECTOR).forEach(node => {
        enqueueSidebarElement(node);
    });

    // 保底掃描 (避免 YouTube 延遲填入標題或 DOM 重用)
    startSidebarTitleScanner();
}

async function translateRelatedVideo(element) {
    if (element.dataset.tgProcessing === 'true') return;

    // 嘗試多種標題選擇器，因為 YouTube 結構可能會變
    const titleEl =
        element.querySelector('#video-title') ||
        element.querySelector('a#video-title') ||
        element.querySelector('yt-formatted-string#video-title') ||
        element.querySelector('#video-title-link') ||
        element.querySelector('#title') ||
        element.querySelector('a#title') ||
        element.querySelector('yt-formatted-string#title') ||
        element.querySelector('a[title][href*="watch"]') ||
        element.querySelector('a[aria-label][href*="watch"]');
    if (!titleEl) return;

    let text = getSidebarTitleText(titleEl);
    if (!text) {
        scheduleRelatedVideoRetry(element, () => translateRelatedVideo(element));
        return;
    }
    if (element.dataset.tgLastText === text && element.querySelector('.tg-related-title-trans')) {
        return;
    }
    if (/[\u4e00-\u9fff]/.test(text)) {
        element.dataset.tgLastText = text;
        return;
    }

    // 翻譯
    element.dataset.tgProcessing = 'true';
    const translation = await translateText(text, ytSettings.targetLang, { contentType: 'title' });
    element.dataset.tgProcessing = 'false';

    if (!translation) {
        scheduleRelatedVideoRetry(element, () => translateRelatedVideo(element));
        return;
    }

    element.dataset.tgLastText = text;

    let transEl = element.querySelector('.tg-related-title-trans');
    if (!transEl) {
        transEl = document.createElement('div');
        transEl.className = 'tg-related-title-trans';
    }
    window.TranslateGemmaDisplay?.markOriginal(titleEl);
    window.TranslateGemmaDisplay?.markTranslation(transEl);
    transEl.textContent = translation;

    // 插入到標題容器中，通常是標題的下一個兄弟節點，或者 parent 的最後
    // 為了排版美觀，嘗試插入在 metadata 之前
    const meta = element.querySelector('#metadata-line') || element.querySelector('.secondary-metadata');
    if (meta && meta.parentElement) {
        meta.parentElement.insertBefore(transEl, meta);
    } else if (titleEl.parentElement) {
        // Fallback: 直接放在標題後面
        if (!transEl.parentElement) titleEl.parentElement.appendChild(transEl);
    }
}

function translateSidebarTitleElement(titleEl) {
    const anchor = titleEl.closest ? (titleEl.closest('a#video-title, a#title') || titleEl) : titleEl;
    if (!anchor || anchor.dataset.tgProcessing === 'true') return;

    let text = getSidebarTitleText(titleEl);
    if (!text) {
        scheduleRelatedVideoRetry(anchor, () => translateSidebarTitleElement(titleEl));
        return;
    }
    if (anchor.dataset.tgLastText === text) {
        const container = anchor.parentElement || anchor;
        if (container && container.querySelector('.tg-related-title-trans')) return;
    }
    if (/[\u4e00-\u9fff]/.test(text)) {
        anchor.dataset.tgLastText = text;
        return;
    }

    anchor.dataset.tgProcessing = 'true';
    translateText(text, ytSettings.targetLang, { contentType: 'title' }).then(translation => {
        anchor.dataset.tgProcessing = 'false';
        if (!translation) {
            scheduleRelatedVideoRetry(anchor, () => translateSidebarTitleElement(titleEl));
            return;
        }
        anchor.dataset.tgLastText = text;

        const container = anchor.parentElement || anchor;
        if (!container) return;
        let transEl = container.querySelector('.tg-related-title-trans');
        if (!transEl) {
            transEl = document.createElement('div');
            transEl.className = 'tg-related-title-trans';
        }
        window.TranslateGemmaDisplay?.markOriginal(titleEl);
        window.TranslateGemmaDisplay?.markTranslation(transEl);
        transEl.textContent = translation;
        if (!transEl.parentElement) anchor.insertAdjacentElement('afterend', transEl);
    });
}

function getSidebarTitleText(titleEl) {
    if (!titleEl) return '';
    const titleAttr = titleEl.getAttribute ? titleEl.getAttribute('title') : null;
    const ariaLabel = titleEl.getAttribute ? titleEl.getAttribute('aria-label') : null;
    let text = (titleAttr || titleEl.textContent || '').trim();
    if (!text && ariaLabel) text = ariaLabel.trim();
    return text;
}

function scheduleRelatedVideoRetry(element, retryFn) {
    const maxRetries = 5;
    const retryCount = parseInt(element.dataset.tgRetryCount || '0', 10);
    if (retryCount >= maxRetries) {
        return;
    }
    element.dataset.tgRetryCount = String(retryCount + 1);
    const delay = Math.min(2000, 400 * (retryCount + 1));
    setTimeout(() => {
        if (typeof retryFn === 'function') {
            retryFn();
        } else {
            translateRelatedVideo(element);
        }
    }, delay);
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
            color: #eee;
            font-size: 1.3rem;
            margin-top: 6px;
            padding-left: 10px;
            border-left: 3px solid #3ea6ff;
            line-height: 1.5;
        }
        /* 推薦影片標題翻譯 */
        .tg-related-title-trans {
            color: #bbb;
            font-size: 1.2rem;
            margin-top: 4px;
            margin-bottom: 4px;
            line-height: 1.3;
            display: block;
            border-left: 3px solid #3ea6ff;
            padding-left: 8px;
        }
        /* 失效提示 */
        #tg-reload-banner {
            position: fixed;
            right: 16px;
            bottom: 16px;
            background: rgba(17, 24, 39, 0.95);
            color: #fff;
            padding: 10px 12px;
            border-radius: 10px;
            font-size: 13px;
            z-index: 2147483647;
            display: flex;
            align-items: center;
            gap: 8px;
            opacity: 0;
            transform: translateY(6px);
            transition: opacity 0.2s ease, transform 0.2s ease;
        }
        #tg-reload-banner.show {
            opacity: 1;
            transform: translateY(0);
        }
        #tg-reload-banner button {
            background: #3ea6ff;
            border: none;
            color: #fff;
            padding: 4px 8px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 12px;
        }
    `;
    document.head.appendChild(style);
}

// 初始化
initYouTube();

// SPA 導航處理
let lastUrl = location.href;
spaTimer = setInterval(() => {
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
        window.TranslateGemmaDisplay?.apply(ytSettings.displayMode);
        if (!ytSettings.enabled) {
            clearProgress();
        }
        sendResponse({ success: true });
    }
    if (request.action === 'ping') {
        sendResponse({ pong: true });
    }
    if (request.action === 'serverStarted') {
        // 清掉舊狀態，讓字幕/標題可重新翻譯
        translatedSubtitles.clear();
        document.querySelectorAll('.ytp-caption-segment').forEach(seg => {
            delete seg.dataset.tgLastText;
            delete seg.dataset.tgTranslated;
            delete seg.dataset.tgRetryAt;
        });
        const titleEl = document.querySelector('h1.ytd-video-primary-info-renderer');
        if (titleEl) {
            delete titleEl.dataset.tgLastText;
        }
        const descEl = document.querySelector('#description-inline-expander');
        if (descEl) {
            delete descEl.dataset.tgLastText;
        }
        setTimeout(() => {
            waitForCaptionContainer();
            waitForTitleAndDescription();
            waitForComments();
            waitForRelatedVideos();
        }, 300);
        sendResponse({ success: true });
    }
});
