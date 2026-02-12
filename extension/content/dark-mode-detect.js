/**
 * TranslateGemma 深色模式偵測共用模組
 * 統一偵測網頁是否使用深色主題
 */

/**
 * 偵測當前頁面是否為深色背景
 * 檢查順序：
 * 1. HTML/Body 的 data 屬性與 class（常見 dark theme 標記）
 * 2. 作業系統 prefers-color-scheme
 * 3. 實際背景色 RGB 亮度計算
 * @returns {boolean} true 表示深色背景
 */
function isDarkBackground() {
    const html = document.documentElement;
    const body = document.body;

    // 1. 常見 dark mode 屬性偵測
    const darkAttrs = [
        html.getAttribute('data-color-mode'),
        html.getAttribute('data-theme'),
        html.getAttribute('data-dark-theme'),
        body?.getAttribute('data-theme'),
        body?.getAttribute('data-color-mode')
    ];

    for (const attr of darkAttrs) {
        if (attr && attr.toLowerCase().includes('dark')) return true;
    }

    // 檢查 class 名稱
    const allClasses = `${html.className || ''} ${body?.className || ''}`.toLowerCase();
    if (/\bdark\b/.test(allClasses) || /\btheme-dark\b/.test(allClasses) || /\bdark-mode\b/.test(allClasses)) {
        return true;
    }

    // 2. 作業系統偏好
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return true;
    }

    // 3. 實際背景色亮度計算
    try {
        const bgColor = getComputedStyle(body).backgroundColor;
        const luminance = getColorLuminance(bgColor);
        if (luminance !== null && luminance < 0.4) {
            return true;
        }
    } catch (e) {
        // 計算失敗時不影響功能
    }

    return false;
}

/**
 * 從 CSS 顏色值計算相對亮度 (0=黑, 1=白)
 * @param {string} color  - CSS 色值，如 'rgb(255, 255, 255)' 或 'rgba(0,0,0,0.5)'
 * @returns {number|null} 亮度值 0~1，解析失敗回傳 null
 */
function getColorLuminance(color) {
    if (!color || color === 'transparent' || color === 'rgba(0, 0, 0, 0)') return null;

    const match = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (!match) return null;

    const r = parseInt(match[1], 10) / 255;
    const g = parseInt(match[2], 10) / 255;
    const b = parseInt(match[3], 10) / 255;

    // 簡易亮度公式 (ITU-R BT.601)
    return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * 取得翻譯區塊的配色方案
 * @param {string} accentColor - 強調色（如 '#3ea6ff', '#36c', '#238636'）
 * @returns {{ textColor: string, bgColor: string, borderColor: string }}
 */
function getTranslationColors(accentColor = '#3ea6ff') {
    const dark = isDarkBackground();
    return {
        textColor: dark ? '#e6edf3' : '#1e3a5f',
        bgColor: dark
            ? `rgba(${hexToRgb(accentColor)}, 0.15)`
            : `rgba(${hexToRgb(accentColor)}, 0.08)`,
        borderColor: accentColor
    };
}

/**
 * 十六進位色碼轉 RGB 數值字串
 */
function hexToRgb(hex) {
    // 處理簡寫 #36c → #3366cc
    hex = hex.replace('#', '');
    if (hex.length === 3) {
        hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }
    const num = parseInt(hex, 16);
    return `${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}`;
}
