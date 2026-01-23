/**
 * TranslateGemma YouTube 字幕翻譯 v2.1
 * 修復：加入防抖機制避免當機
 */

// 設定
let ytSettings = {
    enabled: true,
    targetLang: 'zh-TW'
};

// 狀態
let subtitleObserver = null;
let translatedSubtitles = new Map();
let isProcessing = false;
let debounceTimer = null;

// 限制：最多同時進行的翻譯請求數
const MAX_CONCURRENT = 2;
let activeRequests = 0;

/**
 * 初始化
 */
async function initYouTube() {
    console.log('🎬 TranslateGemma YouTube 字幕翻譯已載入');

    try {
        const response = await chrome.runtime.sendMessage({ action: 'getSettings' });
        ytSettings = { ...ytSettings, ...response };
    } catch (e) {
        console.log('使用預設設定');
    }

    addYouTubeStyles();
    waitForCaptionContainer();
}

/**
 * 等待字幕容器出現
 */
function waitForCaptionContainer() {
    // 只觀察字幕容器，不要觀察整個播放器
    const checkCaption = setInterval(() => {
        const container = document.querySelector('.ytp-caption-window-container');
        if (container) {
            clearInterval(checkCaption);
            console.log('✅ 找到字幕容器');
            setupObserver(container);
        }
    }, 2000);

    // 60 秒後停止（節省資源）
    setTimeout(() => clearInterval(checkCaption), 60000);
}

/**
 * 設置觀察器（只觀察字幕容器）
 */
function setupObserver(container) {
    if (subtitleObserver) {
        subtitleObserver.disconnect();
    }

    subtitleObserver = new MutationObserver(() => {
        // 防抖：300ms 內只處理一次
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(processSubtitles, 300);
    });

    subtitleObserver.observe(container, {
        childList: true,
        subtree: true,
        characterData: true
    });

    console.log('✅ 字幕觀察器已啟動（防抖模式）');
}

/**
 * 處理字幕（帶節流）
 */
async function processSubtitles() {
    if (!ytSettings.enabled || isProcessing) return;
    isProcessing = true;

    try {
        const segments = document.querySelectorAll('.ytp-caption-segment');

        for (const segment of segments) {
            // 限制並發數
            if (activeRequests >= MAX_CONCURRENT) {
                await new Promise(r => setTimeout(r, 100));
            }

            await translateSegment(segment);
        }
    } finally {
        isProcessing = false;
    }
}

/**
 * 翻譯單個字幕段落
 */
async function translateSegment(segment) {
    const text = segment.textContent.trim();

    // 跳過條件
    if (!text || text.length < 3) return;
    if (segment.dataset.tgProcessed) return;
    if (translatedSubtitles.has(text)) {
        showTranslation(segment, translatedSubtitles.get(text));
        return;
    }

    // 標記已處理
    segment.dataset.tgProcessed = 'true';
    translatedSubtitles.set(text, null);

    activeRequests++;
    try {
        const response = await chrome.runtime.sendMessage({
            action: 'translate',
            text: text,
            sourceLang: 'en',
            targetLang: ytSettings.targetLang
        });

        if (response?.success && response.translation) {
            translatedSubtitles.set(text, response.translation);
            showTranslation(segment, response.translation);
        }
    } catch (e) {
        console.error('字幕翻譯錯誤:', e);
    } finally {
        activeRequests--;
    }
}

/**
 * 顯示翻譯
 */
function showTranslation(segment, translation) {
    if (!translation || !segment.parentElement) return;

    // 避免重複添加
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

/**
 * 樣式
 */
function addYouTubeStyles() {
    if (document.getElementById('tg-yt-style')) return;

    const style = document.createElement('style');
    style.id = 'tg-yt-style';
    style.textContent = `
        .tg-yt-trans {
            color: #ffeb3b !important;
            font-size: 28px !important;
            margin-top: 10px !important;
            text-shadow: 2px 2px 4px #000, 0 0 8px rgba(0,0,0,0.9) !important;
            background: rgba(0,0,0,0.85) !important;
            padding: 8px 20px !important;
            border-radius: 4px !important;
            font-weight: 500 !important;
            display: inline-block !important;
            line-height: 1.4 !important;
        }
    `;
    document.head.appendChild(style);
}

// 初始化
initYouTube();

// 監聽 YouTube 導航（SPA）
let lastUrl = location.href;
setInterval(() => {
    if (location.href !== lastUrl) {
        lastUrl = location.href;
        translatedSubtitles.clear();
        if (subtitleObserver) subtitleObserver.disconnect();
        setTimeout(waitForCaptionContainer, 2000);
    }
}, 3000);

// 訊息監聽
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'toggleYouTubeTranslation') {
        ytSettings.enabled = !ytSettings.enabled;
        sendResponse({ enabled: ytSettings.enabled });
    }
    if (request.action === 'updateSettings') {
        ytSettings = { ...ytSettings, ...request.settings };
        sendResponse({ success: true });
    }
});
