/**
 * TranslateGemma YouTube 字幕翻譯 v2.0
 * 專門處理 YouTube 影片 CC 字幕的雙語顯示
 */

// 設定
let ytSettings = {
    enabled: true,
    targetLang: 'zh-TW'
};

// 狀態
let subtitleObserver = null;
let translatedSubtitles = new Map();
let isObserving = false;

// YouTube 字幕相關的所有可能選擇器
const SUBTITLE_SELECTORS = {
    container: [
        '.ytp-caption-window-container',
        '.caption-window',
        '#caption-window-1'
    ],
    segments: [
        '.ytp-caption-segment',
        '.captions-text span',
        '.caption-visual-line',
        '.ytp-caption-window-container span'
    ]
};

/**
 * 初始化
 */
async function initYouTube() {
    console.log('🎬 TranslateGemma YouTube 字幕翻譯已載入');

    // 載入設定
    try {
        const response = await chrome.runtime.sendMessage({ action: 'getSettings' });
        ytSettings = { ...ytSettings, ...response };
    } catch (e) {
        console.log('使用預設 YouTube 設定');
    }

    // 添加樣式
    addYouTubeStyles();

    // 等待播放器載入
    waitForPlayer();

    // 監聽頁面導航（YouTube SPA）
    observeNavigation();
}

/**
 * 等待 YouTube 播放器載入
 */
function waitForPlayer() {
    console.log('⏳ 等待 YouTube 播放器載入...');

    const checkPlayer = setInterval(() => {
        const player = document.querySelector('.html5-video-player, #movie_player');
        if (player) {
            clearInterval(checkPlayer);
            console.log('✅ 找到 YouTube 播放器');
            setupSubtitleObserver();
        }
    }, 1000);

    // 30 秒後停止檢查
    setTimeout(() => clearInterval(checkPlayer), 30000);
}

/**
 * 設置字幕觀察器
 */
function setupSubtitleObserver() {
    if (isObserving) return;

    console.log('🔍 設置字幕觀察器...');

    // 嘗試找到字幕容器
    let container = null;
    for (const selector of SUBTITLE_SELECTORS.container) {
        container = document.querySelector(selector);
        if (container) {
            console.log(`✅ 找到字幕容器: ${selector}`);
            break;
        }
    }

    // 如果找不到容器，觀察整個播放器區域
    if (!container) {
        container = document.querySelector('.html5-video-player, #movie_player');
        console.log('⚠️ 未找到字幕容器，觀察整個播放器');
    }

    if (!container) {
        console.log('❌ 無法找到可觀察的元素，1 秒後重試');
        setTimeout(setupSubtitleObserver, 1000);
        return;
    }

    // 建立 MutationObserver
    subtitleObserver = new MutationObserver((mutations) => {
        handleSubtitleChange();
    });

    subtitleObserver.observe(container, {
        childList: true,
        subtree: true,
        characterData: true
    });

    isObserving = true;
    console.log('✅ 字幕觀察器已啟動');

    // 立即處理一次現有字幕
    handleSubtitleChange();
}

/**
 * 監聽 YouTube SPA 導航
 */
function observeNavigation() {
    // YouTube 是 SPA，需要監聽導航變化
    let lastUrl = location.href;

    new MutationObserver(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            console.log('🔄 YouTube 頁面導航，重新設置觀察器');

            // 重置狀態
            isObserving = false;
            translatedSubtitles.clear();

            if (subtitleObserver) {
                subtitleObserver.disconnect();
            }

            // 等待新頁面載入
            setTimeout(waitForPlayer, 1000);
        }
    }).observe(document.body, { childList: true, subtree: true });
}

/**
 * 處理字幕變化
 */
async function handleSubtitleChange() {
    if (!ytSettings.enabled) return;

    // 嘗試多種選擇器找字幕元素
    let subtitleElements = [];
    for (const selector of SUBTITLE_SELECTORS.segments) {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
            subtitleElements = Array.from(elements);
            break;
        }
    }

    if (subtitleElements.length === 0) return;

    for (const element of subtitleElements) {
        await translateSubtitleElement(element);
    }
}

/**
 * 翻譯單個字幕元素
 */
async function translateSubtitleElement(element) {
    const originalText = element.textContent.trim();

    // 跳過太短或空的文字
    if (!originalText || originalText.length < 2) return;

    // 跳過已經是翻譯容器的元素
    if (element.classList.contains('tg-yt-translation')) return;

    // 檢查是否已翻譯
    if (translatedSubtitles.has(originalText)) {
        const cached = translatedSubtitles.get(originalText);
        if (cached) {
            insertSubtitleTranslation(element, cached);
        }
        return;
    }

    // 標記為處理中
    translatedSubtitles.set(originalText, null);

    try {
        const response = await chrome.runtime.sendMessage({
            action: 'translate',
            text: originalText,
            sourceLang: 'en',
            targetLang: ytSettings.targetLang
        });

        if (response && response.success && response.translation) {
            translatedSubtitles.set(originalText, response.translation);
            insertSubtitleTranslation(element, response.translation);
        }
    } catch (error) {
        console.error('YouTube 字幕翻譯失敗:', error);
        translatedSubtitles.delete(originalText);
    }
}

/**
 * 插入字幕翻譯
 */
function insertSubtitleTranslation(element, translation) {
    if (!translation) return;

    // 檢查父元素是否已有翻譯
    const parent = element.parentElement;
    if (!parent) return;

    // 檢查是否已有翻譯元素
    let translationEl = parent.querySelector('.tg-yt-translation');

    if (!translationEl) {
        translationEl = document.createElement('div');
        translationEl.className = 'tg-yt-translation';

        // 插入到字幕元素後面
        if (element.nextSibling) {
            parent.insertBefore(translationEl, element.nextSibling);
        } else {
            parent.appendChild(translationEl);
        }
    }

    translationEl.textContent = translation;
}

/**
 * 添加 YouTube 專用樣式
 */
function addYouTubeStyles() {
    // 檢查是否已添加
    if (document.getElementById('tg-youtube-styles')) return;

    const style = document.createElement('style');
    style.id = 'tg-youtube-styles';
    style.textContent = `
        /* YouTube 字幕翻譯樣式 */
        .tg-yt-translation {
            color: #ffeb3b !important;
            font-size: 0.9em !important;
            margin-top: 6px !important;
            text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.9) !important;
            background: rgba(0, 0, 0, 0.7) !important;
            padding: 4px 12px !important;
            border-radius: 4px !important;
            display: block !important;
            text-align: center !important;
            font-weight: 500 !important;
            line-height: 1.4 !important;
        }
        
        /* 確保字幕容器可以包含翻譯 */
        .ytp-caption-segment,
        .caption-visual-line {
            display: block !important;
        }
    `;
    document.head.appendChild(style);
}

// 初始化
initYouTube();

// 訊息監聽
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'toggleYouTubeTranslation') {
        ytSettings.enabled = !ytSettings.enabled;
        console.log(`YouTube 字幕翻譯: ${ytSettings.enabled ? '開啟' : '關閉'}`);
        sendResponse({ enabled: ytSettings.enabled });
    }

    if (request.action === 'updateSettings') {
        ytSettings = { ...ytSettings, ...request.settings };
        sendResponse({ success: true });
    }
});

console.log('🎬 TranslateGemma YouTube 模組已就緒');
