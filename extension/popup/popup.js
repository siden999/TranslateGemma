/**
 * TranslateGemma Popup JavaScript
 * 處理使用者互動、快取管理、頁面進度、模型與 runtime 管理
 */

const statusDot = document.querySelector('.status-dot');
const statusText = document.querySelector('.status-text');
const enableToggle = document.getElementById('enableToggle');
const articleToggle = document.getElementById('articleToggle');
const wikipediaToggle = document.getElementById('wikipediaToggle');
const githubToggle = document.getElementById('githubToggle');
const redditToggle = document.getElementById('redditToggle');
const selectionToggle = document.getElementById('selectionToggle');
const targetLang = document.getElementById('targetLang');
const translationMode = document.getElementById('translationMode');
const displayMode = document.getElementById('displayMode');
const glossaryInput = document.getElementById('glossaryInput');
const serverStatusText = document.getElementById('serverStatusText');
const serverToggle = document.getElementById('serverToggle');
const memoryStatusText = document.getElementById('memoryStatusText');
const modelInfoText = document.getElementById('modelInfoText');
const startupNoteText = document.getElementById('startupNoteText');
const downloadProgressTrack = document.getElementById('downloadProgressTrack');
const downloadProgressBar = document.getElementById('downloadProgressBar');
const downloadProgressText = document.getElementById('downloadProgressText');
const cacheStatsText = document.getElementById('cacheStatsText');
const clearCacheButton = document.getElementById('clearCacheButton');
const pageProgressCard = document.getElementById('pageProgressCard');
const pageProgressTitle = document.getElementById('pageProgressTitle');
const pageProgressSite = document.getElementById('pageProgressSite');
const pageProgressSummary = document.getElementById('pageProgressSummary');
const pageProgressTrack = document.getElementById('pageProgressTrack');
const pageProgressBar = document.getElementById('pageProgressBar');
const pageProgressText = document.getElementById('pageProgressText');
const modelVariant = document.getElementById('modelVariant');
const nCtxInput = document.getElementById('nCtxInput');
const nGpuLayersInput = document.getElementById('nGpuLayersInput');
const nThreadsInput = document.getElementById('nThreadsInput');
const applyRuntimeButton = document.getElementById('applyRuntimeButton');
const deleteModelButton = document.getElementById('deleteModelButton');
const runtimeBackendPill = document.getElementById('runtimeBackendPill');
const runtimeInfoText = document.getElementById('runtimeInfoText');
const runtimeStatusText = document.getElementById('runtimeStatusText');

function setHeaderStatus(state, text) {
    statusDot.classList.remove('online', 'offline');
    if (state === 'online') {
        statusDot.classList.add('online');
    } else if (state === 'offline') {
        statusDot.classList.add('offline');
    }
    statusText.textContent = text;
}

function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }
    const digits = value >= 10 || unitIndex === 0 ? 0 : 1;
    return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

function safeSetValue(el, value) {
    if (!el) return;
    if (document.activeElement === el) return;
    el.value = String(value ?? '');
}

