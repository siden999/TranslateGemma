/**
 * TranslateGemma 選取翻譯模組
 * 使用者選取文字後自動彈出翻譯氣泡
 */

// ============== 設定 ==============
let selectionSettings = {
    targetLang: 'zh-TW',
    selectionEnabled: true,
    translationMode: 'balanced',
    customGlossary: ''
};

let activePopup = null;

// ============== 初始化 ==============
async function initSelectionTranslate() {
    // 載入設定
    try {
        const response = await chrome.runtime.sendMessage({ action: 'getSettings' });
        if (response) {
            selectionSettings = { ...selectionSettings, ...response };
        }
    } catch (e) {
        // 設定載入失敗不影響功能
    }

    // 監聽滑鼠放開事件
    document.addEventListener('mouseup', handleMouseUp);

    // 點擊頁面其他地方關閉氣泡
    document.addEventListener('mousedown', (e) => {
        if (activePopup && !activePopup.contains(e.target)) {
            closePopup();
        }
    });

    // ESC 關閉氣泡
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && activePopup) {
            closePopup();
        }
    });

    // 監聽設定更新
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'updateSettings') {
            selectionSettings = { ...selectionSettings, ...request.settings };
            sendResponse({ success: true });
        }
    });

    console.log('✋ TranslateGemma 選取翻譯已載入');
}

// ============== 核心邏輯 ==============

function handleMouseUp(e) {
    if (!selectionSettings.selectionEnabled) return;

    // 延遲一點讓瀏覽器完成選取
    setTimeout(() => {
        const selection = window.getSelection();
        const text = selection?.toString().trim();

        // 至少 5 個字元才觸發
        if (!text || text.length < 5) return;

        // 跳過中文
        if (typeof isChinese === 'function' && isChinese(text)) return;

        // 避免選取到翻譯結果本身
        const anchorNode = selection.anchorNode;
        if (anchorNode) {
            const parent = anchorNode.parentElement;
            if (parent?.closest?.('.tg-selection-popup, [data-tg-translated]')) return;
        }

        // 關閉已有的氣泡
        closePopup();

        // 取得選取位置
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();

        // 建立翻譯氣泡
        showPopup(text, rect);
    }, 50);
}

function showPopup(text, rect) {
    const popup = document.createElement('div');
    popup.className = 'tg-selection-popup';

    // 計算位置 — 在選取文字上方顯示
    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;

    let top = rect.top + scrollY - 10; // 先放上方
    let left = rect.left + scrollX + (rect.width / 2) - 160; // 置中

    // 確保不超出畫面
    left = Math.max(10, Math.min(left, window.innerWidth - 340));

    popup.style.cssText = `
        position: absolute !important;
        top: ${top}px !important;
        left: ${left}px !important;
        z-index: 2147483647 !important;
    `;

    // Header
    const header = document.createElement('div');
    header.className = 'tg-popup-header';
    header.innerHTML = `
        <span class="tg-popup-icon">🌐</span>
        <span class="tg-popup-title">TranslateGemma</span>
    `;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'tg-popup-close';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closePopup();
    });
    header.appendChild(closeBtn);

    // Content — 先顯示載入中
    const content = document.createElement('div');
    content.className = 'tg-popup-content';
    content.textContent = '翻譯中...⏳';

    popup.appendChild(header);
    popup.appendChild(content);
    document.body.appendChild(popup);
    activePopup = popup;

    // 調整位置 — 如果上方空間不夠，改到下方
    const popupHeight = popup.offsetHeight;
    if (rect.top < popupHeight + 20) {
        popup.style.top = `${rect.bottom + scrollY + 10}px`;
    } else {
        popup.style.top = `${rect.top + scrollY - popupHeight - 10}px`;
    }

    // 發送翻譯請求
    translateSelection(text, content);
}

async function translateSelection(text, contentEl) {
    try {
        const response = await chrome.runtime.sendMessage({
            action: 'translate',
            text: text,
            sourceLang: 'auto',
            targetLang: selectionSettings.targetLang,
            options: {
                site: 'selection',
                contentType: 'selection',
                translationMode: selectionSettings.translationMode,
                glossary: String(selectionSettings.customGlossary || '')
                    .split(/\r?\n/)
                    .map(line => line.trim())
                    .filter(Boolean)
            }
        });

        if (response?.success && response.translation) {
            contentEl.textContent = response.translation;
        } else {
            contentEl.textContent = '翻譯失敗 ❌';
            contentEl.classList.add('tg-popup-error');
        }
    } catch (error) {
        contentEl.textContent = '翻譯服務未連線 ❌';
        contentEl.classList.add('tg-popup-error');
        console.error('❌ 選取翻譯錯誤:', error);
    }
}

function closePopup() {
    if (activePopup) {
        activePopup.remove();
        activePopup = null;
    }
}

// 啟動
initSelectionTranslate();
