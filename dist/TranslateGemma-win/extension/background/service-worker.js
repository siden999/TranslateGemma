/**
 * TranslateGemma Background Service Worker
 * 負責與本地翻譯 API、控制服務、popup 狀態同步
 */

const API_BASE_URL = 'http://127.0.0.1:8080';
const CONTROL_BASE_URL = 'http://127.0.0.1:18181';
const NATIVE_HOST_NAME = 'com.translategemma.launcher';
const LAUNCHER_BOOT_TIMEOUT_MS = 15000;
const LAUNCHER_BOOT_POLL_MS = 500;

const translationCache = new Map();
const pageProgressByTab = new Map();
let lastLauncherFailure = null;

const DEFAULT_SETTINGS = {
    enabled: true,
    articleEnabled: true,
    wikipediaEnabled: true,
    githubEnabled: true,
    redditEnabled: true,
    selectionEnabled: true,
    targetLang: 'zh-TW',
    autoTranslate: true,
    translationMode: 'balanced',
    customGlossary: '',
    displayMode: 'dual'
};

async function checkServerHealth() {
    try {
        const response = await fetch(`${API_BASE_URL}/health`);
        const data = await response.json();
        return data.status === 'ok' && data.model_loaded;
    } catch (error) {
        console.debug('伺服器健康檢查未連線:', error);
        return false;
    }
}

function getPlatformInfo() {
    return new Promise((resolve) => {
        try {
            chrome.runtime.getPlatformInfo((info) => {
                resolve(info || { os: 'unknown' });
            });
        } catch (error) {
            resolve({ os: 'unknown' });
        }
    });
}

function buildDiagnosticDetail(errorMessage = '', context = {}) {
    const lines = [];
    const normalizedError = String(errorMessage || '');

    if (normalizedError) {
        lines.push(`詳細錯誤：${normalizedError}`);
    }
    if (context.previous_error && context.previous_error !== normalizedError) {
        lines.push(`前一次控制服務錯誤：${context.previous_error}`);
    }
    if (context.status) {
        lines.push(`橋接器狀態：${context.status}`);
    }
    if (context.log_path) {
        lines.push(`Launcher log：${context.log_path}`);
    }
    if (context.manifest_path) {
        lines.push(`Native Host manifest：${context.manifest_path}`);
    }
    if (context.launcher_log_tail) {
        lines.push(`Launcher 最近記錄：\n${context.launcher_log_tail}`);
    }

    return lines.join('\n');
}

async function buildLauncherFailure(errorMessage = '', context = {}) {
    const platform = await getPlatformInfo();
    const isWindows = platform.os === 'win';
    const installCommand = isWindows ? 'TranslateGemmaSetup.exe' : 'TranslateGemmaInstaller.command';
    const extensionPath = isWindows
        ? '%LOCALAPPDATA%\\TranslateGemma\\extension'
        : '~/Library/Application Support/TranslateGemma/extension';
    const logPath = isWindows
        ? '%LOCALAPPDATA%\\TranslateGemma\\launcher\\launcher.log'
        : '~/Library/Application Support/TranslateGemma/launcher/launcher.log';
    const normalizedError = String(errorMessage || '');
    const lowerError = normalizedError.toLowerCase();

    let statusText = 'Launcher 未回應';
    let startupMessage = `請先重新執行 ${installCommand}，再到 chrome://extensions 移除舊版 TranslateGemma 後載入 ${extensionPath}。`;

    if (lowerError.includes('specified native messaging host not found')
        || lowerError.includes('native host has exited')
        || lowerError.includes('host not found')) {
        statusText = '啟動橋接器未安裝';
        startupMessage = `找不到本機啟動橋接器。請重新執行 ${installCommand}，再到 chrome://extensions 移除舊版 TranslateGemma 後載入 ${extensionPath}。`;
    } else if (lowerError.includes('forbidden')) {
        statusText = '擴充版本與安裝內容不一致';
        startupMessage = `目前載入的擴充功能不能存取已安裝的 Launcher。請在 chrome://extensions 移除舊版 TranslateGemma 後載入 ${extensionPath}。`;
    } else if (lowerError.includes('returned no response')) {
        statusText = '啟動橋接器無回應';
        startupMessage = `本機啟動橋接器沒有回傳結果。請重新執行 ${installCommand}，再到 chrome://extensions 移除舊版 TranslateGemma 後載入 ${extensionPath}。`;
    } else if (lowerError.includes('failed to start native messaging host')) {
        statusText = '啟動橋接器無法執行';
        startupMessage = `Chrome 找到橋接器但無法執行。請重新執行 ${installCommand}；若仍失敗，查看 ${logPath}。`;
    } else if (lowerError.includes('did not become reachable')) {
        statusText = 'Launcher 啟動逾時';
        startupMessage = `已嘗試喚起 Launcher，但控制服務仍未回應。請查看 ${logPath}。`;
    } else if (lowerError.includes('failed to fetch')
        || lowerError.includes('couldn\'t connect')
        || lowerError.includes('could not establish connection')) {
        statusText = 'Launcher 未啟動';
        startupMessage = `按下啟動後仍無法連到本機 Launcher。請先重新執行 ${installCommand}；若仍失敗，查看 ${logPath}。`;
    }

    return {
        statusText,
        startupMessage,
        detailText: buildDiagnosticDetail(normalizedError, context),
        headerText: statusText,
        memoryText: '模型未載入',
        platform: platform.os,
        logPath,
        extensionPath
    };
}