function renderStartupStatus(data = {}) {
    const model = data.model || {};
    const startup = data.startup || {};
    const totalBytes = startup.total_bytes || model.download_size_bytes || 0;
    const downloadedBytes = startup.downloaded_bytes || 0;
    const progressPercent = startup.progress_percent;
    const modelLabel = model.display_name || 'TranslateGemma 4B (Q4_K_M)';
    const downloadSizeLabel = totalBytes ? `約 ${formatBytes(totalBytes)}` : '首次啟動需下載';

    if (modelInfoText) {
        modelInfoText.textContent = `模型：${modelLabel}，首次下載 ${downloadSizeLabel}`;
    }

    if (startupNoteText) {
        startupNoteText.textContent = startup.message || '首次啟動需下載模型，可能需要幾分鐘。';
    }

    if (!downloadProgressTrack || !downloadProgressBar || !downloadProgressText) return;

    const shouldShowProgress = startup.phase === 'downloading' || startup.phase === 'loading';
    downloadProgressTrack.hidden = !shouldShowProgress;

    if (!shouldShowProgress) {
        downloadProgressBar.style.width = startup.model_exists ? '100%' : '0%';
        if (startup.phase === 'ready') {
            downloadProgressText.textContent = '模型已就緒';
        } else if (startup.model_exists) {
            downloadProgressText.textContent = '模型已下載，等待啟動';
        } else {
            downloadProgressText.textContent = '首次啟動會先下載模型到本機';
        }
        return;
    }

    if (startup.phase === 'downloading') {
        const progressLabel = progressPercent != null ? `${progressPercent}%` : '下載中';
        downloadProgressBar.style.width = progressPercent != null ? `${progressPercent}%` : '8%';
        downloadProgressText.textContent = totalBytes
            ? `已下載 ${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)} (${progressLabel})`
            : `已下載 ${formatBytes(downloadedBytes)}`;
        return;
    }

    downloadProgressBar.style.width = '100%';
    downloadProgressText.textContent = '下載完成，正在載入模型到記憶體';
}

function renderCacheStats(stats) {
    if (!cacheStatsText) return;
    if (!stats) {
        cacheStatsText.textContent = '伺服器啟動後可查看快取統計。';
        return;
    }
    cacheStatsText.textContent = `快取 ${stats.entries} 筆，命中 ${stats.hits} 次，資料庫 ${formatBytes(stats.db_size_bytes)}`;
}

function renderPageProgress(progress) {
    if (!pageProgressCard || !pageProgressTrack || !pageProgressBar || !pageProgressTitle || !pageProgressSite || !pageProgressSummary || !pageProgressText) return;
    if (!progress || !progress.total) {
        pageProgressCard.hidden = true;
        return;
    }

    const done = (progress.completed || 0) + (progress.failed || 0);
    const total = progress.total || 0;
    const percent = total ? Math.max(0, Math.min(100, Math.round((done / total) * 100))) : 0;

    pageProgressCard.hidden = false;
    pageProgressTitle.textContent = progress.label || '目前頁面';
    pageProgressSite.textContent = progress.site || 'generic';
    pageProgressSummary.textContent = progress.detail || '翻譯進行中';
    pageProgressTrack.hidden = false;
    pageProgressBar.style.width = `${percent}%`;
    pageProgressText.textContent = `已完成 ${progress.completed || 0} / ${total}，失敗 ${progress.failed || 0}，剩餘 ${progress.pending || 0}`;
}

function renderRuntimePanel(data) {
    if (!runtimeBackendPill || !runtimeInfoText || !runtimeStatusText || !modelVariant || !nCtxInput || !nGpuLayersInput || !nThreadsInput) {
        return;
    }
    const runtime = data?.runtime || {};
    const config = runtime.config || {};
    const models = Array.isArray(data?.models) ? data.models : [];
    const activeMode = runtime.active_mode || data?.mode || runtime.backend_hint || '待偵測';
    const selectedModel = data?.model || models.find((item) => item.selected) || null;

    runtimeBackendPill.textContent = activeMode || '待偵測';
    runtimeInfoText.textContent = selectedModel
        ? `${selectedModel.display_name}，${selectedModel.description || '可切換速度與品質'}`
        : '可切換量化模型並調整推論參數。';
    runtimeStatusText.textContent = data
        ? '量化影響速度與品質；n_ctx 越大越吃記憶體；n_gpu_layers 設 -1 通常最快。'
        : 'Launcher 未連線，暫時無法調整 runtime。';

    if (!models.length) {
        modelVariant.innerHTML = '<option value="q4_k_m">TranslateGemma 4B (Q4_K_M)</option>';
        return;
    }

    const currentOptions = Array.from(modelVariant.options).map((option) => option.value).join('|');
    const nextOptions = models.map((model) => model.key).join('|');
    if (currentOptions !== nextOptions) {
        modelVariant.innerHTML = '';
        models.forEach((model) => {
            const option = document.createElement('option');
            const installedLabel = model.installed ? '已下載' : '未下載';
            option.value = model.key;
            option.textContent = `${model.display_name} · ${installedLabel}`;
            modelVariant.appendChild(option);
        });
    }

    safeSetValue(modelVariant, config.model_key || selectedModel?.key || 'q4_k_m');
    safeSetValue(nCtxInput, config.n_ctx || 2048);
    safeSetValue(nGpuLayersInput, config.n_gpu_layers ?? -1);
    safeSetValue(nThreadsInput, config.n_threads ?? 0);
}

