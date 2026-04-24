(() => {
    if (window.TranslateGemmaDisplay) return;

    const DISPLAY_MODES = ['dual', 'translated', 'original'];
    const root = document.documentElement;

    function normalizeMode(mode) {
        return DISPLAY_MODES.includes(mode) ? mode : 'dual';
    }

    function apply(mode) {
        const next = normalizeMode(mode);
        root.dataset.tgDisplayMode = next;
        return next;
    }

    function markOriginal(el) {
        if (!el) return;
        el.dataset.tgDisplayRole = 'original';
        el.classList.add('tg-original-content');
    }

    function markTranslation(el) {
        if (!el) return;
        el.dataset.tgDisplayRole = 'translation';
        el.classList.add('tg-translation-block');
    }

    function getMode() {
        return normalizeMode(root.dataset.tgDisplayMode || 'dual');
    }

    function cycle() {
        const current = getMode();
        const index = DISPLAY_MODES.indexOf(current);
        const next = DISPLAY_MODES[(index + 1) % DISPLAY_MODES.length];
        apply(next);
        try {
            chrome.storage.sync.set({ displayMode: next });
        } catch (error) {
            console.warn('無法儲存顯示模式:', error);
        }
        return next;
    }

    try {
        chrome.storage.sync.get({ displayMode: 'dual' }, (settings) => {
            apply(settings.displayMode);
        });
    } catch (error) {
        apply('dual');
    }

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'toggleTranslation') {
            sendResponse({ success: true, displayMode: cycle() });
        }
        if (request.action === 'updateSettings' && request.settings?.displayMode) {
            apply(request.settings.displayMode);
        }
    });

    window.TranslateGemmaDisplay = {
        apply,
        cycle,
        getMode,
        markOriginal,
        markTranslation
    };
})();