async function rememberLauncherFailure(errorMessage = '', context = {}) {
    lastLauncherFailure = await buildLauncherFailure(errorMessage, context);
    return lastLauncherFailure;
}

function clearLauncherFailure() {
    lastLauncherFailure = null;
}

async function getControlStatus() {
    try {
        const response = await fetch(`${CONTROL_BASE_URL}/status`);
        if (!response.ok) {
            const error = `Control API 錯誤: ${response.status}`;
            const diagnostics = await rememberLauncherFailure(error);
            return { ok: false, error, diagnostics };
        }
        const data = await response.json();
        clearLauncherFailure();
        return { ok: true, data };
    } catch (error) {
        console.warn('控制服務狀態取得失敗:', error);
        return {
            ok: false,
            error: error.message,
            diagnostics: lastLauncherFailure || await rememberLauncherFailure(error.message)
        };
    }
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendNativeHostMessage(message) {
    return new Promise((resolve) => {
        try {
            chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, message, (response) => {
                if (chrome.runtime.lastError) {
                    resolve({ ok: false, error: chrome.runtime.lastError.message });
                    return;
                }
                resolve(response || { ok: false, error: 'Native host returned no response' });
            });
        } catch (error) {
            resolve({ ok: false, error: error.message });
        }
    });
}

async function ensureLauncherAvailable(timeoutMs = LAUNCHER_BOOT_TIMEOUT_MS) {
    const existingStatus = await getControlStatus();
    if (existingStatus?.ok) {
        clearLauncherFailure();
        return { ok: true, data: existingStatus.data, launched: false };
    }

    const bridgeResult = await sendNativeHostMessage({
        action: 'ensure_launcher',
        timeout_ms: timeoutMs
    });
    if (!bridgeResult?.ok) {
        const error = bridgeResult?.error || existingStatus?.error || 'Failed to start Launcher via native host';
        const diagnostics = await rememberLauncherFailure(error, {
            ...bridgeResult,
            previous_error: existingStatus?.error
        });
        return {
            ok: false,
            error,
            diagnostics
        };
    }

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const status = await getControlStatus();
        if (status?.ok) {
            clearLauncherFailure();
            return { ok: true, data: status.data, launched: true };
        }
        await wait(LAUNCHER_BOOT_POLL_MS);
    }

    const diagnostics = await rememberLauncherFailure(
        bridgeResult?.error || 'Launcher did not become reachable in time',
        {
            ...bridgeResult,
            previous_error: existingStatus?.error
        }
    );
    return {
        ok: false,
        error: bridgeResult?.error || 'Launcher did not become reachable in time',
        diagnostics
    };
}

async function postStartServer() {
    const response = await fetch(`${CONTROL_BASE_URL}/start`, { method: 'POST' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data?.error || `Control API 錯誤: ${response.status}`);
    }
    return { ok: true, data };
}