async function checkServerStatus() {
    try {
        const response = await chrome.runtime.sendMessage({ action: 'getServerStatus' });
        if (response?.ok) {
            const data = response.data || {};
            const startup = data.startup || {};
            if (data.server_ready) {
                setHeaderStatus('online', '伺服器運作中');
            } else if (data.server_running) {
                const pendingText = startup.phase === 'downloading' ? '下載模型中' : '模型準備中';
                setHeaderStatus('pending', pendingText);
            } else {
                setHeaderStatus('offline', '伺服器離線');
            }
            return;
        }

        const health = await chrome.runtime.sendMessage({ action: 'checkHealth' });
        if (health.healthy) {
            setHeaderStatus('online', '伺服器運作中');
        } else {
            setHeaderStatus('offline', '伺服器離線');
        }
    } catch (error) {
        setHeaderStatus('offline', '連線失敗');
    }
}

async function loadSettings() {
    try {
        const settings = await chrome.runtime.sendMessage({ action: 'getSettings' });
        if (enableToggle) enableToggle.checked = settings.enabled;
        if (articleToggle) articleToggle.checked = settings.articleEnabled !== false;
        if (wikipediaToggle) wikipediaToggle.checked = settings.wikipediaEnabled !== false;
        if (githubToggle) githubToggle.checked = settings.githubEnabled !== false;
        if (redditToggle) redditToggle.checked = settings.redditEnabled !== false;
        if (selectionToggle) selectionToggle.checked = settings.selectionEnabled !== false;
        if (targetLang) targetLang.value = settings.targetLang || 'zh-TW';
        if (translationMode) translationMode.value = settings.translationMode || 'balanced';
        if (displayMode) displayMode.value = settings.displayMode || 'dual';
        if (glossaryInput) glossaryInput.value = settings.customGlossary || '';
    } catch (error) {
        console.error('載入設定失敗:', error);
    }
}

async function saveSettings() {
    const settings = {
        enabled: enableToggle ? enableToggle.checked : true,
        articleEnabled: articleToggle ? articleToggle.checked : true,
        wikipediaEnabled: wikipediaToggle ? wikipediaToggle.checked : true,
        githubEnabled: githubToggle ? githubToggle.checked : true,
        redditEnabled: redditToggle ? redditToggle.checked : true,
        selectionEnabled: selectionToggle ? selectionToggle.checked : true,
        targetLang: targetLang ? targetLang.value : 'zh-TW',
        translationMode: translationMode ? translationMode.value : 'balanced',
        displayMode: displayMode ? displayMode.value : 'dual',
        customGlossary: glossaryInput ? glossaryInput.value : ''
    };

    try {
        await chrome.runtime.sendMessage({
            action: 'saveSettings',
            settings
        });

        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) {
            chrome.tabs.sendMessage(tab.id, {
                action: 'updateSettings',
                settings
            }, () => {
                void chrome.runtime.lastError;
            });
        }
    } catch (error) {
        console.error('儲存設定失敗:', error);
    }
}

