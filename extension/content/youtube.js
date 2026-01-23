/**
 * TranslateGemma YouTube 字幕翻譯
 * 專門處理 YouTube 影片字幕的雙語顯示
 */

// 設定
let ytSettings = {
    enabled: true,
    targetLang: 'zh-TW'
};

// 觀察器
let subtitleObserver = null;
let translatedSubtitles = new Map();

/**
 * 初始化
 */
async function initYouTube() {
    console.log('TranslateGemma YouTube 字幕翻譯已載入');

    // 載入設定
    const response = await chrome.runtime.sendMessage({ action: 'getSettings' });
    ytSettings = { ...ytSettings, ...response };

    // 等待 YouTube 播放器載入
    waitForPlayer();
}

/**
 * 等待 YouTube 播放器載入
 */
function waitForPlayer() {
    const checkPlayer = setInterval(() => {
        const player = document.querySelector('.html5-video-player');
        if (player) {
            clearInterval(checkPlayer);
            setupSubtitleObserver();
        }
    }, 1000);
}

/**
 * 設置字幕觀察器
 */
function setupSubtitleObserver() {
    // YouTube 字幕容器的選擇器
    const subtitleContainerSelector = '.ytp-caption-window-container';

    // 使用 MutationObserver 監聽字幕變化
    subtitleObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.type === 'childList' || mutation.type === 'characterData') {
                handleSubtitleChange();
            }
        }
    });

    // 開始觀察
    const observeSubtitles = () => {
        const container = document.querySelector(subtitleContainerSelector);
        if (container) {
            subtitleObserver.observe(container, {
                childList: true,
                subtree: true,
                characterData: true
            });
            console.log('YouTube 字幕觀察器已啟動');
        } else {
            // 如果容器不存在，稍後重試
            setTimeout(observeSubtitles, 1000);
        }
    };

    observeSubtitles();
}

/**
 * 處理字幕變化
 */
async function handleSubtitleChange() {
    if (!ytSettings.enabled) return;

    // 取得當前字幕文字
    const subtitleSegments = document.querySelectorAll('.ytp-caption-segment');

    for (const segment of subtitleSegments) {
        const originalText = segment.textContent.trim();
        if (!originalText || originalText.length < 2) continue;

        // 檢查是否已翻譯
        if (translatedSubtitles.has(originalText)) {
            updateSubtitleDisplay(segment, translatedSubtitles.get(originalText));
            continue;
        }

        // 標記為處理中
        translatedSubtitles.set(originalText, null);

        try {
            // 呼叫翻譯 API
            const response = await chrome.runtime.sendMessage({
                action: 'translate',
                text: originalText,
                sourceLang: 'auto',
                targetLang: ytSettings.targetLang
            });

            if (response.success) {
                translatedSubtitles.set(originalText, response.translation);
                updateSubtitleDisplay(segment, response.translation);
            }
        } catch (error) {
            console.error('YouTube 字幕翻譯失敗:', error);
            translatedSubtitles.delete(originalText);
        }
    }
}

/**
 * 更新字幕顯示（雙語）
 */
function updateSubtitleDisplay(segment, translation) {
    if (!translation) return;

    // 檢查是否已有翻譯容器
    let translationEl = segment.querySelector('.tg-yt-translation');

    if (!translationEl) {
        // 建立翻譯容器
        translationEl = document.createElement('div');
        translationEl.className = 'tg-yt-translation';
        segment.appendChild(translationEl);

        // 添加樣式
        segment.style.display = 'flex';
        segment.style.flexDirection = 'column';
        segment.style.alignItems = 'center';
    }

    translationEl.textContent = translation;
}

/**
 * 添加 YouTube 專用樣式
 */
function addYouTubeStyles() {
    const style = document.createElement('style');
    style.textContent = `
        .tg-yt-translation {
            color: #ffeb3b;
            font-size: 0.85em;
            margin-top: 4px;
            text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.8);
            background: rgba(0, 0, 0, 0.5);
            padding: 2px 8px;
            border-radius: 4px;
        }
        
        .ytp-caption-segment {
            display: flex !important;
            flex-direction: column !important;
            align-items: center !important;
        }
    `;
    document.head.appendChild(style);
}

// 初始化
addYouTubeStyles();
initYouTube();

// 監聽來自 background 的訊息
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