async function startServer() {
    try {
        const result = await postStartServer();
        clearLauncherFailure();
        return result;
    } catch (error) {
        console.error('啟動伺服器失敗，嘗試喚起 Launcher:', error);
        const launcherResult = await ensureLauncherAvailable();
        if (!launcherResult?.ok) {
            return {
                ok: false,
                error: launcherResult?.error || error.message,
                diagnostics: launcherResult?.diagnostics || lastLauncherFailure
            };
        }

        try {
            const result = await postStartServer();
            clearLauncherFailure();
            return result;
        } catch (retryError) {
            console.error('Launcher 喚起後仍無法啟動伺服器:', retryError);
            return {
                ok: false,
                error: retryError.message,
                diagnostics: await rememberLauncherFailure(retryError.message)
            };
        }
    }
}

async function stopServer() {
    try {
        const response = await fetch(`${CONTROL_BASE_URL}/stop`, { method: 'POST' });
        const data = await response.json();
        return { ok: true, data };
    } catch (error) {
        console.error('停止伺服器失敗:', error);
        return { ok: false, error: error.message };
    }
}

async function postControlJSON(path, payload = {}) {
    const response = await fetch(`${CONTROL_BASE_URL}${path}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });
    const data = await response.json();
    return { ok: response.ok, data };
}

async function updateRuntimeConfig(payload = {}) {
    try {
        return await postControlJSON('/runtime_config', payload);
    } catch (error) {
        console.error('更新 runtime 設定失敗:', error);
        return { ok: false, error: error.message };
    }
}

async function deleteModel(payload = {}) {
    try {
        return await postControlJSON('/delete_model', payload);
    } catch (error) {
        console.error('刪除模型失敗:', error);
        return { ok: false, error: error.message };
    }
}

function broadcastServerStarted() {
    chrome.tabs.query({ url: ['*://*.youtube.com/*'] }, (tabs) => {
        if (chrome.runtime.lastError) {
            console.warn('無法取得分頁清單:', chrome.runtime.lastError.message);
            return;
        }
        tabs.forEach((tab) => {
            if (!tab?.id) return;
            chrome.tabs.sendMessage(tab.id, { action: 'serverStarted' }, () => {
                if (chrome.runtime.lastError) {
                    return;
                }
            });
        });
    });
}

function parseGlossary(glossary) {
    if (Array.isArray(glossary)) {
        return glossary
            .map((line) => String(line || '').trim())
            .filter(Boolean)
            .slice(0, 100);
    }
    return String(glossary || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 100);
}

function normalizeTranslateOptions(options = {}) {
    const translationMode = ['speed', 'balanced', 'quality'].includes(options.translationMode)
        ? options.translationMode
        : 'balanced';
    return {
        site: String(options.site || 'generic').toLowerCase(),
        contentType: String(options.contentType || options.content_type || 'text').toLowerCase(),
        contentTypes: Array.isArray(options.contentTypes)
            ? options.contentTypes.map((value) => String(value || 'text').toLowerCase())
            : [],
        translationMode,
        preserveFormatting: Boolean(options.preserveFormatting ?? options.preserve_formatting),
        glossary: parseGlossary(options.glossary)
    };
}

function getContentTypeForIndex(options, index) {
    if (Array.isArray(options.contentTypes) && options.contentTypes[index]) {
        return options.contentTypes[index];
    }
    return options.contentType || 'text';
}

function buildCacheKey(text, sourceLang, targetLang, options, contentType) {
    return JSON.stringify([
        sourceLang,
        targetLang,
        options.site,
        contentType,
        options.translationMode,
        options.preserveFormatting ? 1 : 0,
        options.glossary.join('|'),
        text
    ]);
}

async function requestTranslate(text, sourceLang, targetLang, options = {}) {
    const normalizedOptions = normalizeTranslateOptions(options);
    const response = await fetch(`${API_BASE_URL}/translate`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            text,
            source_lang: sourceLang,
            target_lang: targetLang,
            site: normalizedOptions.site,
            content_type: normalizedOptions.contentType,
            translation_mode: normalizedOptions.translationMode,
            preserve_formatting: normalizedOptions.preserveFormatting,
            glossary: normalizedOptions.glossary
        })
    });

    if (!response.ok) {
        throw new Error(`API 錯誤: ${response.status}`);
    }

    const data = await response.json();
    return data.translation;
}

async function requestTranslateBatch(texts, sourceLang, targetLang, options = {}) {
    const normalizedOptions = normalizeTranslateOptions(options);
    const response = await fetch(`${API_BASE_URL}/translate_batch`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            texts,
            source_lang: sourceLang,
            target_lang: targetLang,
            site: normalizedOptions.site,
            content_types: normalizedOptions.contentTypes,
            translation_mode: normalizedOptions.translationMode,
            preserve_formatting: normalizedOptions.preserveFormatting,
            glossary: normalizedOptions.glossary
        })
    });

    if (!response.ok) {
        throw new Error(`API 錯誤: ${response.status}`);
    }

    return response.json();
}

async function getCacheStatsFromServer() {
    const response = await fetch(`${API_BASE_URL}/cache_stats`);
    if (!response.ok) {
        throw new Error(`API 錯誤: ${response.status}`);
    }
    return response.json();
}

async function clearServerCache() {
    const response = await fetch(`${API_BASE_URL}/cache_clear`, {
        method: 'POST'
    });
    if (!response.ok) {
        throw new Error(`API 錯誤: ${response.status}`);
    }
    return response.json();
}

async function translateText(text, sourceLang = 'auto', targetLang = 'zh-TW', options = {}) {
    const normalizedOptions = normalizeTranslateOptions(options);
    const cacheKey = buildCacheKey(
        text,
        sourceLang,
        targetLang,
        normalizedOptions,
        normalizedOptions.contentType
    );
    if (translationCache.has(cacheKey)) {
        return translationCache.get(cacheKey);
    }

    const translation = await requestTranslate(text, sourceLang, targetLang, normalizedOptions);
    translationCache.set(cacheKey, translation);
    return translation;
}

async function translateBatch(texts, sourceLang = 'auto', targetLang = 'zh-TW', options = {}) {
    if (!Array.isArray(texts) || texts.length === 0) return [];

    const normalizedOptions = normalizeTranslateOptions(options);
    const results = new Array(texts.length).fill(null);
    const pendingTexts = [];
    const pendingKeys = [];
    const pendingContentTypes = [];
    const indexGroups = new Map();

    texts.forEach((text, index) => {
        const normalizedText = String(text || '');
        const contentType = getContentTypeForIndex(normalizedOptions, index);
        const cacheKey = buildCacheKey(
            normalizedText,
            sourceLang,
            targetLang,
            normalizedOptions,
            contentType
        );
        if (translationCache.has(cacheKey)) {
            results[index] = translationCache.get(cacheKey);
            return;
        }
        if (!indexGroups.has(cacheKey)) {
            indexGroups.set(cacheKey, []);
            pendingTexts.push(normalizedText);
            pendingKeys.push(cacheKey);
            pendingContentTypes.push(contentType);
        }
        indexGroups.get(cacheKey).push(index);
    });

    if (pendingTexts.length === 0) {
        return results;
    }

    let translations;
    if (pendingTexts.length === 1) {
        translations = [
            await requestTranslate(pendingTexts[0], sourceLang, targetLang, {
                ...normalizedOptions,
                contentType: pendingContentTypes[0]
            })
        ];
    } else {
        const data = await requestTranslateBatch(pendingTexts, sourceLang, targetLang, {
            ...normalizedOptions,
            contentTypes: pendingContentTypes
        });
        translations = Array.isArray(data.translations) ? data.translations : [];
    }

    pendingKeys.forEach((cacheKey, index) => {
        const translation = translations[index] || '';
        translationCache.set(cacheKey, translation);
        const matchedIndexes = indexGroups.get(cacheKey) || [];
        matchedIndexes.forEach((resultIndex) => {
            results[resultIndex] = translation;
        });
    });

    return results;
}

function sanitizeProgress(progress = {}) {
    const total = Math.max(0, Number(progress.total) || 0);
    const completed = Math.max(0, Number(progress.completed) || 0);
    const failed = Math.max(0, Number(progress.failed) || 0);
    const pending = Math.max(
        0,
        Number.isFinite(Number(progress.pending))
            ? Number(progress.pending)
            : total - completed - failed
    );
    return {
        site: String(progress.site || 'generic'),
        label: String(progress.label || '頁面翻譯'),
        status: String(progress.status || (total ? 'running' : 'idle')),
        total,
        completed,
        failed,
        pending,
        detail: String(progress.detail || ''),
        updatedAt: Date.now()
    };
}

function setPageProgress(tabId, progress) {
    if (!tabId) return;
    const next = sanitizeProgress(progress);
    if (next.status === 'idle' && next.total === 0 && !next.detail) {
        pageProgressByTab.delete(tabId);
        return;
    }
    pageProgressByTab.set(tabId, next);
}

function clearPageProgress(tabId) {
    if (!tabId) return;
    pageProgressByTab.delete(tabId);
}

function getSenderTabId(sender) {
    return sender?.tab?.id || null;
}

function getActiveTabId() {
    return new Promise((resolve) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            resolve(tabs?.[0]?.id || null);
        });
    });
}

function getStoredSettings() {
    return new Promise((resolve) => {
        chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
            resolve(settings);
        });
    });
}

function saveStoredSettings(settings) {
    return new Promise((resolve) => {
        chrome.storage.sync.set(settings, () => resolve({ success: true }));
    });
}

chrome.tabs.onRemoved.addListener((tabId) => {
    clearPageProgress(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading') {
        clearPageProgress(tabId);
    }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'translate') {
        translateText(request.text, request.sourceLang, request.targetLang, request.options)
            .then((translation) => {
                sendResponse({ success: true, translation });
            })
            .catch((error) => {
                sendResponse({ success: false, error: error.message });
            });
        return true;
    }

    if (request.action === 'translateBatch') {
        translateBatch(request.texts, request.sourceLang, request.targetLang, request.options)
            .then((translations) => {
                sendResponse({ success: true, translations });
            })
            .catch((error) => {
                sendResponse({ success: false, error: error.message });
            });
        return true;
    }

    if (request.action === 'checkHealth') {
        checkServerHealth().then((healthy) => {
            sendResponse({ healthy });
        });
        return true;
    }

    if (request.action === 'getServerStatus') {
        getControlStatus().then((result) => {
            sendResponse(result);
        });
        return true;
    }

    if (request.action === 'startServer') {
        startServer().then((result) => {
            if (result?.ok) {
                broadcastServerStarted();
            }
            sendResponse(result);
        });
        return true;
    }

    if (request.action === 'stopServer') {
        stopServer().then((result) => {
            sendResponse(result);
        });
        return true;
    }

    if (request.action === 'getSettings') {
        getStoredSettings().then((settings) => {
            sendResponse(settings);
        });
        return true;
    }

    if (request.action === 'saveSettings') {
        saveStoredSettings(request.settings || {}).then((result) => {
            sendResponse(result);
        });
        return true;
    }

    if (request.action === 'updateRuntimeConfig') {
        updateRuntimeConfig(request.payload || {})
            .then((result) => {
                if (result?.ok && request.payload?.restart_if_running) {
                    broadcastServerStarted();
                }
                sendResponse(result);
            })
            .catch((error) => {
                sendResponse({ ok: false, error: error.message });
            });
        return true;
    }

    if (request.action === 'deleteModel') {
        deleteModel(request.payload || {})
            .then((result) => {
                sendResponse(result);
            })
            .catch((error) => {
                sendResponse({ ok: false, error: error.message });
            });
        return true;
    }

    if (request.action === 'getCacheStats') {
        getCacheStatsFromServer()
            .then((stats) => {
                sendResponse({ success: true, stats });
            })
            .catch((error) => {
                sendResponse({ success: false, error: error.message });
            });
        return true;
    }

    if (request.action === 'clearCache') {
        clearServerCache()
            .then((stats) => {
                translationCache.clear();
                sendResponse({ success: true, stats });
            })
            .catch((error) => {
                sendResponse({ success: false, error: error.message });
            });
        return true;
    }

    if (request.action === 'updatePageProgress') {
        const tabId = getSenderTabId(sender);
        setPageProgress(tabId, request.progress);
        sendResponse({ success: true });
        return false;
    }

    if (request.action === 'clearPageProgress') {
        const tabId = getSenderTabId(sender);
        clearPageProgress(tabId);
        sendResponse({ success: true });
        return false;
    }

    if (request.action === 'getPageProgress') {
        (async () => {
            const tabId = typeof request.tabId === 'number'
                ? request.tabId
                : (getSenderTabId(sender) || await getActiveTabId());
            sendResponse({
                success: true,
                progress: tabId ? (pageProgressByTab.get(tabId) || null) : null
            });
        })();
        return true;
    }
});

chrome.commands.onCommand.addListener((command) => {
    if (command === 'toggle-translation') {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, { action: 'toggleTranslation' });
            }
        });
    }
});

console.log('TranslateGemma Background Service Worker 已啟動');