async function refreshControlStatus() {
    if (!serverStatusText || !serverToggle) return;
    serverToggle.disabled = true;
    serverStatusText.textContent = '檢查中...';
    if (memoryStatusText) {
        memoryStatusText.textContent = '模型狀態檢查中...';
    }

    try {
        const response = await chrome.runtime.sendMessage({ action: 'getServerStatus' });
        if (!response?.ok) {
            serverStatusText.textContent = 'Launcher 未啟動';
            serverToggle.textContent = '啟動';
            serverToggle.classList.remove('stop');
            serverToggle.disabled = false;
            serverToggle.dataset.state = 'stopped';
            if (memoryStatusText) {
                memoryStatusText.textContent = '模型未載入';
            }
            renderStartupStatus();
            renderCacheStats(null);
            renderRuntimePanel(null);
            setHeaderStatus('offline', 'Launcher 未啟動');
            return;
        }

        const data = response.data || {};
        const running = !!data.server_running;
        const ready = !!data.server_ready;
        const mode = data.mode ? ` (${data.mode})` : '';
        const startup = data.startup || {};
        renderStartupStatus(data);
        renderRuntimePanel(data);

        if (running) {
            if (ready) {
                serverStatusText.textContent = `運行中${mode}`;
                setHeaderStatus('online', '伺服器運作中');
            } else if (startup.phase === 'downloading') {
                serverStatusText.textContent = '首次啟動下載模型中';
                setHeaderStatus('pending', '下載模型中');
            } else if (startup.phase === 'loading') {
                serverStatusText.textContent = `模型載入中${mode}`;
                setHeaderStatus('pending', '模型載入中');
            } else {
                serverStatusText.textContent = `啟動中${mode}`;
                setHeaderStatus('pending', '模型準備中');
            }
            serverToggle.textContent = '暫停';
            serverToggle.classList.add('stop');
            serverToggle.dataset.state = 'running';
            if (memoryStatusText) {
                memoryStatusText.textContent = ready
                    ? `模型已載入 ${mode}`.trim()
                    : (startup.message || '模型載入中...');
            }
        } else {
            serverStatusText.textContent = '已停止（預設關閉）';
            serverToggle.textContent = '啟動';
            serverToggle.classList.remove('stop');
            serverToggle.dataset.state = 'stopped';
            if (memoryStatusText) {
                memoryStatusText.textContent = startup.model_exists
                    ? '模型已下載，記憶體已釋放'
                    : '首次啟動需下載模型';
            }
            setHeaderStatus('offline', '伺服器離線');
        }
        serverToggle.disabled = false;
    } catch (error) {
        serverStatusText.textContent = '狀態取得失敗';
        serverToggle.textContent = '啟動';
        serverToggle.classList.remove('stop');
        serverToggle.disabled = false;
        serverToggle.dataset.state = 'stopped';
        if (memoryStatusText) {
            memoryStatusText.textContent = '模型狀態未知';
        }
        renderStartupStatus();
        renderCacheStats(null);
        renderRuntimePanel(null);
        setHeaderStatus('offline', '狀態取得失敗');
    }
}

async function refreshCacheStats() {
    try {
        const response = await chrome.runtime.sendMessage({ action: 'getCacheStats' });
        if (response?.success) {
            renderCacheStats(response.stats);
        } else {
            renderCacheStats(null);
        }
    } catch (error) {
        renderCacheStats(null);
    }
}

async function refreshPageProgress() {
    try {
        const response = await chrome.runtime.sendMessage({ action: 'getPageProgress' });
        renderPageProgress(response?.success ? response.progress : null);
    } catch (error) {
        renderPageProgress(null);
    }
}

async function handleServerToggle() {
    if (!serverToggle) return;
    serverToggle.disabled = true;
    const isRunning = serverToggle.dataset.state === 'running';

    if (isRunning) {
        await chrome.runtime.sendMessage({ action: 'stopServer' });
    } else {
        await chrome.runtime.sendMessage({ action: 'startServer' });
    }

    await refreshControlStatus();
    await checkServerStatus();
    await refreshCacheStats();
}

async function handleApplyRuntime() {
    applyRuntimeButton.disabled = true;
    runtimeStatusText.textContent = '正在套用 runtime 設定...';
    try {
        const response = await chrome.runtime.sendMessage({
            action: 'updateRuntimeConfig',
            payload: {
                model_key: modelVariant.value,
                n_ctx: Number(nCtxInput.value || 2048),
                n_gpu_layers: Number(nGpuLayersInput.value || -1),
                n_threads: Number(nThreadsInput.value || 0),
                restart_if_running: true
            }
        });

        if (response?.ok) {
            runtimeStatusText.textContent = 'Runtime 設定已儲存，運行中的伺服器已重新套用。';
            renderRuntimePanel(response.data || null);
            await refreshControlStatus();
            await checkServerStatus();
        } else {
            runtimeStatusText.textContent = `套用失敗：${response?.error || '未知錯誤'}`;
        }
    } catch (error) {
        runtimeStatusText.textContent = `套用失敗：${error.message}`;
    } finally {
        applyRuntimeButton.disabled = false;
    }
}

async function handleDeleteModel() {
    deleteModelButton.disabled = true;
    runtimeStatusText.textContent = '正在刪除模型檔...';
    try {
        const response = await chrome.runtime.sendMessage({
            action: 'deleteModel',
            payload: {
                model_key: modelVariant.value
            }
        });

        if (response?.ok) {
            runtimeStatusText.textContent = '模型檔已刪除，下次啟動會重新下載。';
            renderRuntimePanel(response.data || null);
            await refreshControlStatus();
            await checkServerStatus();
        } else {
            runtimeStatusText.textContent = `刪除失敗：${response?.error || '未知錯誤'}`;
        }
    } catch (error) {
        runtimeStatusText.textContent = `刪除失敗：${error.message}`;
    } finally {
        deleteModelButton.disabled = false;
    }
}

async function handleClearCache() {
    if (!clearCacheButton) return;
    clearCacheButton.disabled = true;
    cacheStatsText.textContent = '正在清除快取...';
    try {
        const response = await chrome.runtime.sendMessage({ action: 'clearCache' });
        if (response?.success) {
            renderCacheStats(response.stats);
        } else {
            cacheStatsText.textContent = '清除失敗，請先確認伺服器已啟動。';
        }
    } catch (error) {
        cacheStatsText.textContent = '清除失敗，請先確認伺服器已啟動。';
    } finally {
        clearCacheButton.disabled = false;
    }
}

function debounce(fn, wait) {
    let timer = null;
    return (...args) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => fn(...args), wait);
    };
}

function bindEvents() {
    const saveSettingsDebounced = debounce(saveSettings, 350);

    if (enableToggle) enableToggle.addEventListener('change', saveSettings);
    if (articleToggle) articleToggle.addEventListener('change', saveSettings);
    if (wikipediaToggle) wikipediaToggle.addEventListener('change', saveSettings);
    if (githubToggle) githubToggle.addEventListener('change', saveSettings);
    if (redditToggle) redditToggle.addEventListener('change', saveSettings);
    if (selectionToggle) selectionToggle.addEventListener('change', saveSettings);
    if (targetLang) targetLang.addEventListener('change', saveSettings);
    if (translationMode) translationMode.addEventListener('change', saveSettings);
    if (displayMode) displayMode.addEventListener('change', saveSettings);
    if (glossaryInput) glossaryInput.addEventListener('input', saveSettingsDebounced);

    if (serverToggle) {
        serverToggle.addEventListener('click', handleServerToggle);
    }
    if (clearCacheButton) {
        clearCacheButton.addEventListener('click', handleClearCache);
    }
    if (applyRuntimeButton) {
        applyRuntimeButton.addEventListener('click', handleApplyRuntime);
    }
    if (deleteModelButton) {
        deleteModelButton.addEventListener('click', handleDeleteModel);
    }
}

async function init() {
    await Promise.all([
        checkServerStatus(),
        refreshControlStatus(),
        loadSettings(),
        refreshCacheStats(),
        refreshPageProgress()
    ]);

    bindEvents();

    setInterval(refreshControlStatus, 4000);
    setInterval(refreshCacheStats, 6000);
    setInterval(refreshPageProgress, 1500);
}

init();
