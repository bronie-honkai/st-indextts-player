(function () {
    const extensionName = "st-indextts2";
    const extensionFolderPath = `scripts/extensions/third-party/${extensionName}/`;

    // ==================== Default Settings ====================
    const defaultSettings = {
        apiUrl: 'http://127.0.0.1:7880/api/v1/tts/tasks',
        cloningUrl: 'http://127.0.0.1:7880/api/v1/indextts2_cloning',
        voiceListUrl: 'http://127.0.0.1:7880/api/v1/voices', // 获取参考音频列表
        model: 'index-tts2',
        defaultVoice: 'default.wav',
        speed: 1.0,
        volume: 1.0,
        parsingMode: 'gal', // 'gal' | 'audiobook'
        enableInline: true, // 启用行内增强渲染
        autoInference: false, // 回复后自动推理
        autoPlay: false, // 推理完成后自动播放（需要浏览器已有用户交互）
        streamingPlay: false, // 逐句推理即时播放（推理完一句立即播放，无需等全部完成）
        streamingSkipCount: 1, // 流式推理播放：推理N句后开始播放并继续推理下一句（1=即时播放，2=推理2句后播放第1句，以此类推）
        cacheImportPath: '\\\\SillyTavern\\\\data\\\\TTSsound',
        ambientSoundPath: '', // 背景音目录路径（备用显示）
        ambientSoundVolume: 0.4, // 背景音独立音量 0.0 ~ 1.0
        ambientFadeDuration: 0, // 背景音淡入淡出时长(ms)，0=关闭
        ambientLoopByScene: false, // 场景循环播放：同场景段内背景音持续循环
        // VN format: [角色|表情]|「对话」 or [旁白]|描述
        vnRegex: '^\\[([^\\]|]+)(?:\\|[^\\]]*)?\\]\\|(.+)$',
        voiceMap: {}, // { cardId: { characterName: "voice.wav" } }
        promptInjection: {
            enabled: false,
            content: `描写任何角色（主要角色、NPC、路人）说话时，必须严格遵守格式，对话单开一行：
       格式：[角色名|表情]|「对话内容」
     - **严禁**只写名字（如 [萧凡]），**严禁**漏掉表情。
     - **强制规则**：若无特定表情，必须使用 [角色名|通常]「对话内容」。`,
            position: "depth",
            depth: 4,
            role: "system"
        }
    };

    // ==================== Settings Management ====================

    /**
     * 健壮的 Context 获取辅助函数
     * 处理 SillyTavern.getContext() 的多种访问方式
     */
    function getContext() {
        try {
            if (typeof SillyTavern !== 'undefined' && SillyTavern?.getContext) {
                return SillyTavern.getContext();
            }
            if (window.SillyTavern?.getContext) {
                return window.SillyTavern.getContext();
            }
        } catch (e) {
            console.warn('[IndexTTS2] getContext error:', e);
        }
        return null;
    }

    /**
     * 深度合并：将 source 的缺失字段递归补入 target
     * target 已有的字段不会被覆盖
     */
    function deepMergeDefaults(target, source) {
        if (!source || typeof source !== 'object') return target;
        if (!target || typeof target !== 'object') return JSON.parse(JSON.stringify(source));
        for (const key of Object.keys(source)) {
            if (!Object.prototype.hasOwnProperty.call(target, key)) {
                // target 缺少此字段，从 source 深拷贝补入
                target[key] = typeof source[key] === 'object' && source[key] !== null
                    ? JSON.parse(JSON.stringify(source[key]))
                    : source[key];
            } else if (
                typeof source[key] === 'object' && source[key] !== null &&
                !Array.isArray(source[key]) &&
                typeof target[key] === 'object' && target[key] !== null &&
                !Array.isArray(target[key])
            ) {
                // 两边都是纯对象，递归合并
                deepMergeDefaults(target[key], source[key]);
            }
        }
        return target;
    }

    function getSettings() {
        // ========== 第一步：从 Context（唯一真理来源）读取 ==========
        const ctx = getContext();
        const contextStore = ctx?.extensionSettings;

        let root = null;
        if (contextStore && contextStore[extensionName] && typeof contextStore[extensionName] === 'object') {
            root = contextStore[extensionName];
            console.debug('[IndexTTS2] Settings loaded from Context');
        }

        // ========== 第二步：迁移旧格式 / 全新初始化 ==========
        if (!root || !root.presets) {
            const oldData = root && root.apiUrl ? root : null;
            const migratedPreset = oldData
                ? deepMergeDefaults(JSON.parse(JSON.stringify(oldData)), defaultSettings)
                : JSON.parse(JSON.stringify(defaultSettings));
            delete migratedPreset.selected_preset;
            delete migratedPreset.presets;
            root = { selected_preset: 'Default', presets: { 'Default': migratedPreset } };
            console.log('[IndexTTS2] Migrated/initialized preset architecture');
        }

        // ========== 第三步：写入 Context（确保后续 saveSettings 能持久化） ==========
        if (contextStore) {
            contextStore[extensionName] = root;
        }

        // ========== 第四步：校验 & 补齐当前预设（深度合并 defaultSettings） ==========
        if (!root.presets[root.selected_preset]) {
            root.selected_preset = Object.keys(root.presets)[0] || 'Default';
            if (!root.presets[root.selected_preset]) {
                root.presets['Default'] = JSON.parse(JSON.stringify(defaultSettings));
                root.selected_preset = 'Default';
            }
        }

        const active = root.presets[root.selected_preset];
        // 使用深度合并补齐所有缺失字段（包括 promptInjection、vnRegex 等子对象）
        deepMergeDefaults(active, defaultSettings);
        if (typeof active.voiceMap !== 'object') active.voiceMap = {};

        return active;
    }

    /** 返回顶层根对象 { selected_preset, presets }，供 UI 层使用 */
    function getRootSettings() {
        getSettings(); // 确保初始化/迁移/同步完成
        const ctx = getContext();
        if (ctx?.extensionSettings?.[extensionName]) {
            return ctx.extensionSettings[extensionName];
        }
        return null;
    }

    function saveSettings() {
        const ctx = getContext();
        if (!ctx?.extensionSettings) {
            console.warn('[IndexTTS2] saveSettings: Context not available, cannot persist');
            return;
        }

        // 确保当前内存中的设置已写入 Context
        const root = ctx.extensionSettings[extensionName];
        if (!root) {
            console.warn('[IndexTTS2] saveSettings: no root data in Context, skipping');
            return;
        }

        // 触发 SillyTavern 的持久化保存
        if (typeof ctx.saveSettingsDebounced === 'function') {
            ctx.saveSettingsDebounced();
        } else if (typeof ctx.saveSettings === 'function') {
            ctx.saveSettings();
        } else {
            console.warn('[IndexTTS2] saveSettings: no save function available on Context');
        }
    }

    /**
     * 切换预设 —— 核心：移除并重绘 UI，保证 100% 同步
     * @param {string} name 目标预设名
     */
    function switchPreset(name) {
        const root = getRootSettings();
        if (!root.presets[name]) return;
        root.selected_preset = name;
        saveSettings();

        // 移除并重绘设置面板
        const settingsEl = document.getElementById('indextts-settings');
        if (settingsEl) {
            settingsEl.remove();
            injectSettingsPanel();
        }

        // 如果配音弹窗正在打开，也重绘
        const modalEl = document.getElementById('indextts-modal');
        if (modalEl) {
            modalEl.remove();
            showConfigPopup();
        }
    }

    function getCardId() {
        try {
            const ctx = window.SillyTavern?.getContext?.() || window.getContext?.();
            if (ctx?.characterId !== undefined && ctx?.characterId !== null) {
                return `char_${ctx.characterId}`;
            }
            if (ctx?.groupId) {
                return `group_${ctx.groupId}`;
            }
        } catch (e) {
            console.error('[IndexTTS2] getCardId error:', e);
        }
        return 'default';
    }

    function getCardName() {
        try {
            const ctx = window.SillyTavern?.getContext?.() || window.getContext?.();
            if (ctx?.characterId !== undefined) {
                return ctx.name || ctx.characters?.[ctx.characterId]?.name || '未知角色';
            }
            if (ctx?.groupId) {
                return ctx.groups?.find(g => g.id === ctx.groupId)?.name || '群组';
            }
        } catch (e) { }
        return '默认';
    }

    function getVoiceMap() {
        const settings = getSettings();
        const cardId = getCardId();
        if (!settings.voiceMap[cardId]) {
            settings.voiceMap[cardId] = {};
        }
        return settings.voiceMap[cardId];
    }

    function ensureWavSuffix(filename) {
        if (!filename) return filename;
        filename = filename.trim();
        if (!filename.toLowerCase().endsWith('.wav') &&
            !filename.toLowerCase().endsWith('.mp3') &&
            !filename.toLowerCase().endsWith('.ogg')) {
            return filename + '.wav';
        }
        return filename;
    }

    function ensureCssLoaded() {
        if (!document.querySelector(`link[href*="${extensionName}"]`)) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = `${extensionFolderPath}style.css`;
            document.head.appendChild(link);
            console.log('[IndexTTS2] CSS loaded');
        }
    }

    // ==================== Global Audio Cache ====================
    const audioCache = {}; // { mesId: [ { text, character, voice, hash, blobUrl } ] }
    let currentPlayback = {
        audio: null,
        msg: null,
        mesId: null,
        index: -1,
        // New Global State
        playlist: null, // [{ blobUrl, duration, startOffset, ... }]
        totalDuration: 0,
        controller: null // { seek: fn, play: fn, pause: fn }
    };
    const inferenceLocks = new Set(); // 正在推理中的 mesId 集合

    // Mini player state
    let miniPlayerEl = null;
    let miniPlayerProgress = null;
    let miniPlayerToggle = null;
    let miniPlayerSpeed = null;
    let miniPlayerHideTimer = null;
    let miniPlayerBoundAudio = null;

    function clearMemoryAudioCache() {
        try {
            Object.values(audioCache).forEach(list => {
                if (!Array.isArray(list)) return;
                list.forEach(item => {
                    if (item && item.blobUrl) {
                        try { URL.revokeObjectURL(item.blobUrl); } catch (e) { }
                    }
                });
            });
        } catch (e) {
            console.warn('[IndexTTS2] clearMemoryAudioCache error:', e);
        }
        Object.keys(audioCache).forEach(k => delete audioCache[k]);

        if (currentPlayback.audio) {
            try { currentPlayback.audio.pause(); } catch (e) { }
        }
        currentPlayback = {
            audio: null, msg: null, mesId: null, index: -1, sessionId: null, stop: function () {
                if (this.audio) {
                    try {
                        this.audio.pause();
                        this.audio.onended = null;
                        this.audio.onerror = null;
                    } catch (e) { }
                }
                this.audio = null;
                this.msg = null;
                this.mesId = null;
                this.index = -1;
                this.sessionId = null;
            }
        };
    }

    function getMessageId(msg) {
        if (!msg) return null;
        let mesIdAttr = msg.getAttribute('mesid');
        if (!mesIdAttr) mesIdAttr = msg.dataset?.mesid;
        if (!mesIdAttr) mesIdAttr = msg.getAttribute('data-mesid');

        if (mesIdAttr) return String(mesIdAttr);

        // Fallback to finding index in the message list
        const list = Array.from(document.querySelectorAll('.mes'));
        const idx = list.indexOf(msg);
        return idx >= 0 ? String(idx) : null;
    }

    function utf8ToBase64(str) {
        try {
            return btoa(unescape(encodeURIComponent(str)));
        } catch (e) {
            console.warn('[IndexTTS2] utf8ToBase64 error:', e);
            return '';
        }
    }

    function base64ToUtf8(str) {
        try {
            return decodeURIComponent(escape(atob(str)));
        } catch (e) {
            console.warn('[IndexTTS2] base64ToUtf8 error:', e);
            return '';
        }
    }

    // ==================== IndexedDB Audio Storage ====================
    const AudioStorage = (function () {
        let dbPromise = null;

        function getDB() {
            if (dbPromise) return dbPromise;
            dbPromise = new Promise((resolve, reject) => {
                if (!window.indexedDB) {
                    console.warn('[IndexTTS2] indexedDB not supported, audio cache disabled');
                    resolve(null);
                    return;
                }
                const request = window.indexedDB.open('IndexTTS_Store', 2);
                request.onerror = () => {
                    console.error('[IndexTTS2] indexedDB open error:', request.error);
                    resolve(null);
                };
                request.onupgradeneeded = (event) => {
                    const db = event.target.result;
                    if (!db.objectStoreNames.contains('audios')) {
                        const store = db.createObjectStore('audios', { keyPath: 'hash' });
                        store.createIndex('timestamp', 'timestamp', { unique: false });
                    }
                    if (!db.objectStoreNames.contains('configs')) {
                        db.createObjectStore('configs');
                    }
                };
                request.onsuccess = () => {
                    resolve(request.result);
                };
            });
            return dbPromise;
        }

        async function saveAudio(record) {
            const db = await getDB();
            if (!db) return;
            return new Promise((resolve, reject) => {
                const tx = db.transaction('audios', 'readwrite');
                const store = tx.objectStore('audios');
                const req = store.put(record);
                tx.oncomplete = () => resolve();
                tx.onerror = () => {
                    console.error('[IndexTTS2] saveAudio error:', tx.error);
                    reject(tx.error);
                };
                req.onerror = () => {
                    console.error('[IndexTTS2] saveAudio request error:', req.error);
                };
            });
        }

        async function getAudio(hash) {
            const db = await getDB();
            if (!db) return null;
            return new Promise((resolve, reject) => {
                const tx = db.transaction('audios', 'readonly');
                const store = tx.objectStore('audios');
                const req = store.get(hash);
                req.onsuccess = () => {
                    resolve(req.result || null);
                };
                req.onerror = () => {
                    console.error('[IndexTTS2] getAudio error:', req.error);
                    reject(req.error);
                };
            });
        }

        async function getAllAudios() {
            const db = await getDB();
            if (!db) return [];
            return new Promise((resolve, reject) => {
                const tx = db.transaction('audios', 'readonly');
                const store = tx.objectStore('audios');
                const req = store.getAll();
                req.onsuccess = () => {
                    resolve(req.result || []);
                };
                req.onerror = () => {
                    console.error('[IndexTTS2] getAllAudios error:', req.error);
                    reject(req.error);
                };
            });
        }

        async function clearAllAudios() {
            const db = await getDB();
            if (!db) return;
            return new Promise((resolve, reject) => {
                const tx = db.transaction('audios', 'readwrite');
                const store = tx.objectStore('audios');
                const req = store.clear();
                tx.oncomplete = () => resolve();
                tx.onerror = () => {
                    console.error('[IndexTTS2] clearAllAudios error:', tx.error);
                    reject(tx.error);
                };
                req.onerror = () => {
                    console.error('[IndexTTS2] clearAllAudios request error:', req.error);
                };
            });
        }

        async function saveConfig(key, value) {
            const db = await getDB();
            if (!db) return;
            return new Promise((resolve, reject) => {
                const tx = db.transaction('configs', 'readwrite');
                const store = tx.objectStore('configs');
                const req = store.put(value, key);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
                req.onerror = () => reject(req.error);
            });
        }

        async function getConfig(key) {
            const db = await getDB();
            if (!db) return null;
            return new Promise((resolve, reject) => {
                const tx = db.transaction('configs', 'readonly');
                const store = tx.objectStore('configs');
                const req = store.get(key);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
        }

        return {
            saveAudio,
            getAudio,
            getAllAudios,
            clearAllAudios,
            saveConfig,
            getConfig
        };
    })();

    // ==================== Local Repository Management ====================
    const LocalRepo = (function () {
        let dirHandle = null;

        async function init() {
            try {
                const handle = await AudioStorage.getConfig('localDirHandle');
                if (handle) {
                    dirHandle = handle;
                    console.log('[IndexTTS2] LocalRepo handle restored');
                }
            } catch (e) {
                console.warn('[IndexTTS2] LocalRepo init error:', e);
            }
        }

        async function setHandle(handle) {
            if (!handle) return;
            dirHandle = handle;
            await AudioStorage.saveConfig('localDirHandle', handle);
        }

        function getHandle() { return dirHandle; }

        async function requestPermission() {
            if (!dirHandle) return false;
            const opts = { mode: 'readwrite' };
            try {
                if ((await dirHandle.queryPermission(opts)) === 'granted') return true;
                if ((await dirHandle.requestPermission(opts)) === 'granted') return true;
            } catch (e) {
                console.warn('[IndexTTS2] Permission request failed:', e);
            }
            return false;
        }

        return { init, setHandle, getHandle, requestPermission };
    })();

    // ==================== Ambient Sound Player ====================
    const AmbientPlayer = (function () {
        let dirHandle = null;       // FileSystemDirectoryHandle for ambient folder
        let currentScene = null;    // currently playing scene name
        let currentAudio = null;    // HTMLAudioElement
        let fadeTimer = null;       // rAF handle for fade
        function _getFadeDuration() {
            return parseInt(getSettings().ambientFadeDuration ?? 0) || 0;
        }

        async function init() {
            try {
                const saved = await AudioStorage.getConfig('ambientDirHandle');
                if (saved) { dirHandle = saved; console.log('[IndexTTS2][Ambient] dir handle restored'); }
            } catch (e) { console.warn('[IndexTTS2][Ambient] init error:', e); }
        }

        async function setDirHandle(handle) {
            if (!handle) return;
            dirHandle = handle;
            await AudioStorage.saveConfig('ambientDirHandle', handle);
        }

        function getDirHandle() { return dirHandle; }

        async function queryPermission() {
            if (!dirHandle) return false;
            try {
                return (await dirHandle.queryPermission({ mode: 'read' })) === 'granted';
            } catch (e) { console.warn('[IndexTTS2][Ambient] queryPermission error:', e); }
            return false;
        }

        async function requestPermission() {
            if (!dirHandle) return false;
            try {
                if ((await dirHandle.queryPermission({ mode: 'read' })) === 'granted') return true;
                if ((await dirHandle.requestPermission({ mode: 'read' })) === 'granted') return true;
            } catch (e) { console.warn('[IndexTTS2][Ambient] permission error:', e); }
            return false;
        }

        function _getVolume() {
            const s = getSettings();
            return Math.max(0, Math.min(1, parseFloat(s.ambientSoundVolume ?? 0.4)));
        }

        function _cancelFade() {
            if (fadeTimer !== null) { cancelAnimationFrame(fadeTimer); fadeTimer = null; }
        }

        function _fadeOut(audioEl, onDone) {
            _cancelFade();
            const fadeDur = _getFadeDuration();
            if (!fadeDur) {
                audioEl.pause();
                audioEl.src = '';
                if (onDone) onDone();
                return;
            }
            const start = performance.now();
            const startVol = audioEl.volume;
            function step(now) {
                const t = Math.min(1, (now - start) / fadeDur);
                audioEl.volume = startVol * (1 - t);
                if (t < 1) { fadeTimer = requestAnimationFrame(step); }
                else {
                    audioEl.pause();
                    audioEl.src = '';
                    fadeTimer = null;
                    if (onDone) onDone();
                }
            }
            fadeTimer = requestAnimationFrame(step);
        }

        function _fadeIn(audioEl) {
            _cancelFade();
            const target = _getVolume();
            const fadeDur = _getFadeDuration();
            if (!fadeDur) {
                audioEl.volume = target;
                return;
            }
            audioEl.volume = 0;
            const start = performance.now();
            function step(now) {
                const t = Math.min(1, (now - start) / fadeDur);
                audioEl.volume = target * t;
                if (t < 1) { fadeTimer = requestAnimationFrame(step); }
                else { fadeTimer = null; }
            }
            fadeTimer = requestAnimationFrame(step);
        }

        async function _loadScene(sceneName) {
            console.log('[IndexTTS2][Ambient] _loadScene: sceneName=' + sceneName + ' dirHandle=' + (dirHandle ? dirHandle.name : 'NULL'));
            if (!dirHandle) { console.warn('[IndexTTS2][Ambient] _loadScene: dirHandle is null, 请在设置中选择背景音目录'); return null; }
            try {
                // First try queryPermission (no gesture needed)
                let hasPerm = await queryPermission();
                console.log('[IndexTTS2][Ambient] _loadScene: queryPermission=' + hasPerm);
                if (!hasPerm) {
                    // Try reading directly — some browsers allow read without explicit grant
                    console.warn('[IndexTTS2][Ambient] 权限未授权，请在设置面板点击「🔄 授权」按钮');
                    if (window.toastr) window.toastr.warning('背景音需要授权：请打开 IndexTTS2 设置 → 背景音效 → 点击「🔄 授权」', { timeOut: 6000 });
                    return null;
                }
                // Try candidate file names: exact, plus common extensions
                const candidates = [
                    sceneName + '.mp3', sceneName + '.wav', sceneName + '.ogg',
                    sceneName + '.m4a', sceneName + '.aac'
                ];
                for (const name of candidates) {
                    try {
                        console.log('[IndexTTS2][Ambient] _loadScene: trying file:', name);
                        const fileHandle = await dirHandle.getFileHandle(name);
                        const file = await fileHandle.getFile();
                        const url = URL.createObjectURL(file);
                        console.log('[IndexTTS2][Ambient] _loadScene: found! url=', url);
                        return url;
                    } catch (_) { /* not found, try next */ }
                }
                console.warn('[IndexTTS2][Ambient] _loadScene: no matching file for scene:', sceneName, '— tried:', candidates);
            } catch (e) { console.warn('[IndexTTS2][Ambient] loadScene error:', e); }
            return null;
        }

        async function playScene(sceneName) {
            if (!sceneName) { stop(); return; }
            // Same scene — keep playing without restart
            if (sceneName === currentScene && currentAudio && !currentAudio.paused) return;

            const url = await _loadScene(sceneName);
            if (!url) {
                // No file found — silently do nothing
                console.log('[IndexTTS2][Ambient] no file for scene:', sceneName);
                return;
            }

            const oldAudio = currentAudio;
            currentScene = sceneName;

            const audio = new Audio(url);
            audio.loop = true;
            audio.volume = 0;
            currentAudio = audio;

            // Fade out old audio
            if (oldAudio && !oldAudio.paused) {
                _fadeOut(oldAudio, null);
            } else {
                _cancelFade();
            }

            try {
                console.log('[IndexTTS2][Ambient] playScene: calling audio.play() for scene:', sceneName);
                await audio.play();
                console.log('[IndexTTS2][Ambient] playScene: audio.play() succeeded');
                _fadeIn(audio);
            } catch (e) {
                console.warn('[IndexTTS2][Ambient] play error:', e);
                currentAudio = null;
                currentScene = null;
                URL.revokeObjectURL(url);
            }
        }

        function stop() {
            currentScene = null;
            if (currentAudio) {
                _fadeOut(currentAudio, null);
                currentAudio = null;
            }
        }

        function stopImmediate() {
            _cancelFade();
            currentScene = null;
            if (currentAudio) {
                currentAudio.pause();
                currentAudio.src = '';
                currentAudio = null;
            }
        }

        function setVolume(vol) {
            const v = Math.max(0, Math.min(1, parseFloat(vol) || 0));
            const s = getSettings();
            s.ambientSoundVolume = v;
            saveSettings();
            if (currentAudio && !currentAudio.paused) {
                _cancelFade();
                currentAudio.volume = v;
            }
        }

        function getVolume() { return _getVolume(); }

        return { init, setDirHandle, getDirHandle, requestPermission, playScene, stop, stopImmediate, setVolume, getVolume };
    })();

    async function generateHash(character, voiceId, text, speed, volume, emotion) {
        const emotionPart = emotion ? `|${emotion}` : '';
        const input = `${character || ''}|${voiceId || ''}|${speed}|${volume}|${text || ''}${emotionPart}`;
        try {
            const encoder = new TextEncoder();
            const data = encoder.encode(input);
            if (window.crypto && window.crypto.subtle && window.crypto.subtle.digest) {
                const digest = await window.crypto.subtle.digest('SHA-256', data);
                const hashArray = Array.from(new Uint8Array(digest));
                return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            }
        } catch (e) {
            console.warn('[IndexTTS2] generateHash subtle error, fallback to simple hash:', e);
        }
        // Fallback simple hash（相同输入仍然保持一致）
        let hash = 0;
        for (let i = 0; i < input.length; i++) {
            const ch = input.charCodeAt(i);
            hash = ((hash << 5) - hash) + ch;
            hash |= 0;
        }
        return `fallback_${hash.toString(16)}`;
    }

    // ==================== Audio Transcoding ====================
    async function convertToWav(file) {
        console.log(`[IndexTTS2] Converting: ${file.name} (${file.type}, ${file.size} bytes)`);

        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async () => {
                try {
                    const arrayBuffer = reader.result;
                    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
                    console.log(`[IndexTTS2] Audio: ${audioBuffer.duration.toFixed(2)}s, ${audioBuffer.sampleRate}Hz`);

                    const wavBlob = audioBufferToWav(audioBuffer);
                    const base64 = await blobToBase64Pure(wavBlob);

                    audioContext.close();
                    resolve(base64);
                } catch (e) {
                    console.error('[IndexTTS2] Transcode error:', e);
                    reject(e);
                }
            };
            reader.onerror = reject;
            reader.readAsArrayBuffer(file);
        });
    }

    function audioBufferToWav(audioBuffer) {
        const numChannels = audioBuffer.numberOfChannels;
        const sampleRate = audioBuffer.sampleRate;
        const length = audioBuffer.length * numChannels;
        const samples = new Int16Array(length);

        for (let ch = 0; ch < numChannels; ch++) {
            const data = audioBuffer.getChannelData(ch);
            for (let i = 0; i < audioBuffer.length; i++) {
                const s = Math.max(-1, Math.min(1, data[i]));
                samples[i * numChannels + ch] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }
        }

        const dataLen = samples.length * 2;
        const buffer = new ArrayBuffer(44 + dataLen);
        const view = new DataView(buffer);

        const writeStr = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
        writeStr(0, 'RIFF');
        view.setUint32(4, 36 + dataLen, true);
        writeStr(8, 'WAVE');
        writeStr(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * numChannels * 2, true);
        view.setUint16(32, numChannels * 2, true);
        view.setUint16(34, 16, true);
        writeStr(36, 'data');
        view.setUint32(40, dataLen, true);

        for (let i = 0; i < samples.length; i++) {
            view.setInt16(44 + i * 2, samples[i], true);
        }

        return new Blob([buffer], { type: 'audio/wav' });
    }

    function blobToBase64Pure(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const result = reader.result;
                resolve(result.includes(',') ? result.split(',')[1] : result);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    // ==================== VN / Audiobook Parsing ====================
    // 8 维情感向量顺序：开心、愤怒、悲伤、恐惧、厌恶、忧郁、惊讶、平静
    const textEmotionVectorMap = {
        开心: '1,0,0,0,0,0,0,0',
        愤怒: '0,1,0,0,0,0,0,0',
        悲伤: '0,0,1,0,0,0,0,0',
        恐惧: '0,0,0,1,0,0,0,0',
        厌恶: '0,0,0,0,1,0,0,0',
        忧郁: '0,0,0,0,0,1,0,0',
        惊讶: '0,0,0,0,0,0,1,0',
        平静: '0,0,0,0,0,0,0,1',
    };

    const textEmotionAliasMap = {
        通常: '平静',
    };

    function getEmotionVectorFromText(label) {
        const normalized = (label || '').trim().replace(/\s+/g, '');
        if (!normalized) return null;
        const canonical = textEmotionVectorMap[normalized] ? normalized : textEmotionAliasMap[normalized];
        return canonical ? textEmotionVectorMap[canonical] : null;
    }

    // 兼容: [角色|表情]|「对话」、[角色][表情] 对话、[角色] 内容（无引号），宽松空白
    function parseVNLine(text) {
        try {
            const settings = getSettings();
            const mode = settings.parsingMode || 'gal';

            if (mode !== 'gal') return null;

            const trimmed = (text || '').trim().replace(/\s+/g, ' ').trim();
            if (!trimmed) return null;

            // 优先提取显式情感向量 [数字,数字,...]，若缺失则尝试将文本表情映射为 8 维向量
            let emotion = null;
            const applyTextEmotion = (label) => {
                if (!emotion) {
                    emotion = getEmotionVectorFromText(label);
                }
            };
            try {
                const emotionMatch = trimmed.match(/\]\s*\[([\d.,\s-]+)\]/);
                if (emotionMatch) {
                    emotion = emotionMatch[1].replace(/\s/g, '');
                }
            } catch (_) { /* 格式错误时静默忽略 */ }

            // 格式 A-NEW: [角色][表情][场景]:「对话」（三重标签，含场景字段）
            const threeTagRegex = /^\s*\[([^\]\n]+)\]\s*\[([^\]\n]*)\]\s*\[([^\]\n]+)\]\s*:?\s*([「“”『](.*?)[」””』]|.+)\s*$/;
            const m3 = trimmed.match(threeTagRegex);
            if (m3) {
                const character = (m3[1] || '').replace(/\s+/g, ' ').trim();
                const expression = (m3[2] || '').replace(/\s+/g, ' ').trim();
                const scene = (m3[3] || '').replace(/\s+/g, ' ').trim();
                const rawContent = (m3[4] || '').trim();
                const quoteInner = m3[5];
                const inner = quoteInner !== undefined ? quoteInner.trim() : rawContent;
                if (character && inner) {
                    applyTextEmotion(expression);
                    const r3 = { character, scene, dialogue: inner, rawContent, quoted: rawContent, isAction: false, isQuoted: quoteInner !== undefined, emotion };
                    console.log('[IndexTTS2][Ambient] parseVNLine 三标签命中 character=' + character + ' scene=' + scene + ' dialogue=' + inner);
                    return r3;
                }
            }
            // 格式 A0: [角色]|[表情]:「对话」 或 [角色][表情]:「对话」（表情后可带冒号）
            // 兼容: [王淑琴]|[职业微笑]:「...」 和 [王淑琴][职业微笑]:「...」
            const pipeTagRegex = /^\s*\[([^\]\n]+)\]\s*(?:\|\s*)?\[([^\]]*)\]\s*:?\s*([「""『](.*?)[」""』]|.+)\s*$/;
            let match = trimmed.match(pipeTagRegex);
            if (match) {
                const character = (match[1] || '').replace(/\s+/g, ' ').trim();
                const expression = (match[2] || '').replace(/\s+/g, ' ').trim();
                const rawContent = (match[3] || '').trim();
                const quoteInner = match[4];
                const inner = quoteInner !== undefined ? quoteInner.trim() : rawContent;
                if (character && inner) {
                    applyTextEmotion(expression);
                    return { character, dialogue: inner, rawContent, quoted: rawContent, isAction: false, isQuoted: quoteInner !== undefined, emotion };
                }
            }

            // 格式 A: [角色|表情]|「对话」 或 [角色]|「对话」，宽松 \s*
            // 新增：可选匹配情感向量 [角色|表情][情感向量]|「对话」
            const pipeRegex = /^\s*\[([^|\]\n]+)(?:\|([^\]\n]*))?\](?:\[[\d.,\s-]*\])?\s*\|\s*([「""『](.*?)[」""』])\s*$/;
            match = trimmed.match(pipeRegex);
            if (match) {
                const character = (match[1] || '').replace(/\s+/g, ' ').trim();
                const expression = (match[2] || '').replace(/\s+/g, ' ').trim();
                const quoted = (match[3] || '').trim();
                const inner = (match[4] || '').trim();
                if (character && inner) {
                    applyTextEmotion(expression);
                    return { character, dialogue: inner, rawContent: quoted, quoted, isAction: false, isQuoted: true, emotion };
                }
            }

            // 格式 B: [角色][表情] 对话 或 [角色] 对话（无竖线）
            // 新增：可选匹配情感向量 [角色][表情][情感向量] 对话
            const bracketRegex = /^\s*\[([^\]]+)\](?:\[([^\]]*)\])?(?:\[[\d.,\s-]*\])?\s+(.+)\s*$/;
            match = trimmed.match(bracketRegex);
            if (match) {
                const character = (match[1] || '').replace(/\s+/g, ' ').trim();
                const expression = (match[2] || '').replace(/\s+/g, ' ').trim();
                let content = (match[3] || '').trim();
                if (!character || !content) return null;
                const quoteMatch = content.match(/^[「""『](.*?)[」""』]\s*$/);
                const dialogue = quoteMatch ? quoteMatch[1].trim() : content;
                if (!dialogue) return null;
                applyTextEmotion(expression);
                return { character, dialogue, rawContent: content, quoted: content, isAction: false, isQuoted: !!quoteMatch, emotion };
            }

            // 格式 C: [角色] 内容（无引号，仅 [角色] 后跟空白与内容）
            const noQuoteRegex = /^\s*\[([^\]]+)\]\s+(.+)\s*$/;
            match = trimmed.match(noQuoteRegex);
            if (match) {
                const character = (match[1] || '').replace(/\s+/g, ' ').trim();
                const dialogue = (match[2] || '').trim();
                if (character && dialogue) {
                    return { character, dialogue, rawContent: dialogue, quoted: dialogue, isAction: false, isQuoted: false, emotion };
                }
            }

            return null;
        } catch (e) {
            console.error('[IndexTTS2] parseVNLine error:', e);
        }
        return null;
    }


    function getMergedCharacterList() {
        const characters = new Set();
        // 1. History
        document.querySelectorAll('.mes[is_user="false"] .mes_text').forEach(mesText => {
            (mesText.innerText || '').split('\n').forEach(line => {
                const parsed = parseVNLine(line.trim());
                if (parsed?.character && !['旁白', 'Narrator'].includes(parsed.character)) {
                    characters.add(parsed.character);
                }
            });
        });
        // 2. Saved & Manual
        const voiceMap = getVoiceMap();
        Object.keys(voiceMap).forEach(k => characters.add(k));

        return Array.from(characters).sort();
    }

    // ==================== TTS API & Cache Flow ====================
    async function ensureAudioRecord({ text, character, voice, allowFetch = true, emotion = null }) {
        if (!text?.trim()) return null;
        const settings = getSettings();
        // Use default voice if specific voice not set, UNLESS we want to be strict (but ensureAudioRecord is usually for playback).
        // For inference skipping, we check before calling this.
        const normVoice = ensureWavSuffix(voice || settings.defaultVoice);
        const speed = parseFloat(settings.speed || 1.0) || 1.0;
        const volume = parseFloat(settings.volume || 1.0) || 1.0;
        const hash = await generateHash(character || 'Unknown', normVoice, text, speed, volume, emotion);

        // 先查 IndexedDB 缓存
        try {
            const cached = await AudioStorage.getAudio(hash);
            if (cached && cached.blob) {
                console.log('[IndexTTS2] [Cache Hit]', hash);
                console.log('[IndexTTS2] Emotion debug (cache hit):', {
                    input: text,
                    voice: normVoice,
                    emotion,
                });
                return {
                    hash,
                    blob: cached.blob,
                    character,
                    text,
                    voice: normVoice,
                    speed,
                    volume,
                    isCached: true
                };
            }
        } catch (e) {
            console.warn('[IndexTTS2] getAudio failed, fallback to API:', e);
        }

        if (!allowFetch) {
            console.log('[IndexTTS2] Auto-inference disabled & cache miss, skipping API request.');
            console.log('[IndexTTS2] Emotion debug (request skipped):', {
                input: text,
                voice: normVoice,
                emotion,
            });
            return null;
        }

        console.log('[IndexTTS2] [API Request]', hash);
        const payload = {
            text: text,
            prompt_audio: normVoice,
            clean_text: true,
            max_text_tokens_per_segment: 120,
        };
        if (emotion) {
            const emoVec = emotion.split(',').map(v => parseFloat(v.trim()));
            if (emoVec.length === 8 && emoVec.every(v => !isNaN(v))) {
                payload.emo_control_method = 2;
                payload.emo_vec = emoVec;
                payload.emo_weight = 0.6;
            }
        }

        console.log('[IndexTTS2] TTS payload emotion debug:', {
            text,
            prompt_audio: normVoice,
            emotion,
            emo_control_method: payload.emo_control_method ?? null,
            emo_vec: payload.emo_vec ?? null,
            emo_weight: payload.emo_weight ?? null,
        });

        try {
            const res = await fetch(settings.apiUrl, {
                method: 'POST',
                mode: 'cors',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (!res.ok) {
                const errText = await res.text().catch(() => '');
                throw new Error(`HTTP ${res.status} ${errText || ''}`);
            }

            const blob = await res.blob();
            const record = {
                hash,
                blob,
                character,
                text,
                voice: normVoice,
                speed,
                volume,
                timestamp: Date.now(),
                isCached: false
            };

            // 持久化保存
            AudioStorage.saveAudio(record).catch(e => {
                console.warn('[IndexTTS2] saveAudio failed:', e);
            });

            return record;
        } catch (e) {
            console.error('[IndexTTS2] TTS API Error:', e);
            if (e instanceof TypeError || (e.message && (e.message.includes('Failed to fetch') || e.message.includes('NetworkError')))) {
                console.warn('后端离线，仅使用本地缓存');
                return null;
            }
            throw e;
        }
    }

    async function playSingleLine(text, voiceFile, character, context) {
        if (!text?.trim()) return;
        const ctx = context || {};
        // Explicitly check for false, default to true
        const allowFetch = ctx.autoInfer === false ? false : true;
        const emotion = ctx.emotion || null;
        let msg = ctx.msg || null;
        const encT = ctx.encT || utf8ToBase64(text);
        const encC = ctx.encC || utf8ToBase64(character || '');

        // 1. 增强音色自动查表 (Requirement 1)
        let finalVoice = voiceFile;
        if (!finalVoice) {
            const voiceMap = getVoiceMap();
            if (character && voiceMap[character]) {
                finalVoice = voiceMap[character];
            }
        }

        const mesId = ctx.mesId || (msg ? getMessageId(msg) : null);

        // 2. 内存缓存优先 (Requirement 2 / Cache Hit)
        if (mesId && audioCache[mesId]) {
            const cleanText = text.trim();
            // 查找完全匹配的文本内容记录
            const recordInCache = audioCache[mesId].find(r => r.text === cleanText);
            if (recordInCache && recordInCache.blobUrl) {
                console.log('[IndexTTS2] Memory Cache Hit for playSingleLine:', mesId);
                // 直接使用已有的 blobUrl 播放，绕过磁盘 IO 和 API
                playAudioFromRecord({
                    blobUrl: recordInCache.blobUrl,
                    msg,
                    encT,
                    encC,
                    character,
                    text: cleanText,
                    volume: ctx.volume
                });
                return;
            }
        }

        let record;
        try {
            record = await ensureAudioRecord({ text, character, voice: finalVoice, allowFetch, emotion });
            if (!record) return;
        } catch (e) {
            if (window.toastr) window.toastr.error('TTS失败: ' + e.message);
            return;
        }

        const url = URL.createObjectURL(record.blob);
        playAudioFromRecord({
            blobUrl: url,
            msg,
            encT,
            encC,
            character,
            text,
            volume: record.volume,
            shouldRevoke: true
        });
    }

    /**
     * Helper to handle audio playback from a known record or URL
     */
    async function playAudioFromRecord({ blobUrl, msg, encT, encC, character, text, volume, shouldRevoke = false }) {
        const audio = new Audio(blobUrl);
        const settings = getSettings();
        const vol = isNaN(volume) ? (settings.volume || 1.0) : Math.max(0, Math.min(1, volume));
        audio.volume = vol;

        // 高亮当前行
        if (msg) {
            clearPlayingInMessage(msg);
            setLinePlayingByEncoded(msg, encT, encC, true);
        }

        if (currentPlayback.audio) {
            try { currentPlayback.audio.pause(); } catch (e) { }
        }

        // Clear global context when single playing
        currentPlayback = {
            audio,
            msg,
            mesId: msg ? getMessageId(msg) : null,
            index: -1,
            playlist: null,
            totalDuration: 0,
            controller: null
        };

        attachMiniPlayerToAudio(audio, false);

        const cleanup = () => {
            if (shouldRevoke) URL.revokeObjectURL(blobUrl);
            if (msg) {
                setLinePlayingByEncoded(msg, encT, encC, false);
            }
        };

        audio.onended = cleanup;
        audio.onerror = cleanup;

        try {
            await audio.play();
            if (window.toastr) window.toastr.success('播放中...');
        } catch (e) {
            cleanup();
            console.error('[IndexTTS2] Audio play error:', e);
            if (e.name === 'NotAllowedError') {
                if (window.toastr) window.toastr.warning('浏览器已拦截自动播放，请先点击页面任意处，或手动点击播放按钮');
            } else {
                if (window.toastr) window.toastr.error('播放失败: ' + e.message);
            }
        }
    }

    // 保留旧接口，作为简单单句播放包装
    async function playTTS(text, voiceFile) {
        return playSingleLine(text, voiceFile, '', {});
    }

    // ==================== Voice Cloning ====================
    async function cloneVoice(characterName, base64Audio, originalFileName) {
        const settings = getSettings();
        console.log(`[IndexTTS2] Clone: ${characterName}, base64 len=${base64Audio.length}`);

        try {
            // 将 base64 转换为 Blob，使用 multipart/form-data 上传到 /api/v1/upload
            const byteString = atob(base64Audio);
            const ab = new ArrayBuffer(byteString.length);
            const ia = new Uint8Array(ab);
            for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
            const blob = new Blob([ab], { type: 'audio/wav' });

            // 直接使用原始文件名，不做任何重命名或过滤
            const uploadFileName = originalFileName || (characterName + '.wav');

            const formData = new FormData();
            formData.append('file', blob, uploadFileName);

            // 从 cloningUrl 提取 baseUrl，换用后端已有的 /api/v1/upload 接口
            const baseUrl = (settings.cloningUrl || 'http://127.0.0.1:7880/api/v1/indextts2_cloning')
                .replace(/\/api\/v1\/indextts2_cloning.*$/, '')
                .replace(/\/+$/, '');
            const uploadUrl = baseUrl + '/api/v1/upload';

            console.log(`[IndexTTS2] Uploading to: ${uploadUrl}, filename: ${uploadFileName}`);

            const res = await fetch(uploadUrl, {
                method: 'POST',
                mode: 'cors',
                body: formData
                // 不手动设置 Content-Type，让浏览器自动附加 multipart boundary
            });

            const text = await res.text();
            console.log(`[IndexTTS2] Upload response: ${res.status}`, text);

            if (!res.ok) {
                if (window.toastr) window.toastr.error(`上传失败 HTTP ${res.status}: ${text}`);
                return null;
            }

            const data = JSON.parse(text);
            // 后端返回 { filename, path, message }，用 filename 作为音色 ID
            const id = data.filename || data.id || data.voice_id || data.name;
            if (id) {
                if (window.toastr) window.toastr.success(`参考音频上传成功: ${id}`);
                return id;
            }
            return null;
        } catch (e) {
            console.error('[IndexTTS2] Clone Error:', e);
            if (window.toastr) window.toastr.error('上传失败: ' + e.message);
            return null;
        }
    }

    // ==================== Config Popup ====================
    function showConfigPopup() {
        const cardId = getCardId();
        const cardName = getCardName();
        const settings = getSettings();
        const voiceMap = getVoiceMap();

        const renderListResults = () => {
            const characters = getMergedCharacterList();
            const container = document.getElementById('indextts-char-list-container');
            if (!container) return;

            let rowsHtml = characters.length === 0
                ? '<div class="indextts-empty">未检测到角色 [角色|...]|「对话」</div>'
                : characters.map(char => {
                    const voice = voiceMap[char];
                    const isConfigured = !!voice;
                    return `
                <div class="indextts-char-row" data-char="${char}">
                    <div class="indextts-char-name" title="${char}">${char}</div>
                    <div class="indextts-char-audio">
                        <select class="indextts-voice-select text_pole" data-char="${char}">
                            <option value="">-- 加载中... --</option>
                        </select>
                        <input type="text" class="indextts-voice-input text_pole" data-char="${char}" value="${voice || ''}" placeholder="文件名.wav">
                        <div class="indextts-del-btn" data-char="${char}" title="删除配置"><i class="fa-solid fa-trash"></i></div>
                    </div>
                </div>
            `}).join('');
            container.innerHTML = `
                <div class="indextts-list-header"><span>角色</span><span>参考音频</span></div>
                ${rowsHtml}
            `;

            // Re-bind events
            bindRowEvents(container);
        };

        const modal = document.createElement('div');
        modal.id = 'indextts-modal';
        modal.className = 'indextts-modal-overlay';
        modal.innerHTML = `
            <div class="indextts-modal-box">
                <div class="indextts-popup-header"><h3>🎙️ 配音配置 - ${cardName}</h3></div>
                <div class="indextts-preset-bar-popup">
                    <select id="indextts-popup-preset-select" class="text_pole"></select>
                    <input type="text" id="indextts-popup-preset-name" class="text_pole" placeholder="预设名称">
                    <div id="indextts-popup-preset-save" class="menu_button" title="保存/新建预设">
                        <i class="fa-solid fa-floppy-disk"></i>
                    </div>
                    <div id="indextts-popup-preset-delete" class="menu_button" title="删除预设">
                        <i class="fa-solid fa-trash-can"></i>
                    </div>
                </div>
                <div class="indextts-add-container">
                    <input type="text" id="indextts-new-char" class="text_pole" placeholder="输入新角色名">
                    <button class="menu_button" id="indextts-add-btn"><i class="fa-solid fa-plus"></i> 添加</button>
                </div>
                <div class="indextts-quick-actions">
                    <button class="menu_button" id="indextts-import"><i class="fa-solid fa-file-import"></i> 导入全部</button>
                    <button class="menu_button" id="indextts-export"><i class="fa-solid fa-file-export"></i> 导出全部</button>
                </div>
                <div class="indextts-char-list" id="indextts-char-list-container"></div>
                <div class="indextts-popup-footer">
                    <button class="menu_button" id="indextts-cancel">取消</button>
                    <button class="menu_button menu_button_icon" id="indextts-save">保存</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        renderListResults();

        // ==================== Popup Preset Management ====================
        const populatePopupPresetUI = () => {
            const root = getRootSettings();
            const selectEl = modal.querySelector('#indextts-popup-preset-select');
            const nameEl = modal.querySelector('#indextts-popup-preset-name');
            if (!selectEl || !nameEl) return;
            selectEl.innerHTML = Object.keys(root.presets).map(name =>
                `<option value="${name}"${name === root.selected_preset ? ' selected' : ''}>${name}</option>`
            ).join('');
            nameEl.value = root.selected_preset;
        };
        populatePopupPresetUI();

        // Switch preset → switchPreset 移除重绘（switchPreset 自动重开弹窗和面板）
        const popupPresetSelect = modal.querySelector('#indextts-popup-preset-select');
        if (popupPresetSelect) {
            popupPresetSelect.onchange = () => {
                switchPreset(popupPresetSelect.value);
            };
        }

        // Save preset from popup
        const popupPresetSave = modal.querySelector('#indextts-popup-preset-save');
        if (popupPresetSave) {
            popupPresetSave.onclick = () => {
                const root = getRootSettings();
                const nameEl = modal.querySelector('#indextts-popup-preset-name');
                const name = (nameEl?.value || '').trim();
                if (!name) {
                    if (window.toastr) window.toastr.warning('请输入预设名称');
                    return;
                }
                root.presets[name] = JSON.parse(JSON.stringify(getSettings()));
                root.selected_preset = name;
                saveSettings();
                populatePopupPresetUI();
                if (window.toastr) window.toastr.success(`预设 "${name}" 已保存`);
            };
        }

        // Delete preset from popup
        const popupPresetDel = modal.querySelector('#indextts-popup-preset-delete');
        if (popupPresetDel) {
            popupPresetDel.onclick = () => {
                const root = getRootSettings();
                const keys = Object.keys(root.presets);
                if (keys.length <= 1) {
                    if (window.toastr) window.toastr.warning('至少需要保留一个预设');
                    return;
                }
                const current = root.selected_preset;
                if (!confirm(`确定要删除预设 "${current}" 吗？`)) return;
                delete root.presets[current];
                // switchPreset 会删除弹窗并重新打开
                switchPreset(Object.keys(root.presets)[0]);
                if (window.toastr) window.toastr.success(`已删除预设 "${current}"`);
            };
        }

        // Handlers
        modal.onclick = e => { if (e.target === modal) modal.remove(); };
        modal.querySelector('#indextts-cancel').onclick = () => modal.remove();

        // Add Character
        const addBtn = modal.querySelector('#indextts-add-btn');
        const addInput = modal.querySelector('#indextts-new-char');
        const doAdd = () => {
            const name = addInput.value.trim();
            if (name) {
                if (!voiceMap[name]) {
                    voiceMap[name] = ""; // Keep empty to indicate manually added but no voice
                }
                saveSettings();
                addInput.value = '';
                renderListResults();
            }
        };
        addBtn.onclick = doAdd;
        addInput.onkeydown = (e) => { if (e.key === 'Enter') doAdd(); };

        modal.querySelector('#indextts-save').onclick = () => {
            // Collect inputs one last time in case of manual typing
            modal.querySelectorAll('.indextts-voice-input').forEach(input => {
                const char = input.dataset.char;
                let val = input.value.trim();
                if (val) {
                    voiceMap[char] = ensureWavSuffix(val);
                } else {
                    // If manually added and cleared, do we delete?
                    // Proposal: keep key if it was manually added?
                    // Simplify: Just update value. If empty string, it remains empty in voiceMap (so it persists).
                    voiceMap[char] = "";
                }
            });
            saveSettings();
            if (window.toastr) window.toastr.success('已保存');
            modal.remove();
            refreshAllMessages();
        };

        // Export/Import
        modal.querySelector('#indextts-export').onclick = () => {
            const allData = JSON.parse(JSON.stringify(settings.voiceMap));
            const json = JSON.stringify(allData, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const a = document.createElement('a');
            const cardName = getCardName();
            a.href = URL.createObjectURL(blob);
            a.download = `${cardName}_配音配置.json`;
            a.click();
            if (window.toastr) window.toastr.success('已导出全部配置');
        };

        modal.querySelector('#indextts-import').onclick = () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            input.onchange = async () => {
                const file = input.files[0];
                if (!file) return;
                try {
                    const data = JSON.parse(await file.text());
                    // Merge
                    Object.entries(data).forEach(([cid, charMap]) => {
                        if (!settings.voiceMap[cid]) settings.voiceMap[cid] = {};
                        Object.assign(settings.voiceMap[cid], charMap);
                    });
                    saveSettings();
                    if (window.toastr) window.toastr.success('已导入');
                    modal.remove(); // Close to refresh state properly
                    showConfigPopup();
                } catch (e) {
                    if (window.toastr) window.toastr.error('导入失败');
                }
            };
            input.click();
        };

        function bindRowEvents(container) {
            // Delete
            container.querySelectorAll('.indextts-del-btn').forEach(btn => {
                btn.onclick = () => {
                    const char = btn.dataset.char;
                    if (confirm(`确定要移除角色 "${char}" 的配置吗？`)) {
                        delete voiceMap[char];
                        saveSettings();
                        renderListResults();
                    }
                };
            });

            // 手动输入框同步 voiceMap
            container.querySelectorAll('.indextts-voice-input').forEach(input => {
                input.onchange = () => {
                    const char = input.dataset.char;
                    voiceMap[char] = input.value.trim();
                    // 同步更新下拉框选中项
                    const sel = container.querySelector(`.indextts-voice-select[data-char="${char}"]`);
                    if (sel) {
                        const opt = [...sel.options].find(o => o.value === input.value.trim());
                        if (opt) sel.value = opt.value;
                    }
                    saveSettings();
                };
            });

            // 下拉选择框：从后端获取音频列表并填充
            const settings = getSettings();
            const voiceListUrl = settings.voiceListUrl || 'http://127.0.0.1:7880/api/v1/voices';

            // 一次性拉取音频列表，填充所有 select
            fetch(voiceListUrl, { mode: 'cors' })
                .then(r => r.json())
                .then(data => {
                    // 后端返回 { voices: [...], directory: ... }
                    const voices = Array.isArray(data) ? data : (data.voices || []);
                    container.querySelectorAll('.indextts-voice-select').forEach(sel => {
                        const char = sel.dataset.char;
                        const currentVoice = voiceMap[char] || '';
                        sel.innerHTML = '<option value="">-- 请选择参考音频 --</option>'
                            + voices.map(v => {
                                const name = typeof v === 'string' ? v : (v.filename || v.name || v);
                                return `<option value="${name}"${name === currentVoice ? ' selected' : ''}>${name}</option>`;
                            }).join('');
                        // 如果当前值不在列表中但手动输入了，补一个 option
                        if (currentVoice && !voices.some(v => (typeof v === 'string' ? v : (v.filename || v.name)) === currentVoice)) {
                            sel.innerHTML += `<option value="${currentVoice}" selected>${currentVoice} (手动)</option>`;
                        }
                        sel.onchange = () => {
                            const val = sel.value;
                            voiceMap[char] = val;
                            const voiceInput = container.querySelector(`.indextts-voice-input[data-char="${char}"]`);
                            if (voiceInput) voiceInput.value = val;
                            saveSettings();
                        };
                    });
                })
                .catch(() => {
                    container.querySelectorAll('.indextts-voice-select').forEach(sel => {
                        const char = sel.dataset.char;
                        const currentVoice = voiceMap[char] || '';
                        sel.innerHTML = `<option value="" disabled>⚠ 无法获取列表</option>`
                            + (currentVoice ? `<option value="${currentVoice}" selected>${currentVoice}</option>` : '');
                    });
                });
        }
    }

    async function handleUpload(char, file, dropText, voiceInput) {
        if (dropText) {
            dropText.textContent = '转码并克隆中...';
            dropText.className = 'indextts-drop-text cloning';
        }

        try {
            const base64 = await convertToWav(file);
            const id = await cloneVoice(char, base64, file.name);
            if (id) {
                const finalId = ensureWavSuffix(id);
                if (dropText) { dropText.textContent = finalId; dropText.className = 'indextts-drop-text success'; }
                if (voiceInput) voiceInput.value = finalId;
            } else {
                if (dropText) { dropText.textContent = '失败'; dropText.className = 'indextts-drop-text error'; }
            }
        } catch (e) {
            if (dropText) { dropText.textContent = '错误'; dropText.className = 'indextts-drop-text error'; }
        }
    }

    // ==================== Message UI Injection ====================
    function injectMessageButtons(msg) {
        if (msg.querySelector('.indextts-msg-btns')) return;
        const btns = msg.querySelector('.mes_buttons');
        if (!btns) return;

        const group = document.createElement('div');
        group.className = 'indextts-msg-btns mes_button_row';
        group.innerHTML = `
            <div class="mes_button indextts-play" title="播放整楼层"><i class="fa-solid fa-volume-high"></i></div>
            <div class="mes_button indextts-infer" title="先推理后播放"><i class="fa-solid fa-wand-magic-sparkles"></i></div>
            <div class="mes_button indextts-cfg" title="配置"><i class="fa-solid fa-cog"></i></div>
        `;
        const playBtn = group.querySelector('.indextts-play');
        const inferBtn = group.querySelector('.indextts-infer');
        if (playBtn) {
            playBtn.onclick = e => { e.stopPropagation(); playMessageQueue(msg, playBtn); };
            setupMiniPlayerHover(playBtn);
        }
        if (inferBtn) {
            inferBtn.onclick = e => { e.stopPropagation(); inferMessageAudios(msg, inferBtn); };
        }
        group.querySelector('.indextts-cfg').onclick = e => { e.stopPropagation(); showConfigPopup(); };
        btns.appendChild(group);
    }

    function injectInlineButtons(msg, force = false) {
        const mesText = msg.querySelector('.mes_text');
        if (!mesText) return;

        const settings = getSettings();
        if (settings.enableInline === false) {
            mesText.dataset.indexttsInjected = 'true';
            return;
        }

        const mode = settings.parsingMode || 'gal';
        // 听书模式下不注入逐句播放按钮（按整楼层顺序播放即可）
        if (mode === 'audiobook') {
            mesText.dataset.indexttsInjected = 'true';
            return;
        }

        // Check if already injected
        if (!force && mesText.dataset.indexttsInjected === 'true') {
            if (mesText.querySelector('.indextts-inline-play')) return;
        }

        const voiceMap = getVoiceMap();

        // Get text content and split by lines
        const textContent = mesText.innerText || '';
        const lines = textContent.split('\n');

        // Find all VN-format lines and their positions
        const vnLines = [];
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            const parsed = parseVNLine(trimmed);
            if (parsed) {
                vnLines.push({
                    original: trimmed,
                    parsed: parsed,
                    // Remove fallback to defaultVoice to detect unset state
                    voice: voiceMap[parsed.character],
                    scene: parsed.scene || null
                });
            }
        }

        if (vnLines.length === 0) {
            mesText.dataset.indexttsInjected = 'true';
            return;
        }

        // Inject clickable elements using innerHTML replacement
        let html = mesText.innerHTML;
        let modified = false;

        for (const vn of vnLines) {
            // Encode dialogue & character for data attribute
            const enc = utf8ToBase64(vn.parsed.dialogue);
            const charEnc = utf8ToBase64(vn.parsed.character);
            const emotionEnc = vn.parsed.emotion || '';

            // 仅在原 HTML 中查找「带引号的对话」部分（第二组）
            const dialogueContent = vn.parsed.rawContent;
            if (!dialogueContent) continue;

            // Escape special regex characters
            const escapedDialogue = dialogueContent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

            // Find and wrap the dialogue text（避免重复包裹）
            const dialogueRegex = new RegExp(`(${escapedDialogue})(?![^<]*indextts-dialogue)`, 'g');

            html = html.replace(dialogueRegex, (match) => {
                // 不重复包裹已经含有 indextts-dialogue 的片段
                if (match.includes('indextts-dialogue')) return match;
                modified = true;

                return `<span class="indextts-dialogue" data-t="${enc}" data-v="${vn.voice || ''}" data-c="${charEnc}" data-e="${emotionEnc}" title="点击播放">${match}</span><span class="indextts-inline-play" data-t="${enc}" data-v="${vn.voice || ''}" data-c="${charEnc}" data-e="${emotionEnc}" title="播放"><i class="fa-solid fa-play fa-xs"></i></span>`;
            });
        }

        if (modified) {
            mesText.innerHTML = html;

            // Bind click events for dialogue text
            mesText.querySelectorAll('.indextts-dialogue').forEach(span => {
                if (span.dataset.bound) return;
                span.dataset.bound = 'true';
                span.onclick = e => {
                    e.stopPropagation();
                    const text = base64ToUtf8(span.dataset.t);
                    const voice = span.dataset.v;
                    const character = base64ToUtf8(span.dataset.c || '');
                    const emotion = span.dataset.e || null;
                    const msgEl = span.closest('.mes');
                    playSingleLine(text, voice, character, { msg: msgEl, encT: span.dataset.t, encC: span.dataset.c, emotion });
                };
            });

            // Bind click events for play buttons
            mesText.querySelectorAll('.indextts-inline-play').forEach(btn => {
                if (btn.dataset.bound) return;
                btn.dataset.bound = 'true';
                btn.onclick = e => {
                    e.stopPropagation();
                    const text = base64ToUtf8(btn.dataset.t);
                    const voice = btn.dataset.v;
                    const character = base64ToUtf8(btn.dataset.c || '');
                    const emotion = btn.dataset.e || null;
                    const msgEl = btn.closest('.mes');
                    playSingleLine(text, voice, character, { msg: msgEl, encT: btn.dataset.t, encC: btn.dataset.c, emotion });
                };
            });
        }

        mesText.dataset.indexttsInjected = 'true';
    }


    function playMessageAudio(msg) {
        // 全文播放：按顺序播放当前消息内所有符合 VN 格式的台词
        playMessageQueue(msg);
    }

    function collectVNLinesFromMessage(msg) {
        const result = [];
        if (!msg) return result;
        const mesText = msg.querySelector('.mes_text');
        if (!mesText) return result;

        const voiceMap = getVoiceMap();
        const settings = getSettings();
        const mode = settings.parsingMode || 'gal';

        // 克隆节点并移除插件 UI 元素，避免 innerText 被按钮/span 干扰
        let textContent;
        try {
            const clone = mesText.cloneNode(true);
            clone.querySelectorAll('.indextts-inline-play, .indextts-dialogue').forEach(el => {
                if (el.classList.contains('indextts-dialogue')) {
                    el.replaceWith(...el.childNodes);
                } else {
                    el.remove();
                }
            });
            textContent = clone.innerText || '';
        } catch (e) {
            textContent = mesText.innerText || '';
        }
        textContent = (textContent || '').replace(/\r/g, '\n');

        if (mode === 'audiobook') {
            const normalized = textContent.replace(/\r/g, '');
            const roughSegments = normalized.split(/\n+/);
            const segments = [];
            for (const seg of roughSegments) {
                let buf = '';
                for (const ch of seg) {
                    buf += ch;
                    if (/[。！？!?]/.test(ch)) {
                        segments.push(buf);
                        buf = '';
                    }
                }
                if (buf.trim()) segments.push(buf);
            }
            for (const seg of segments) {
                const trimmed = seg.trim();
                if (!trimmed) continue;
                result.push({ text: trimmed, character: 'Narrator', voice: settings.defaultVoice });
            }
            return result;
        }

        // GAL 模式：解析 VN 格式，未配置配音也纳入结果并打日志
        for (const line of textContent.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const parsed = parseVNLine(trimmed);
            if (parsed && !parsed.isAction) {
                const voice = voiceMap[parsed.character];
                if (voice === undefined || voice === null || voice === '') {
                    console.warn('[IndexTTS2] 角色未配置配音，将跳过推理:', parsed.character);
                }
                result.push({
                    text: parsed.dialogue,
                    character: parsed.character,
                    scene: parsed.scene || null,
                    voice: voice !== undefined && voice !== null && voice !== '' ? voice : undefined,
                    emotion: parsed.emotion || null,
                });
                console.log('[IndexTTS2][Ambient] collectVNLines push: character=' + parsed.character + ' scene=' + (parsed.scene || 'null'));
            }
        }
        return result;
    }

    function clearPlayingInMessage(msg) {
        if (!msg) return;
        msg.querySelectorAll('.indextts-dialogue.playing, .indextts-inline-play.playing').forEach(el => {
            el.classList.remove('playing');
        });
    }

    function setLinePlayingByEncoded(msg, encT, encC, isPlaying) {
        if (!msg || !encT) return;
        const selectorDialogue = `.indextts-dialogue[data-t="${encT}"]` + (encC ? `[data-c="${encC}"]` : '');
        const selectorBtn = `.indextts-inline-play[data-t="${encT}"]` + (encC ? `[data-c="${encC}"]` : '');
        msg.querySelectorAll(`${selectorDialogue}, ${selectorBtn}`).forEach(el => {
            if (isPlaying) {
                el.classList.add('playing');
            } else {
                el.classList.remove('playing');
            }
        });
    }

    function ensureMiniPlayer() {
        if (miniPlayerEl) return;
        miniPlayerEl = document.createElement('div');
        miniPlayerEl.id = 'indextts-mini-player';
        miniPlayerEl.className = 'indextts-mini-player';
        // HTML Structure: Toggle | Progress | Speed | (Hover Popup Slider)
        miniPlayerEl.innerHTML = `
            <div class="indextts-mini-inner">
                <button class="indextts-mini-toggle" type="button" title="暂停/继续">⏯</button>
                <input class="indextts-mini-progress" type="range" min="0" max="1000" step="1" value="0">
                <div class="indextts-mini-speed-container">
                    <span class="indextts-mini-speed-display" title="悬停调节倍速">1.0x</span>
                    <div class="indextts-mini-speed-popup">
                        <input type="range" class="indextts-speed-slider" min="0.25" max="5.0" step="0.25" value="1.0">
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(miniPlayerEl);

        miniPlayerProgress = miniPlayerEl.querySelector('.indextts-mini-progress');
        miniPlayerToggle = miniPlayerEl.querySelector('.indextts-mini-toggle');
        // Speed Elements
        const speedDisplay = miniPlayerEl.querySelector('.indextts-mini-speed-display');
        const speedSlider = miniPlayerEl.querySelector('.indextts-speed-slider');
        const speedContainer = miniPlayerEl.querySelector('.indextts-mini-speed-container');

        miniPlayerEl.addEventListener('mouseenter', () => {
            if (miniPlayerHideTimer) {
                clearTimeout(miniPlayerHideTimer);
                miniPlayerHideTimer = null;
            }
        });
        miniPlayerEl.addEventListener('mouseleave', () => {
            scheduleHideMiniPlayer();
        });

        if (miniPlayerToggle) {
            miniPlayerToggle.onclick = () => {
                // If global controller exists, use it
                if (currentPlayback.controller) {
                    if (currentPlayback.audio && !currentPlayback.audio.paused) {
                        currentPlayback.controller.pause();
                    } else {
                        currentPlayback.controller.play();
                    }
                } else if (currentPlayback.audio) {
                    // Fallback for single line
                    if (currentPlayback.audio.paused) {
                        currentPlayback.audio.play().catch(() => { });
                    } else {
                        currentPlayback.audio.pause();
                    }
                }
            };
        }

        if (miniPlayerProgress) {
            miniPlayerProgress.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value) || 0; // 0-1000
                const percent = val / 1000;

                // Priority: Global Playlist
                if (currentPlayback.playlist && currentPlayback.totalDuration > 0) {
                    if (currentPlayback.controller && currentPlayback.controller.seek) {
                        currentPlayback.controller.seek(percent);
                    }
                } else if (currentPlayback.audio) {
                    // Single file
                    const audio = currentPlayback.audio;
                    if (isFinite(audio.duration) && audio.duration > 0) {
                        audio.currentTime = audio.duration * percent;
                    }
                }
            });
        }

        // Speed Logic
        if (speedSlider && speedDisplay) {
            speedSlider.addEventListener('input', (e) => {
                const rate = parseFloat(e.target.value) || 1.0;
                speedDisplay.textContent = rate.toFixed(1) + 'x';

                // Update Settings & Audio
                getSettings().speed = rate;
                // Don't save on every drag event, maybe just update running audio
                if (currentPlayback.audio) {
                    currentPlayback.audio.playbackRate = rate;
                }
            });
            speedSlider.addEventListener('change', () => {
                saveSettings(); // Save on release
            });
        }
    }

    function showMiniPlayerForButton(btn) {
        ensureMiniPlayer();
        if (!miniPlayerEl) return;

        if (miniPlayerHideTimer) {
            clearTimeout(miniPlayerHideTimer);
            miniPlayerHideTimer = null;
        }

        const rect = btn.getBoundingClientRect();
        const top = rect.bottom + 6 + window.scrollY;
        const left = rect.left + window.scrollX;
        miniPlayerEl.style.top = `${top}px`;
        miniPlayerEl.style.left = `${left}px`;
        miniPlayerEl.classList.add('indextts-mini-visible');

        attachMiniPlayerToAudio(currentPlayback.audio);
    }

    function scheduleHideMiniPlayer() {
        if (!miniPlayerEl) return;
        if (miniPlayerHideTimer) {
            clearTimeout(miniPlayerHideTimer);
        }
        miniPlayerHideTimer = setTimeout(() => {
            if (miniPlayerEl) {
                miniPlayerEl.classList.remove('indextts-mini-visible');
            }
        }, 200);
    }

    function setupMiniPlayerHover(playBtn) {
        if (!playBtn || playBtn.dataset.indexttsHoverBound === 'true') return;
        playBtn.dataset.indexttsHoverBound = 'true';
        playBtn.addEventListener('mouseenter', () => {
            showMiniPlayerForButton(playBtn);
        });
        // Remove mouseleave hiding logic for button, rely on global hide timer logic
        // Because user needs to move mouse from button -> miniplayer
        playBtn.addEventListener('mouseleave', () => {
            scheduleHideMiniPlayer();
        });
    }

    function syncMiniPlayerSpeedUI(rate) {
        if (!miniPlayerEl) return;
        const display = miniPlayerEl.querySelector('.indextts-mini-speed-display');
        const slider = miniPlayerEl.querySelector('.indextts-speed-slider');
        if (display) display.textContent = rate.toFixed(1) + 'x';
        if (slider) slider.value = rate;
    }

    function attachMiniPlayerToAudio(audio, isGlobal = false) {
        if (!miniPlayerEl || !miniPlayerProgress || !miniPlayerToggle) return;

        // Cleanup old listeners
        if (miniPlayerBoundAudio && miniPlayerBoundAudio !== audio) {
            const old = miniPlayerBoundAudio;
            if (old._indexttsTimeUpdate) old.removeEventListener('timeupdate', old._indexttsTimeUpdate);
            if (old._indexttsPlay) old.removeEventListener('play', old._indexttsPlay);
            if (old._indexttsPause) old.removeEventListener('pause', old._indexttsPause);
            delete old._indexttsTimeUpdate;
            delete old._indexttsPlay;
            delete old._indexttsPause;
        }

        miniPlayerBoundAudio = audio || null;

        if (!audio) {
            miniPlayerProgress.value = 0;
            miniPlayerProgress.disabled = true;
            miniPlayerToggle.disabled = true;
            return;
        }

        miniPlayerProgress.disabled = false;
        miniPlayerToggle.disabled = false;

        const timeUpdate = () => {
            if (isGlobal && currentPlayback.playlist) {
                // Global Progress
                const currentItem = currentPlayback.playlist[currentPlayback.index];
                if (currentItem) {
                    const elapsed = currentItem.startOffset + audio.currentTime;
                    const total = currentPlayback.totalDuration || 1;
                    const percent = Math.min(1, Math.max(0, elapsed / total));
                    miniPlayerProgress.value = Math.floor(percent * 1000);
                    // Update CSS variable for "played" portion if custom styling needed (optional)
                    miniPlayerProgress.style.setProperty('--value', `${percent * 100}%`);
                }
            } else {
                // Single File Progress
                if (!isFinite(audio.duration) || !audio.duration) return;
                const percent = audio.currentTime / audio.duration;
                miniPlayerProgress.value = Math.floor(percent * 1000);
            }
        };

        const updateToggle = () => {
            miniPlayerToggle.textContent = audio.paused ? '▶' : '⏸';
        };

        audio._indexttsTimeUpdate = timeUpdate;
        audio._indexttsPlay = updateToggle;
        audio._indexttsPause = updateToggle;
        audio.addEventListener('timeupdate', timeUpdate);
        audio.addEventListener('play', updateToggle);
        audio.addEventListener('pause', updateToggle);

        // Sync Speed
        const settings = getSettings();
        const currentSpeed = settings.speed || 1.0;
        audio.playbackRate = currentSpeed;
        syncMiniPlayerSpeedUI(currentSpeed);

        updateToggle();
        timeUpdate();
    }

    // ==================== Floating Player Window (TTSPlayerWindow) ====================
    const TTSPlayerWindow = (() => {
        let container = null;
        let elements = {};
        let dragInfo = { isDragging: false, startX: 0, startY: 0, initialLeft: 0, initialTop: 0 };
        let currentTotalDuration = 0;
        let globalController = null;
        let lastVolume = 1.0;
        let hideTimer = null;
        const speedCycle = [0.25, 0.5, 1.0, 1.25, 1.5, 2.0, 3.0];

        function init() {
            if (container) return;
            container = document.createElement('div');
            container.className = 'indextts-player-window';
            container.innerHTML = `
                <div class="indextts-player-top" style="cursor: move;">
                    <div class="indextts-player-cover">
                        <img id="indextts-player-avatar" src="" alt="avatar" style="display:none;" onerror="this.style.display='none';this.parentElement.innerHTML='<i class=\\'fa-solid fa-music\\'></i>'">
                    </div>
                    <div class="indextts-player-info">
                        <div class="indextts-player-charname" id="indextts-player-name">Name</div>
                        <div class="indextts-player-text">
                            <span class="indextts-player-text-inner" id="indextts-player-currtext">...</span>
                        </div>
                    </div>
                    
                    <div class="indextts-player-speed-area">
                        <div class="indextts-player-speed-btn" id="indextts-player-speed-disp" title="右键原位编辑\n左键循环倍速\n悬停滑块细调">1.0x</div>
                        <div class="indextts-player-speed-popup">
                            <input type="range" class="indextts-speed-slider" id="indextts-player-speed-slider" min="0.1" max="3" step="0.1" value="1.0" orient="vertical">
                        </div>
                    </div>

                    <div class="indextts-player-volume-area">
                        <div class="indextts-player-volume-btn" id="indextts-player-volume-icon" title="右键原位编辑\n左键静音及恢复\n悬停滑块细调"><i class="fa-solid fa-volume-high"></i></div>
                        <div class="indextts-player-volume-popup">
                            <input type="range" class="indextts-volume-slider" id="indextts-player-volume-slider" min="0" max="2" step="0.05" value="1.0" orient="vertical">
                        </div>
                    </div>

                    <div class="indextts-player-controls">
                        <button class="indextts-ctrl-btn" id="indextts-player-prev" title="上一楼层"><i class="fa-solid fa-backward-step"></i></button>
                        <button class="indextts-ctrl-btn play-btn" id="indextts-player-play"><i class="fa-solid fa-play"></i></button>
                        <button class="indextts-ctrl-btn" id="indextts-player-next" title="下一楼层"><i class="fa-solid fa-forward-step"></i></button>
                    </div>
                    <button class="indextts-player-close" id="indextts-player-close" title="退出全文朗读"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div class="indextts-player-bottom">
                    <input type="range" class="indextts-player-progress" id="indextts-player-progress" min="0" max="1000" value="0">
                    <div class="indextts-player-time">
                        <span id="indextts-player-time-curr">0:00</span>
                        <span id="indextts-player-time-left">-0:00</span>
                    </div>
                </div>
            `;
            document.body.appendChild(container);

            elements = {
                avatar: container.querySelector('#indextts-player-avatar'),
                name: container.querySelector('#indextts-player-name'),
                currText: container.querySelector('#indextts-player-currtext'),
                speedBtn: container.querySelector('#indextts-player-speed-disp'),
                speedSlider: container.querySelector('#indextts-player-speed-slider'),
                speedPopup: container.querySelector('.indextts-player-speed-popup'),
                volumeBtn: container.querySelector('#indextts-player-volume-icon'),
                volumeSlider: container.querySelector('#indextts-player-volume-slider'),
                volumePopup: container.querySelector('.indextts-player-volume-popup'),
                btnPrev: container.querySelector('#indextts-player-prev'),
                btnPlay: container.querySelector('#indextts-player-play'),
                btnNext: container.querySelector('#indextts-player-next'),
                btnClose: container.querySelector('#indextts-player-close'),
                progress: container.querySelector('#indextts-player-progress'),
                timeCurr: container.querySelector('#indextts-player-time-curr'),
                timeLeft: container.querySelector('#indextts-player-time-left'),
                topArea: container.querySelector('.indextts-player-top')
            };

            // Bind Events
            elements.btnClose.addEventListener('click', hide);

            elements.btnPlay.addEventListener('click', () => {
                if (!globalController) return;
                const icon = elements.btnPlay.querySelector('i');
                if (icon.classList.contains('fa-pause')) {
                    globalController.pause();
                } else {
                    globalController.play();
                }
            });

            elements.progress.addEventListener('input', (e) => {
                if (!globalController) return;
                const percent = parseInt(e.target.value, 10) / 1000;
                globalController.seek(percent);
            });

            // --- Speed Logic ---
            const updateSpeed = (val) => {
                val = parseFloat(val);
                if (isNaN(val)) return;
                val = Math.max(0.1, Math.min(3.0, val));
                elements.speedBtn.textContent = val.toFixed(1) + 'x';
                elements.speedSlider.value = val;
                const s = getSettings();
                s.speed = val;
                saveSettings();
                syncMiniPlayerSpeedUI(val);
                if (currentPlayback.audio) {
                    currentPlayback.audio.playbackRate = val;
                }
            };

            elements.speedBtn.addEventListener('click', () => {
                const current = parseFloat(getSettings().speed || 1.0);
                let next = speedCycle[0];
                for (let i = 0; i < speedCycle.length; i++) {
                    if (speedCycle[i] > current + 0.01) {
                        next = speedCycle[i];
                        break;
                    }
                }
                updateSpeed(next);
            });

            elements.speedSlider.addEventListener('input', (e) => updateSpeed(e.target.value));

            // --- Volume Logic ---
            const updateVolume = (val, save = true) => {
                val = parseFloat(val);
                if (isNaN(val)) return;
                val = Math.max(0, Math.min(2.0, val));
                elements.volumeSlider.value = val;

                const icon = elements.volumeBtn.querySelector('i');
                if (icon) {
                    if (val === 0) icon.className = 'fa-solid fa-volume-xmark';
                    else if (val < 0.5) icon.className = 'fa-solid fa-volume-low';
                    else icon.className = 'fa-solid fa-volume-high';
                }

                if (save) {
                    const s = getSettings();
                    s.volume = val;
                    saveSettings();
                    if (val > 0) lastVolume = val;
                }
                if (currentPlayback.audio) {
                    currentPlayback.audio.volume = Math.min(1.0, val);
                }
            };

            elements.volumeBtn.addEventListener('click', () => {
                const s = getSettings();
                if (parseFloat(s.volume) > 0) {
                    lastVolume = parseFloat(s.volume);
                    updateVolume(0);
                } else {
                    updateVolume(lastVolume || 1.0);
                }
            });

            elements.volumeSlider.addEventListener('input', (e) => updateVolume(e.target.value));

            // --- Inline Edit Logic ---
            const setupInlineEdit = (btnEl, currentValueGetter, valSetter) => {
                btnEl.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    if (btnEl.querySelector('input')) return;

                    const originalHTML = btnEl.innerHTML;
                    const input = document.createElement('input');
                    input.type = 'number';
                    input.className = 'indextts-inline-edit-input';
                    input.value = currentValueGetter();
                    input.step = '0.1';

                    btnEl.innerHTML = '';
                    btnEl.appendChild(input);

                    input.focus();
                    input.select();

                    const finishEdit = (save) => {
                        btnEl.innerHTML = originalHTML;
                        if (save) {
                            let val = parseFloat(input.value);
                            if (btnEl === elements.volumeBtn && val > 2.0) {
                                val = val / 100.0;
                            }
                            valSetter(val);
                        }
                    };

                    input.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            finishEdit(true);
                        }
                        if (e.key === 'Escape') finishEdit(false);
                    });
                    input.addEventListener('blur', () => finishEdit(false));
                });
            };

            setupInlineEdit(elements.speedBtn, () => parseFloat(getSettings().speed || 1.0), updateSpeed);
            setupInlineEdit(elements.volumeBtn, () => parseFloat(getSettings().volume || 1.0), updateVolume);

            // --- Hover Delay Popup Logic ---
            const setupPopup = (areaClass, popupEl) => {
                const area = container.querySelector(`.${areaClass}`);
                const show = () => {
                    if (hideTimer) {
                        clearTimeout(hideTimer);
                        hideTimer = null;
                    }
                    if (popupEl !== elements.speedPopup) elements.speedPopup.classList.remove('visible');
                    if (popupEl !== elements.volumePopup) elements.volumePopup.classList.remove('visible');
                    popupEl.classList.add('visible');
                };
                const hide = () => {
                    hideTimer = setTimeout(() => {
                        popupEl.classList.remove('visible');
                    }, 500);
                };
                area.addEventListener('mouseenter', show);
                area.addEventListener('mouseleave', hide);
                popupEl.addEventListener('mouseenter', show);
                popupEl.addEventListener('mouseleave', hide);
            };

            setupPopup('indextts-player-speed-area', elements.speedPopup);
            setupPopup('indextts-player-volume-area', elements.volumePopup);

            // Dragging Logic
            elements.topArea.addEventListener('mousedown', (e) => {
                if (e.target.closest('.indextts-ctrl-btn') || e.target.closest('.indextts-player-close') || e.target.closest('.indextts-player-speed-area') || e.target.closest('.indextts-player-volume-area')) return;
                dragInfo.isDragging = true;
                dragInfo.startX = e.clientX;
                dragInfo.startY = e.clientY;
                const rect = container.getBoundingClientRect();
                dragInfo.initialLeft = rect.left;
                dragInfo.initialTop = rect.top;
                container.style.transform = 'none'; // Clear translate transform for absolute positioning
                container.style.left = dragInfo.initialLeft + 'px';
                container.style.top = dragInfo.initialTop + 'px';
                container.style.bottom = 'auto';
            });
            document.addEventListener('mousemove', (e) => {
                if (!dragInfo.isDragging) return;
                const dx = e.clientX - dragInfo.startX;
                const dy = e.clientY - dragInfo.startY;
                container.style.left = (dragInfo.initialLeft + dx) + 'px';
                container.style.top = (dragInfo.initialTop + dy) + 'px';
            });
            document.addEventListener('mouseup', () => { dragInfo.isDragging = false; });

            // Floor Nav
            elements.btnPrev.addEventListener('click', () => navigateFloor(-1));
            elements.btnNext.addEventListener('click', () => navigateFloor(1));
        }

        function formatTime(seconds) {
            if (!seconds || isNaN(seconds)) return '0:00';
            const m = Math.floor(seconds / 60);
            const s = Math.floor(seconds % 60);
            return `${m}:${s.toString().padStart(2, '0')}`;
        }

        function updateProgress(elapsed, total) {
            if (!container || !container.classList.contains('visible')) return;
            currentTotalDuration = total;
            const percent = total > 0 ? Math.min(1, Math.max(0, elapsed / total)) : 0;
            elements.progress.value = Math.floor(percent * 1000);
            elements.timeCurr.textContent = formatTime(elapsed);
            elements.timeLeft.textContent = '-' + formatTime(total - elapsed);
        }

        function updatePlayState(isPlaying) {
            if (!container) return;
            elements.btnPlay.innerHTML = isPlaying ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play"></i>';
        }

        function updateInfo(data) {
            if (!container) return;
            if (data.name) elements.name.textContent = data.name;
            if (data.text) {
                const text = data.text;
                elements.currText.textContent = text;
                elements.currText.classList.remove('marquee');
                elements.currText.style.animationDuration = '0s';

                // Seamless Marquee: clone text if overflow
                setTimeout(() => {
                    const parent = elements.currText.parentElement;
                    if (elements.currText.scrollWidth > parent.clientWidth + 5) {
                        elements.currText.innerHTML = `${text} <span style="margin-right:50px;"></span> ${text}`;
                        elements.currText.classList.add('marquee');
                        const duration = Math.max(10, Math.floor(elements.currText.scrollWidth / 40));
                        elements.currText.style.animationDuration = `${duration}s`;
                    }
                }, 50);
            }
            if (data.avatarUrl) {
                elements.avatar.src = data.avatarUrl;
                elements.avatar.style.display = 'block';
                elements.avatar.parentElement.querySelector('i')?.remove();
            }
        }

        function navigateFloor(direction) {
            if (!currentPlayback.msg) return;
            const currentMsg = currentPlayback.msg;
            const allMes = Array.from(document.querySelectorAll('.mes[is_user="false"]'));
            const currentIndex = allMes.indexOf(currentMsg);

            if (currentIndex === -1) return;

            let targetMsg = null;
            let iterIndex = currentIndex + direction;

            while (iterIndex >= 0 && iterIndex < allMes.length) {
                const tempMsg = allMes[iterIndex];
                if (tempMsg.querySelector('.indextts-play')) {
                    targetMsg = tempMsg;
                    break;
                }
                iterIndex += direction;
            }

            if (targetMsg) {
                const btn = targetMsg.querySelector('.indextts-play');
                if (btn) btn.click();
            } else {
                if (window.toastr) window.toastr.info(direction === 1 ? '已经是最后一个有效楼层' : '已经是第一个有效楼层');
            }
        }

        function show(msg, controller) {
            init();
            globalController = controller;

            // Sync current speed & volume
            const settings = getSettings();
            const speed = parseFloat(settings.speed || 1.0);
            const volume = parseFloat(settings.volume || 1.0);

            elements.speedBtn.textContent = speed.toFixed(1) + 'x';
            elements.speedSlider.value = speed;

            elements.volumeSlider.value = volume;
            lastVolume = volume > 0 ? volume : (lastVolume || 1.0);

            const vIcon = elements.volumeBtn.querySelector('i');
            if (vIcon) {
                if (volume === 0) vIcon.className = 'fa-solid fa-volume-xmark';
                else if (volume < 0.5) vIcon.className = 'fa-solid fa-volume-low';
                else vIcon.className = 'fa-solid fa-volume-high';
            }

            // Extract UI info from msg
            const nameEl = msg.querySelector('.ch_name');
            const avatarEl = msg.querySelector('.avatar img');
            updateInfo({
                name: nameEl ? nameEl.textContent.trim() : 'Unknown',
                avatarUrl: avatarEl ? avatarEl.src : null,
                text: '正在缓冲...'
            });

            container.classList.add('visible');
        }

        function hide() {
            if (container) {
                container.classList.remove('visible');
                if (globalController) {
                    globalController.pause();
                }
                globalController = null;
            }
        }

        return { show, hide, updateProgress, updatePlayState, updateInfo };
    })();

    // 流式推理播放辅助函数
    async function streamInferAndPlay(msg, lines, triggerBtn, isSilent) {
        const settings = getSettings();
        const mesId = getMessageId(msg);
        if (!mesId) return [];

        const list = []; // 已推理的音频列表
        const skipCount = settings.streamingSkipCount || 1;
        let currentInferIndex = 0;
        let currentPlayIndex = 0;
        let isPlaying = false;
        let currentAudio = null;
        let inferDone = false;
        let cachedCount = 0;

        // 创建唯一会话ID用于流式播放
        const sessionId = Date.now();

        // 辅助函数：播放队列中的音频
        const playNextAudio = async () => {
            console.log('[IndexTTS2] Streaming: playNextAudio called, currentPlayIndex=' + currentPlayIndex + ', list.length=' + list.length);

            // 如果队列为空，等待新内容
            const waitForContent = () => {
                return new Promise(resolve => {
                    const checkInterval = setInterval(() => {
                        if (currentPlayIndex < list.length) {
                            clearInterval(checkInterval);
                            resolve();
                        } else if (inferDone) {
                            clearInterval(checkInterval);
                            resolve('done');
                        }
                    }, 50);
                });
            };

            const waitResult = await waitForContent();
            if (waitResult === 'done' || currentPlayIndex >= list.length) {
                console.log('[IndexTTS2] Streaming: playback finished');
                AmbientPlayer.stop(); // 停止背景音
                if (currentPlayback.stop) currentPlayback.stop();
                clearPlayingInMessage(msg);
                return;
            }

            const item = list[currentPlayIndex];
            if (!item) {
                console.warn('[IndexTTS2] Streaming: invalid item at index', currentPlayIndex);
                currentPlayIndex++;
                playNextAudio();
                return;
            }

            // 清理之前的音频
            if (currentAudio) {
                currentAudio.pause();
                currentAudio.onended = null;
                currentAudio.onerror = null;
                currentAudio.src = '';
            }

            currentAudio = new Audio(item.blobUrl);
            currentPlayback.audio = currentAudio;
            currentPlayback.msg = msg;
            currentPlayback.mesId = mesId;
            currentPlayback.index = currentPlayIndex;
            currentPlayback.sessionId = sessionId;

            // 音量与速度
            const vol = parseFloat(settings.volume || 1.0);
            currentAudio.volume = Math.max(0, Math.min(1, vol));
            currentAudio.playbackRate = parseFloat(settings.speed || 1.0);

            // UI高亮
            const encT = utf8ToBase64(item.text);
            const encC = utf8ToBase64(item.character || '');
            clearPlayingInMessage(msg);
            setLinePlayingByEncoded(msg, encT, encC, true);

            // 更新浮动播放器
            const avatarEl = msg.querySelector('.avatar img');
            let displayChar = item.character || 'Unknown';
            if (displayChar.toLowerCase() === 'narrator' && avatarEl) {
                const nameEl = msg.querySelector('.ch_name');
                if (nameEl) displayChar = nameEl.textContent.trim();
            }
            TTSPlayerWindow.updateInfo({
                name: displayChar,
                text: item.text,
                avatarUrl: avatarEl ? avatarEl.src : null
            });

            attachMiniPlayerToAudio(currentAudio, true);

            // 场景背景音 - 流式播放时每个track都播放
            console.log('[IndexTTS2][Streaming] Ambient playScene: ' + item.scene);
            AmbientPlayer.playScene(item.scene || null);

            // 播放结束回调
            currentAudio.onended = () => {
                setLinePlayingByEncoded(msg, encT, encC, false);
                // 停止背景音（非最后一句用stopImmediate，最后一句用stop）
                if (currentPlayIndex + 1 < list.length) {
                    AmbientPlayer.stopImmediate();
                } else {
                    AmbientPlayer.stop();
                }
                currentPlayIndex++;
                playNextAudio();
            };

            currentAudio.onerror = () => {
                console.error('[IndexTTS2] Streaming track error at index:', currentPlayIndex);
                setLinePlayingByEncoded(msg, encT, encC, false);
                AmbientPlayer.stopImmediate();
                currentPlayIndex++;
                playNextAudio();
            };

            try {
                await currentAudio.play();
            } catch (e) {
                if (e.name === 'NotAllowedError') {
                    if (window.toastr) window.toastr.warning('浏览器已拦截自动播放，请先点击页面任意处');
                    return;
                }
                // 出错则跳到下一句
                currentPlayIndex++;
                playNextAudio();
            }
        };

        // 推理循环
        const inferLoop = async () => {
            console.log('[IndexTTS2] Streaming: starting inferLoop, lines.length=' + lines.length + ', skipCount=' + skipCount);
            while (currentInferIndex < lines.length) {
                // 只在播放开始后才检查 session 匹配
                if (isPlaying && currentPlayback.sessionId !== sessionId) {
                    console.log('[IndexTTS2] Streaming: inferLoop stopped due to session mismatch');
                    return;
                }

                const line = lines[currentInferIndex];
                if (!line.voice) {
                    currentInferIndex++;
                    continue;
                }

                try {
                    const record = await ensureAudioRecord({
                        text: line.text,
                        character: line.character,
                        voice: line.voice,
                        emotion: line.emotion,
                    });
                    if (!record) {
                        currentInferIndex++;
                        continue;
                    }

                    if (record.isCached) cachedCount++;
                    const blobUrl = URL.createObjectURL(record.blob);
                    const newItem = {
                        text: line.text,
                        character: line.character,
                        scene: line.scene || null,
                        voice: line.voice,
                        hash: record.hash,
                        blobUrl,
                    };

                    // 添加到播放列表
                    list.push(newItem);
                    audioCache[mesId] = list;
                    console.log('[IndexTTS2] Streaming: added item, list.length=' + list.length);

                    // 通知UI更新进度
                    if (window.toastr && !isSilent) {
                        const progress = Math.round(((currentInferIndex + 1) / lines.length) * 100);
                        window.toastr.info(`推理进度: ${currentInferIndex + 1}/${lines.length} (${progress}%)`, { timeOut: 1000 });
                    }

                    // 如果推理数量达到阈值，开始播放
                    if (list.length >= skipCount && !isPlaying) {
                        console.log('[IndexTTS2] Streaming: triggering playback, list.length=' + list.length + ', skipCount=' + skipCount);
                        isPlaying = true;
                        currentPlayIndex = 0;

                        // 创建全局控制器
                        currentPlayback.sessionId = sessionId;
                        currentPlayback.controller = {
                            pause: () => { if (currentAudio) currentAudio.pause(); },
                            play: () => { if (currentAudio) currentAudio.play(); },
                            seek: (percent) => {
                                const targetTime = list.length * percent;
                                const targetIndex = Math.min(Math.floor(targetTime), list.length - 1);
                                if (targetIndex === currentPlayIndex && currentAudio) {
                                    currentAudio.currentTime = targetTime - targetIndex;
                                } else {
                                    currentPlayIndex = targetIndex;
                                    playNextAudio();
                                }
                            }
                        };

                        TTSPlayerWindow.show(msg, currentPlayback.controller);
                        playNextAudio();
                    }

                } catch (e) {
                    console.error('[IndexTTS2] Streaming infer error:', e);
                }

                currentInferIndex++;

                // 如果推理完成了但还没开始播放（skipCount > list.length）
                if (currentInferIndex >= lines.length && !isPlaying && list.length > 0) {
                    inferDone = true;
                    isPlaying = true;
                    currentPlayIndex = 0;

                    // 创建全局控制器
                    currentPlayback.sessionId = sessionId;
                    currentPlayback.controller = {
                        pause: () => { if (currentAudio) currentAudio.pause(); },
                        play: () => { if (currentAudio) currentAudio.play(); },
                        seek: (percent) => {
                            const targetTime = list.length * percent;
                            const targetIndex = Math.min(Math.floor(targetTime), list.length - 1);
                            if (targetIndex === currentPlayIndex && currentAudio) {
                                currentAudio.currentTime = targetTime - targetIndex;
                            } else {
                                currentPlayIndex = targetIndex;
                                playNextAudio();
                            }
                        }
                    };

                    TTSPlayerWindow.show(msg, currentPlayback.controller);
                    playNextAudio();
                }
            }
        };

        // 开始推理
        inferLoop();

        return list;
    }

    async function inferMessageAudios(msg, triggerBtn, isSilent = false) {
        if (!msg) return;
        const mesId = getMessageId(msg);
        if (!mesId) return;

        // 已有缓存则直接使用（非流式模式）
        if (audioCache[mesId] && audioCache[mesId].length) {
            const settings = getSettings();
            // 如果启用了流式播放，先清空缓存重新推理
            if (settings.streamingPlay) {
                // 清空该消息的缓存，准备流式推理
                audioCache[mesId].forEach(item => {
                    if (item.blobUrl) URL.revokeObjectURL(item.blobUrl);
                });
                delete audioCache[mesId];
            } else {
                return audioCache[mesId];
            }
        }

        // 推理锁：防止重复请求
        if (inferenceLocks.has(mesId)) {
            if (!isSilent && window.toastr) window.toastr.warning('正在推理中，请稍候...');
            return audioCache[mesId] || [];
        }
        inferenceLocks.add(mesId);

        let iconEl = null;
        let originalIconClass = '';

        if (triggerBtn) {
            triggerBtn.classList.add('disabled');
            iconEl = triggerBtn.querySelector('i');
            if (iconEl) {
                originalIconClass = iconEl.className;
                iconEl.className = 'fa-solid fa-spinner fa-spin';
            }
        } else {
            // 自动推理时的 UI 反馈（给播放和推理按钮加呼吸灯）
            const inferBtn = msg.querySelector('.indextts-infer');
            if (inferBtn) inferBtn.classList.add('indextts-inferring');
        }

        const settings = getSettings();

        try {
            const cardId = getCardId();
            const lines = collectVNLinesFromMessage(msg);
            const list = [];
            const unvoicedCount = lines.filter(l => !l.voice).length;

            if (!lines.length) {
                if (!isSilent && window.toastr) window.toastr.warning('未在消息中发现符合格式的 [角色] 文本，请检查是否为 GAL 模式及剧本格式');
                return [];
            } else if (unvoicedCount === lines.length) {
                if (!isSilent && window.toastr) window.toastr.warning('发现角色对话但均未在配置表格中关联配音，请先点击配置绑定音色');
                return [];
            }

            // 流式推理播放模式
            if (settings.streamingPlay) {
                const skipCount = settings.streamingSkipCount || 1;
                if (window.toastr && !isSilent) {
                    window.toastr.info(`流式推理播放模式已启用（每推理 ${skipCount} 句后开始播放）`);
                }
                return await streamInferAndPlay(msg, lines, triggerBtn, isSilent);
            }

            // 传统模式：全部推理完成后再播放
            let cachedCount = 0;
            for (const line of lines) {
                try {
                    if (!line.voice) continue;

                    const record = await ensureAudioRecord({
                        text: line.text,
                        character: line.character,
                        voice: line.voice,
                        emotion: line.emotion,
                    });
                    if (!record) continue;
                    if (record.isCached) cachedCount++;
                    const blobUrl = URL.createObjectURL(record.blob);
                    list.push({
                        text: line.text,
                        character: line.character,
                        scene: line.scene || null,
                        voice: line.voice,
                        hash: record.hash,
                        blobUrl,
                    });
                } catch (e) {
                    console.error('[IndexTTS2] inferMessageAudios line error:', e);
                }
            }

            audioCache[mesId] = list;

            if (list.length) {
                const playBtn = msg.querySelector('.indextts-play');
                if (playBtn) playBtn.classList.add('indextts-prepared');
                if (window.toastr && !isSilent) {
                    let msgStr = cachedCount === list.length ? `已从缓存装载 ${list.length} 句音频` : `已推理 ${list.length} 句音频`;
                    if (unvoicedCount > 0 && unvoicedCount < lines.length) {
                        window.toastr.success(`${msgStr}，${unvoicedCount} 句未配置配音已跳过`);
                    } else {
                        window.toastr.success(msgStr);
                    }
                }
            }

            return list;
        } finally {
            inferenceLocks.delete(mesId);
            if (triggerBtn) {
                triggerBtn.classList.remove('disabled');
                if (iconEl && originalIconClass) {
                    iconEl.className = originalIconClass;
                }
            } else {
                const inferBtn = msg.querySelector('.indextts-infer');
                if (inferBtn) inferBtn.classList.remove('indextts-inferring');
            }
        }
    }

    function playMessageQueue(msg, triggerBtn) {
        if (!msg) return;
        const mesId = getMessageId(msg);
        if (!mesId) return;

        // 如果该楼层正在推理，直接提示并返回
        if (inferenceLocks.has(mesId)) {
            if (window.toastr) window.toastr.warning('正在推理中，请稍候...');
            return;
        }

        (async () => {
            let queue = audioCache[mesId] || [];
            if (!queue.length) {
                await inferMessageAudios(msg, null, true);
                queue = audioCache[mesId] || [];
                if (!queue.length) {
                    if (window.toastr) window.toastr.warning('无储备音频，请先点击推理！');
                    return;
                }
            }

            // 1. Pre-calculate durations for Global Scrubber
            if (window.toastr) window.toastr.info('正在准备播放列表...');

            // Cleanup previous playback
            if (currentPlayback.stop) {
                currentPlayback.stop();
            } else if (currentPlayback.audio) {
                try { currentPlayback.audio.pause(); } catch (e) { }
            }
            clearPlayingInMessage(currentPlayback.msg);

            const playlist = [];
            let totalDuration = 0;

            // Helper to load duration
            const loadDuration = (blobUrl) => new Promise((resolve) => {
                const a = new Audio(blobUrl);
                a.onloadedmetadata = () => resolve(a.duration);
                a.onerror = () => resolve(0);
                // Timeout fallback
                setTimeout(() => resolve(0), 1000);
            });

            for (let i = 0; i < queue.length; i++) {
                const item = queue[i];
                const dur = await loadDuration(item.blobUrl);
                playlist.push({
                    ...item,
                    index: i,
                    duration: dur,
                    startOffset: totalDuration
                });
                totalDuration += dur;
            }

            if (totalDuration === 0) {
                if (window.toastr) window.toastr.error('音频时长获取失败');
                return;
            }

            // 2. Setup Global Controller
            const settings = getSettings();
            let currentIndex = 0;
            let currentAudio = null;

            // Create unique session ID
            const currentQueueId = Date.now();
            currentPlayback.sessionId = currentQueueId;

            // Precompute scene segments for ambientLoopByScene mode
            // Each playlist item gets: sceneSegStart, sceneSegEnd (inclusive indices of its scene run)
            (function buildSceneSegments() {
                let i = 0;
                while (i < playlist.length) {
                    const scene = playlist[i].scene;
                    let j = i;
                    while (j < playlist.length && playlist[j].scene === scene) j++;
                    for (let k = i; k < j; k++) {
                        playlist[k].sceneSegStart = i;
                        playlist[k].sceneSegEnd = j - 1;
                    }
                    i = j;
                }
            })();

            const playTrack = (index, seekTime = 0) => {
                // Session Check
                if (currentPlayback.sessionId !== currentQueueId) return;

                if (index >= playlist.length) {
                    // Reset or Stop
                    currentPlayback.stop();
                    clearPlayingInMessage(msg);
                    return;
                }

                currentIndex = index;
                const item = playlist[index];

                // Cleanup prev
                if (currentAudio) {
                    currentAudio.pause();
                    currentAudio.onended = null;
                    currentAudio.onerror = null;
                    if (currentAudio._indexttsTimeUpdate) currentAudio.removeEventListener('timeupdate', currentAudio._indexttsTimeUpdate);
                    currentAudio.src = ''; // help GC
                }

                const audio = new Audio(item.blobUrl);
                currentAudio = audio;

                // Globals
                currentPlayback.audio = audio;
                currentPlayback.msg = msg;
                currentPlayback.mesId = mesId;
                currentPlayback.index = index;
                currentPlayback.playlist = playlist;
                currentPlayback.totalDuration = totalDuration;

                // Volume & Speed
                const vol = parseFloat(settings.volume || 1.0);
                audio.volume = Math.max(0, Math.min(1, vol));
                audio.playbackRate = parseFloat(settings.speed || 1.0);

                // 场景背景音
                console.log('[IndexTTS2][Ambient] playTrack index=' + index + ' scene=' + item.scene + ' dirHandle=' + (AmbientPlayer.getDirHandle() ? 'SET' : 'NULL'));
                if (getSettings().ambientLoopByScene) {
                    // 场景循环模式：仅在该 scene 段的第一条 track 启动背景音
                    if (index === item.sceneSegStart) {
                        console.log('[IndexTTS2][Ambient] LoopByScene: START scene=' + item.scene + ' seg=[' + item.sceneSegStart + ',' + item.sceneSegEnd + ']');
                        AmbientPlayer.playScene(item.scene || null);
                    }
                } else {
                    AmbientPlayer.playScene(item.scene || null);
                }

                // Seek if needed
                if (seekTime > 0) {
                    audio.currentTime = seekTime;
                }

                // UI Highlight
                const encT = utf8ToBase64(item.text);
                const encC = utf8ToBase64(item.character || '');
                clearPlayingInMessage(msg);
                setLinePlayingByEncoded(msg, encT, encC, true);

                // Update Floater UI Info
                const avatarEl = msg.querySelector('.avatar img');
                let displayChar = item.character || 'Unknown';
                if (displayChar.toLowerCase() === 'narrator' && avatarEl) {
                    // Try to extract root character if narrator
                    const nameEl = msg.querySelector('.ch_name');
                    if (nameEl) displayChar = nameEl.textContent.trim();
                }

                TTSPlayerWindow.updateInfo({
                    name: displayChar,
                    text: item.text,
                    avatarUrl: avatarEl ? avatarEl.src : null
                });

                // Bind Mini Player & Floater (Global Mode)
                attachMiniPlayerToAudio(audio, true);

                // Hook floater UI updates into audio playback
                audio.addEventListener('timeupdate', () => {
                    const elapsed = item.startOffset + audio.currentTime;
                    // Ensure the duration doesn't jump arbitrarily to 0 during segment shifts
                    TTSPlayerWindow.updateProgress(elapsed, totalDuration);
                });
                audio.addEventListener('play', () => TTSPlayerWindow.updatePlayState(true));
                audio.addEventListener('pause', () => TTSPlayerWindow.updatePlayState(false));

                // Events
                audio.onended = () => {
                    setLinePlayingByEncoded(msg, encT, encC, false);
                    if (getSettings().ambientLoopByScene) {
                        // 场景循环模式：仅在该 scene 段的最后一条 track 结束时停止背景音
                        const isLastInSeg = (index === item.sceneSegEnd);
                        const isLastTrack = (index + 1 >= playlist.length);
                        if (isLastInSeg || isLastTrack) {
                            console.log('[IndexTTS2][Ambient] LoopByScene: STOP scene=' + item.scene + ' isLastTrack=' + isLastTrack);
                            AmbientPlayer.stop();
                        }
                    } else {
                        if (index + 1 >= playlist.length) {
                            AmbientPlayer.stop();
                        } else {
                            AmbientPlayer.stopImmediate();
                        }
                    }
                    playTrack(index + 1);
                };
                audio.onerror = () => {
                    console.error('[IndexTTS2] Track error');
                    playTrack(index + 1);
                };

                audio.play().catch(e => {
                    console.error('[IndexTTS2] Auto-play block?', e);
                    // 浏览器自动播放策略拦截：提示用户手动点击，不继续跳轨
                    if (e.name === 'NotAllowedError') {
                        if (window.toastr) window.toastr.warning('浏览器已拦截自动播放，请先点击页面任意处，或手动点击播放按钮');
                        // 标记播放按钮为已就绪，方便用户手动点击
                        const playBtn = msg.querySelector('.indextts-play');
                        if (playBtn) playBtn.classList.add('indextts-prepared');
                        return;
                    }
                    playTrack(index + 1);
                });
            };

            const controller = {
                seek: (percent) => {
                    const targetTime = totalDuration * percent;
                    // Find segment
                    let targetIndex = 0;
                    let offsetInTrack = 0;

                    for (let i = 0; i < playlist.length; i++) {
                        const track = playlist[i];
                        if (targetTime >= track.startOffset && targetTime < (track.startOffset + track.duration)) {
                            targetIndex = i;
                            offsetInTrack = targetTime - track.startOffset;
                            break;
                        }
                    }
                    // Handle edge case (100%)
                    if (percent >= 0.99) {
                        targetIndex = playlist.length - 1;
                        offsetInTrack = playlist[targetIndex].duration - 0.1;
                    }

                    if (targetIndex === currentIndex && currentAudio) {
                        currentAudio.currentTime = offsetInTrack;
                    } else {
                        playTrack(targetIndex, offsetInTrack);
                    }
                },
                pause: () => {
                    if (currentAudio) currentAudio.pause();
                },
                play: () => {
                    if (currentAudio) currentAudio.play();
                }
            };

            currentPlayback.controller = controller;

            // Show Floating Player
            TTSPlayerWindow.show(msg, controller);

            // Start
            playTrack(0);

        })().catch(e => {
            console.error('[IndexTTS2] playMessageQueue error:', e);
            if (window.toastr) window.toastr.error('播放队列出错: ' + e.message);
        });
    }


    // ==================== Auto Play ====================
    // 自动播放：推理完成后触发，处理浏览器自动播放限制
    async function autoPlayMessage(msg) {
        if (!msg) return;
        const mesId = getMessageId(msg);
        if (!mesId) return;

        // 如果当前已有播放，不打断
        if (currentPlayback.audio && !currentPlayback.audio.paused) {
            console.log('[IndexTTS2] AutoPlay: skipped, audio already playing');
            return;
        }

        const queue = audioCache[mesId] || [];
        if (!queue.length) {
            console.log('[IndexTTS2] AutoPlay: no audio in cache for', mesId);
            return;
        }

        console.log('[IndexTTS2] AutoPlay: starting playback for', mesId);
        try {
            playMessageQueue(msg, null);
        } catch (e) {
            // 捕获同步异常（异步异常在 playMessageQueue 内部处理）
            console.warn('[IndexTTS2] AutoPlay: playMessageQueue threw synchronously:', e);
        }
    }

    function refreshAllMessages() {
        document.querySelectorAll('.mes[is_user="false"]').forEach(msg => {
            // Remove old inline elements and re-inject
            const mesText = msg.querySelector('.mes_text');
            if (mesText) {
                mesText.querySelectorAll('.indextts-inline-play, .indextts-dialogue').forEach(el => {
                    // Unwrap dialogue spans (preserve text content)
                    if (el.classList.contains('indextts-dialogue')) {
                        el.replaceWith(...el.childNodes);
                    } else {
                        el.remove();
                    }
                });
                delete mesText.dataset.indexttsInjected;
            }
            injectMessageButtons(msg);
            injectInlineButtons(msg, true);
        });
    }


    // ==================== Settings Panel ====================
    function injectSettingsPanel() {
        if (document.getElementById('indextts-settings')) {
            // Panel exists, check if we need to update values from external changes (e.g. init load)
            const settings = getSettings();

            // Sync values if they don't match (simple one-way binding check)
            const urlInput = document.getElementById('indextts-url');
            if (urlInput && urlInput.value !== settings.apiUrl) urlInput.value = settings.apiUrl;

            // ... (We could do this for all fields, but usually re-injection isn't frequent if ID check prevents it)
            // However, for the path specifically, we want to ensure it's up to date
            const pathMsg = settings.cacheImportPath || '未设置本地目录';
            const pathInput = document.getElementById('indextts-local-path');
            if (pathInput && pathInput.value !== pathMsg) pathInput.value = pathMsg;

            return;
        }

        const container = document.getElementById('extensions_settings') || document.getElementById('extensions_settings_container');
        if (!container) return;

        const settings = getSettings();
        const volumeVal = typeof settings.volume === 'number' ? settings.volume : 1.0;

        // Prepare Path Display
        let pathDisplay = settings.cacheImportPath || '未设置本地目录';
        const handle = LocalRepo.getHandle();
        if (handle && handle.name) {
            pathDisplay = handle.name;
        }

        const html = `
            <div id="indextts-settings" class="extension_settings">
                <div class="inline-drawer">
                    <div class="inline-drawer-toggle inline-drawer-header">
                        <b>IndexTTS2 播放器</b>
                        <i class="inline-drawer-icon fa-solid fa-circle-chevron-down"></i>
                    </div>
                    <div class="inline-drawer-content" style="display:none;">
                        
                        <!-- 预设管理 -->
                        <div class="indextts-setting-module">
                            <div class="indextts-module-header">⚙️ 预设管理</div>
                            <div class="indextts-preset-bar">
                                <select id="indextts-preset-select" class="text_pole"></select>
                                <input type="text" id="indextts-preset-name" class="text_pole" placeholder="预设名称">
                                <div id="indextts-preset-save" class="menu_button" title="保存/新建预设">
                                    <i class="fa-solid fa-floppy-disk"></i>
                                </div>
                                <div id="indextts-preset-delete" class="menu_button" title="删除预设">
                                    <i class="fa-solid fa-trash-can"></i>
                                </div>
                            </div>
                        </div>

                        <!-- 模块1：服务配置 -->
                        <div class="indextts-setting-module">
                            <div class="indextts-module-header">🔌 服务配置</div>
                            <div class="indextts-setting-row">
                                <label>TTS 服务地址</label>
                                <input type="text" id="indextts-url" class="text_pole" value="${settings.apiUrl}">
                            </div>
                            <div class="indextts-setting-row">
                                <label>音色克隆地址</label>
                                <input type="text" id="indextts-clone-url" class="text_pole" value="${settings.cloningUrl}">
                            </div>
                            <div class="indextts-setting-row">
                                <label>音频列表地址</label>
                                <input type="text" id="indextts-voice-list-url" class="text_pole" value="${settings.voiceListUrl || 'http://127.0.0.1:7880/api/v1/voices'}">
                            </div>
                             <div class="indextts-setting-row">
                                <label>推理模型名称</label>
                                <input type="text" id="indextts-model" class="text_pole" value="${settings.model}">
                            </div>
                        </div>

                        <!-- 模块：提示词管理 -->
                        <div class="indextts-setting-module">
                            <div class="indextts-module-header">📝 提示词管理</div>
                             <div class="indextts-setting-row checkbox-row">
                                <label for="indextts-prompt-enable">启用提示词注入</label>
                                <input type="checkbox" id="indextts-prompt-enable"${settings.promptInjection?.enabled ? ' checked' : ''}>
                            </div>
                            <div class="indextts-setting-row">
                                <label>注入深度 (Depth)</label>
                                <input type="number" id="indextts-prompt-depth" class="text_pole" value="${settings.promptInjection?.depth ?? 4}" min="0">
                            </div>
                            <div class="indextts-setting-row">
                                <label>角色 (Role)</label>
                                <select id="indextts-prompt-role" class="text_pole">
                                    <option value="system"${settings.promptInjection?.role === 'system' ? ' selected' : ''}>System</option>
                                    <option value="user"${settings.promptInjection?.role === 'user' ? ' selected' : ''}>User</option>
                                    <option value="assistant"${settings.promptInjection?.role === 'assistant' ? ' selected' : ''}>Assistant</option>
                                </select>
                            </div>
                             <div class="indextts-setting-row" style="flex-direction:column; align-items:flex-start;">
                                <label style="margin-bottom:5px;">提示词内容</label>
                                <textarea id="indextts-prompt-content" class="text_pole" rows="4" placeholder="输入要注入的提示词...">${settings.promptInjection?.content || ''}</textarea>
                            </div>
                        </div>

                        <!-- 模块2：播放与自动化 -->
                         <div class="indextts-setting-module">
                            <div class="indextts-module-header">▶️ 播放与自动化</div>
                            <div class="indextts-setting-row">
                                <label>解析模式</label>
                                <select id="indextts-parsing-mode" class="text_pole">
                                    <option value="gal"${settings.parsingMode === 'gal' ? ' selected' : ''}>GAL 模式（仅朗读台词）</option>
                                    <option value="audiobook"${settings.parsingMode === 'audiobook' ? ' selected' : ''}>听书模式（全文朗读）</option>
                                </select>
                            </div>
                            <div class="indextts-setting-row checkbox-row">
                                <label for="indextts-enable-inline">启用行内增强渲染</label>
                                <input type="checkbox" id="indextts-enable-inline"${settings.enableInline !== false ? ' checked' : ''}>
                            </div>
                             <div class="indextts-setting-row checkbox-row">
                                <label for="indextts-auto-inference">回复后自动推理</label>
                                <input type="checkbox" id="indextts-auto-inference"${settings.autoInference === true ? ' checked' : ''}>
                            </div>
                             <div class="indextts-setting-row checkbox-row">
                                <label for="indextts-auto-play">推理完毕后自动续播</label>
                                <input type="checkbox" id="indextts-auto-play"${settings.autoPlay === true ? ' checked' : ''}>
                            </div>
                             <div class="indextts-setting-row checkbox-row">
                                <label for="indextts-streaming-play">推理完N句后自动续播</label>
                                <input type="checkbox" id="indextts-streaming-play"${settings.streamingPlay === true ? ' checked' : ''}>
                            </div>
                            <div class="indextts-setting-row" id="indextts-streaming-skip-row" style="${settings.streamingPlay !== true ? 'display: none;' : ''}">
                                <label for="indextts-streaming-skip-count">推理句数</label>
                                <div style="display: flex; align-items: center; gap: 8px;">
                                    <input type="number" id="indextts-streaming-skip-count" class="text_pole" min="1" max="50" value="${settings.streamingSkipCount || 1}" style="width: 80px;">
                                    <span style="font-size: 0.85em; opacity: 0.7;">句（1=即时播放，2=推理2句后播放...）</span>
                                </div>
                            </div>
                            <div class="indextts-setting-row">
                                <label>默认朗读音色</label>
                                <input type="text" id="indextts-voice" class="text_pole" value="${settings.defaultVoice}">
                            </div>
                             <div class="indextts-setting-row">
                                <label>默认速度: <span id="indextts-speed-val">${settings.speed}</span></label>
                                <input type="range" id="indextts-speed" min="0.5" max="2" step="0.1" value="${settings.speed}">
                            </div>
                             <div class="indextts-setting-row">
                                <label>全局音量: <span id="indextts-volume-val">${volumeVal.toFixed(2)}</span></label>
                                <input type="range" id="indextts-volume" min="0" max="1" step="0.05" value="${volumeVal}">
                            </div>
                        </div>

                        <!-- 模块3：缓存管理 -->
                        <div class="indextts-setting-module">
                            <div class="indextts-module-header">🎙️ 参考音频&缓存管理</div>
                             <div class="indextts-path-container">
                                <input type="text" id="indextts-local-path" class="indextts-path-display" value="${pathDisplay}" readonly title="${pathDisplay}">
                                <button class="menu_button" id="indextts-choose-folder" title="选择本地文件夹">📂 选择</button>
                                <button class="menu_button indextts-auth-btn" id="indextts-auth-btn" title="需授权读写权限" style="display:none;">🔄 授权</button>
                            </div>
                            
                            <div class="indextts-audio-pool">
                                <div>已缓存音频: <span id="indextts-cache-count">0</span> 条</div>
                                <div class="indextts-audio-pool-actions">
                                    <button class="menu_button" id="indextts-scan-import" title="扫描本地目录">📥 扫描导入</button>
                                    <button class="menu_button" id="indextts-export-cache" title="导出备份">📂 导出备份</button>
                                    <button class="menu_button" id="indextts-clear-cache" title="清空缓存">🗑️ 清空全部</button>
                                </div>
                            </div>
                        </div>

                        <!-- 模剗4：背景音效 -->
                        <div class="indextts-setting-module">
                            <div class="indextts-module-header">🎵 场景音效</div>
                            <div class="indextts-path-container">
                                <input type="text" id="indextts-ambient-path" class="indextts-path-display" value="" readonly placeholder="未选择背景音目录">
                                <button class="menu_button" id="indextts-ambient-choose" title="选择背景音文件夹">📂 选择</button>
                                <button class="menu_button" id="indextts-ambient-auth" title="重新授权目录读取权限" style="display:none;">🔄 授权</button>
                            </div>
                            <div class="indextts-setting-row">
                                <label>场景音音量</label>
                                <input type="range" id="indextts-ambient-volume" class="indextts-slider" min="0" max="1" step="0.05" value="${settings.ambientSoundVolume ?? 0.4}">
                                <span id="indextts-ambient-volume-val">${((settings.ambientSoundVolume ?? 0.4) * 100).toFixed(0)}%</span>
                            </div>
                            <div class="indextts-setting-row">
                                <label>淡入淡出</label>
                                <select id="indextts-ambient-fade" class="text_pole">
                                    <option value="0"${(settings.ambientFadeDuration ?? 0) == 0 ? ' selected' : ''}>关闭</option>
                                    <option value="500"${(settings.ambientFadeDuration ?? 0) == 500 ? ' selected' : ''}>0.5 秒</option>
                                    <option value="1000"${(settings.ambientFadeDuration ?? 0) == 1000 ? ' selected' : ''}>1 秒</option>
                                    <option value="1500"${(settings.ambientFadeDuration ?? 0) == 1500 ? ' selected' : ''}>1.5 秒</option>
                                    <option value="2000"${(settings.ambientFadeDuration ?? 0) == 2000 ? ' selected' : ''}>2 秒</option>
                                    <option value="3000"${(settings.ambientFadeDuration ?? 0) == 3000 ? ' selected' : ''}>3 秒</option>
                                </select>
                            </div>
                            <div class="indextts-setting-row" style="font-size:0.85em; opacity:0.7;">
                                音效文件命名需与场景名称一致，支持 .mp3 / .wav / .ogg / .m4a
                            </div>
                            <div class="indextts-setting-row checkbox-row">
                                <label for="indextts-ambient-loop-scene">同场景下循环播放场景音</label>
                                <input type="checkbox" id="indextts-ambient-loop-scene" ${settings.ambientLoopByScene ? 'checked' : ''}>
                            </div>
                        </div>

                    </div>
                </div>
            </div>
        `;
        const div = document.createElement('div');
        div.innerHTML = html;
        container.appendChild(div.firstElementChild);

        const panel = document.getElementById('indextts-settings');

        // ==================== Event Bindings for Persistence ====================

        // 1. Service Config
        const bindInput = (id, field) => {
            const el = panel.querySelector(id);
            if (el) {
                el.oninput = el.onchange = (e) => {
                    const s = getSettings();
                    s[field] = e.target.value;
                    saveSettings();
                };
            }
        };

        bindInput('#indextts-url', 'apiUrl');
        bindInput('#indextts-clone-url', 'cloningUrl');
        bindInput('#indextts-voice-list-url', 'voiceListUrl');
        bindInput('#indextts-model', 'model');

        // 2. Playback & Automation
        const bindSelect = (id, field) => {
            const el = panel.querySelector(id);
            if (el) {
                el.onchange = (e) => {
                    const s = getSettings();
                    s[field] = e.target.value;
                    saveSettings();
                    refreshAllMessages();
                };
            }
        };
        bindSelect('#indextts-parsing-mode', 'parsingMode');

        const bindCheckbox = (id, field, needRefresh = false) => {
            const el = panel.querySelector(id);
            if (el) {
                el.onchange = (e) => {
                    const s = getSettings();
                    s[field] = e.target.checked;
                    saveSettings();
                    if (needRefresh) refreshAllMessages();
                };
            }
        };
        bindCheckbox('#indextts-enable-inline', 'enableInline', true);
        bindCheckbox('#indextts-auto-inference', 'autoInference', false);
        bindCheckbox('#indextts-auto-play', 'autoPlay', false);
        bindCheckbox('#indextts-streaming-play', 'streamingPlay', false);

        // 流式推理跳过数量设置
        const streamingSkipRow = panel.querySelector('#indextts-streaming-skip-row');
        const streamingSkipCount = panel.querySelector('#indextts-streaming-skip-count');
        const streamingPlayCheckbox = panel.querySelector('#indextts-streaming-play');
        const autoPlayCheckbox = panel.querySelector('#indextts-auto-play');

        // 流式推理播放和推理后自动播放互斥逻辑
        if (streamingPlayCheckbox) {
            streamingPlayCheckbox.onchange = (e) => {
                const s = getSettings();
                if (e.target.checked) {
                    // 启用流式推理播放时，关闭推理后自动播放
                    s.streamingPlay = true;
                    s.autoPlay = false;
                    // 同时更新 UI 上的自动播放复选框
                    if (autoPlayCheckbox) autoPlayCheckbox.checked = false;
                    // 显示跳过数量设置行
                    if (streamingSkipRow) streamingSkipRow.style.display = '';
                } else {
                    s.streamingPlay = false;
                    // 隐藏跳过数量设置行
                    if (streamingSkipRow) streamingSkipRow.style.display = 'none';
                }
                saveSettings();
            };
        }

        // 推理后自动播放和流式推理播放互斥逻辑
        if (autoPlayCheckbox) {
            autoPlayCheckbox.onchange = (e) => {
                const s = getSettings();
                if (e.target.checked) {
                    // 启用推理后自动播放时，关闭流式推理播放
                    s.autoPlay = true;
                    s.streamingPlay = false;
                    // 同时更新 UI 上的流式推理播放复选框
                    if (streamingPlayCheckbox) streamingPlayCheckbox.checked = false;
                    // 隐藏跳过数量设置行
                    if (streamingSkipRow) streamingSkipRow.style.display = 'none';
                } else {
                    s.autoPlay = false;
                }
                saveSettings();
            };
        }

        if (streamingSkipCount) {
            streamingSkipCount.onchange = (e) => {
                const s = getSettings();
                const countVal = parseInt(e.target.value) || 1;
                s.streamingSkipCount = Math.max(1, Math.min(50, countVal));
                e.target.value = s.streamingSkipCount;
                saveSettings();
            };
        }

        // Voice
        const voiceInput = panel.querySelector('#indextts-voice');
        if (voiceInput) {
            voiceInput.onchange = (e) => {
                const s = getSettings();
                s.defaultVoice = ensureWavSuffix(e.target.value);
                saveSettings();
            };
        }

        // Sliders
        const speedInput = panel.querySelector('#indextts-speed');
        if (speedInput) {
            speedInput.oninput = (e) => {
                const val = parseFloat(e.target.value);
                document.getElementById('indextts-speed-val').textContent = val;
                const s = getSettings();
                s.speed = val;
                saveSettings();
            };
        }

        const volInput = panel.querySelector('#indextts-volume');
        if (volInput) {
            volInput.oninput = (e) => {
                const val = parseFloat(e.target.value);
                document.getElementById('indextts-volume-val').textContent = val.toFixed(2);
                const s = getSettings();
                s.volume = val;
                saveSettings();
            };
        }

        // ==================== Module: Prompt Injection ====================
        const bindPrompt = (id, field) => {
            const el = panel.querySelector(id);
            if (el) {
                el.oninput = el.onchange = (e) => {
                    const s = getSettings();
                    // Initialize with full default structure if missing
                    if (!s.promptInjection || typeof s.promptInjection !== 'object') {
                        s.promptInjection = JSON.parse(JSON.stringify(defaultSettings.promptInjection));
                    }
                    // Update the specific field
                    s.promptInjection[field] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
                    saveSettings();
                };
            }
        };
        bindPrompt('#indextts-prompt-enable', 'enabled');
        bindPrompt('#indextts-prompt-depth', 'depth');
        bindPrompt('#indextts-prompt-role', 'role');
        bindPrompt('#indextts-prompt-content', 'content');

        // ==================== Module 4: Ambient Sound ====================
        const ambientChooseBtn = panel.querySelector('#indextts-ambient-choose');
        if (ambientChooseBtn) {
            ambientChooseBtn.onclick = async () => {
                if (!window.showDirectoryPicker) {
                    if (window.toastr) window.toastr.error('浏览器不支持目录选择');
                    return;
                }
                try {
                    const h = await window.showDirectoryPicker();
                    await AmbientPlayer.setDirHandle(h);
                    // Pre-authorize while still inside user gesture
                    await AmbientPlayer.requestPermission();
                    const el = panel.querySelector('#indextts-ambient-path');
                    if (el) el.value = h.name;
                    // 同时保存到 settings 作为备用
                    const s = getSettings();
                    s.ambientSoundPath = h.name;
                    saveSettings();
                    if (window.toastr) window.toastr.success('背景音目录已设置: ' + h.name);
                } catch (e) {
                    if (e.name !== 'AbortError') console.error('[IndexTTS2][Ambient]', e);
                }
            };
            // Init display - 优先使用 handle，备用 settings
            const existingH = AmbientPlayer.getDirHandle();
            const ambPathEl = panel.querySelector('#indextts-ambient-path');
            const s = getSettings();
            if (existingH && ambPathEl) {
                ambPathEl.value = existingH.name;
            } else if (s.ambientSoundPath && ambPathEl) {
                // handle 失效时使用 settings 中的备用路径
                ambPathEl.value = s.ambientSoundPath;
            }
            // Show auth button if handle exists but may need re-authorization
            // 或者有备用路径但 handle 失效（需要重新选择授权）
            const ambAuthBtn = panel.querySelector('#indextts-ambient-auth');
            if (ambAuthBtn) {
                if (existingH) {
                    ambAuthBtn.style.display = 'inline-block';
                } else if (s.ambientSoundPath) {
                    // 有备用路径但 handle 失效，显示授权按钮
                    ambAuthBtn.style.display = 'inline-block';
                }
                ambAuthBtn.onclick = async () => {
                    if (existingH) {
                        const ok = await AmbientPlayer.requestPermission();
                        if (ok) {
                            ambAuthBtn.style.display = 'none';
                            if (window.toastr) window.toastr.success('背景音目录授权成功');
                        } else {
                            if (window.toastr) window.toastr.error('授权失败，请重新选择目录');
                        }
                    } else if (s.ambientSoundPath) {
                        // 需要重新选择目录
                        if (window.toastr) window.toastr.info('请重新选择背景音目录以获取权限');
                        ambientChooseBtn.click();
                    }
                };
            }
        }
        const ambVolSlider = panel.querySelector('#indextts-ambient-volume');
        if (ambVolSlider) {
            ambVolSlider.oninput = (e) => {
                const v = parseFloat(e.target.value);
                AmbientPlayer.setVolume(v);
                const disp = panel.querySelector('#indextts-ambient-volume-val');
                if (disp) disp.textContent = Math.round(v * 100) + '%';
            };
        }
        const ambFadeSelect = panel.querySelector('#indextts-ambient-fade');
        if (ambFadeSelect) {
            ambFadeSelect.onchange = (e) => {
                const s = getSettings();
                s.ambientFadeDuration = parseInt(e.target.value) || 0;
                saveSettings();
            };
        }
        const ambLoopSceneChk = panel.querySelector('#indextts-ambient-loop-scene');
        if (ambLoopSceneChk) {
            ambLoopSceneChk.onchange = (e) => {
                const s = getSettings();
                s.ambientLoopByScene = e.target.checked;
                saveSettings();
            };
        }

        // ==================== Module 3: Audio Cache Management ====================
        const pathInputEl = panel.querySelector('#indextts-local-path');
        const authBtn = panel.querySelector('#indextts-auth-btn');

        // UI Update Helper
        const updatePathUI = async () => {
            const h = LocalRepo.getHandle();
            const s = getSettings();

            // Priority: Handle Name > Settings Path > Default
            let displayPath = '未设置本地目录';
            if (h && h.name) {
                displayPath = h.name;
            } else if (s.cacheImportPath) {
                displayPath = s.cacheImportPath;
            }

            if (pathInputEl) pathInputEl.value = displayPath;
            if (pathInputEl) pathInputEl.title = displayPath;

            // Check permissions only if we have a handle
            if (h) {
                let hasPerm = false;
                try {
                    if ((await h.queryPermission({ mode: 'readwrite' })) === 'granted') {
                        hasPerm = true;
                    }
                } catch (e) { }

                if (hasPerm) {
                    authBtn.style.display = 'none';
                } else {
                    authBtn.style.display = 'inline-block';
                }
            } else {
                authBtn.style.display = 'none';
            }
        };

        // 1. Choose Folder
        const chooseBtn = panel.querySelector('#indextts-choose-folder');
        if (chooseBtn) {
            chooseBtn.onclick = async () => {
                if (!window.showDirectoryPicker) {
                    if (window.toastr) window.toastr.error('浏览器不支持 File System Access API');
                    return;
                }
                try {
                    const h = await window.showDirectoryPicker();
                    if (h) {
                        // 1. Save handle to IndexedDB
                        await LocalRepo.setHandle(h);

                        // 2. Sync to Settings
                        const s = getSettings();
                        s.cacheImportPath = h.name;
                        saveSettings();

                        // 3. Update UI
                        await updatePathUI();

                        if (window.toastr) window.toastr.success(`已选定目录: ${h.name}`);
                    }
                } catch (e) {
                    if (e.name !== 'AbortError') console.error(e);
                }
            };
        }

        // 2. Authorize Button
        if (authBtn) {
            authBtn.onclick = async () => {
                const success = await LocalRepo.requestPermission();
                if (success) {
                    if (window.toastr) window.toastr.success('已获授权');
                    await updatePathUI();
                } else {
                    if (window.toastr) window.toastr.warning('授权失败或被拒绝');
                }
            };
        }

        // 3. Scan & Import (Using Handle Logic)
        const scanImportBtn = panel.querySelector('#indextts-scan-import');
        if (scanImportBtn) {
            scanImportBtn.onclick = async () => {
                const h = LocalRepo.getHandle();
                if (!h) {
                    if (window.toastr) window.toastr.warning('请先点击【📂 选择】设置本地音频目录');
                    return;
                }
                // Ensure permission
                const hasPerm = await LocalRepo.requestPermission();
                if (!hasPerm) {
                    if (window.toastr) window.toastr.error('未获得读写权限，无法扫描');
                    await updatePathUI();
                    return;
                }

                await importFromLocalDirectory(h); // Pass handle directly
                await updateAudioPoolStats();
            };
        }

        // 4. Export (Using Handle Logic)
        const exportBtn = panel.querySelector('#indextts-export-cache');
        if (exportBtn) {
            exportBtn.onclick = async () => {
                const h = LocalRepo.getHandle();
                if (!h) {
                    if (window.toastr) window.toastr.warning('请先点击【📂 选择】设置本地音频目录');
                    return;
                }
                // Ensure permission
                const hasPerm = await LocalRepo.requestPermission();
                if (!hasPerm) {
                    if (window.toastr) window.toastr.error('未获得读写权限，无法导出');
                    await updatePathUI();
                    return;
                }

                await exportAudioCacheToFolder(h); // Pass handle directly
                await updateAudioPoolStats();
            };
        }

        const clearBtn = panel.querySelector('#indextts-clear-cache');
        if (clearBtn) {
            clearBtn.onclick = async () => {
                if (!window.confirm || window.confirm('确定要清空所有缓存的音频吗？')) {
                    await AudioStorage.clearAllAudios().catch(() => { });
                    clearMemoryAudioCache();
                    if (window.toastr) window.toastr.success('已清空缓存池');
                    await updateAudioPoolStats();
                }
            };
        }

        // ==================== Preset Management Bindings ====================
        const populatePresetUI = () => {
            const root = getRootSettings();
            const selectEl = panel.querySelector('#indextts-preset-select');
            const nameEl = panel.querySelector('#indextts-preset-name');
            if (!selectEl || !nameEl) return;

            selectEl.innerHTML = Object.keys(root.presets).map(name =>
                `<option value="${name}"${name === root.selected_preset ? ' selected' : ''}>${name}</option>`
            ).join('');
            nameEl.value = root.selected_preset;
        };

        populatePresetUI();

        // Preset Select change → 使用 switchPreset 移除重绘
        const presetSelect = panel.querySelector('#indextts-preset-select');
        if (presetSelect) {
            presetSelect.onchange = () => {
                switchPreset(presetSelect.value);
            };
        }

        // Preset Save
        const presetSaveBtn = panel.querySelector('#indextts-preset-save');
        if (presetSaveBtn) {
            presetSaveBtn.onclick = () => {
                const root = getRootSettings();
                const nameEl = panel.querySelector('#indextts-preset-name');
                const name = (nameEl?.value || '').trim();
                if (!name) {
                    if (window.toastr) window.toastr.warning('请输入预设名称');
                    return;
                }
                // 深拷贝当前活跃预设数据 保存到目标名称
                root.presets[name] = JSON.parse(JSON.stringify(getSettings()));
                root.selected_preset = name;
                saveSettings();
                populatePresetUI();
                if (window.toastr) window.toastr.success(`预设 "${name}" 已保存`);
            };
        }

        // Preset Delete
        const presetDelBtn = panel.querySelector('#indextts-preset-delete');
        if (presetDelBtn) {
            presetDelBtn.onclick = () => {
                const root = getRootSettings();
                const keys = Object.keys(root.presets);
                if (keys.length <= 1) {
                    if (window.toastr) window.toastr.warning('至少需要保留一个预设');
                    return;
                }
                const current = root.selected_preset;
                if (!confirm(`确定要删除预设 "${current}" 吗？`)) return;
                delete root.presets[current];
                // 切换到第一个剩余预设
                switchPreset(Object.keys(root.presets)[0]);
                if (window.toastr) window.toastr.success(`已删除预设 "${current}"`);
            };
        }

        // Initial UI check
        updatePathUI();
        updateAudioPoolStats();
    }

    async function updateAudioPoolStats() {
        try {
            const list = await AudioStorage.getAllAudios();
            const countEl = document.getElementById('indextts-cache-count');
            if (countEl) {
                countEl.textContent = String(list.length || 0);
            }
        } catch (e) {
            console.warn('[IndexTTS2] updateAudioPoolStats error:', e);
        }
    }

    // 导出格式: [角色]_文本预览_hash.wav，哈希在末尾
    const IMPORT_FILENAME_REGEX = /^\[(.*?)\]_(.+)_([a-f0-9]{6,})\.(?:wav|mp3|ogg)$/i;

    async function getAllAudioFilesFromDir(dirHandle, list = []) {
        try {
            for await (const [name, handle] of dirHandle.entries()) {
                if (handle.kind === 'file') {
                    const n = name.toLowerCase();
                    if (n.endsWith('.wav') || n.endsWith('.mp3') || n.endsWith('.ogg')) list.push(handle);
                } else if (handle.kind === 'directory') {
                    await getAllAudioFilesFromDir(handle, list);
                }
            }
        } catch (e) {
            console.warn('[IndexTTS2] getAllAudioFilesFromDir error:', e);
        }
        return list;
    }

    async function importFromLocalDirectory(providedHandle) {
        if (!window.showDirectoryPicker) {
            if (window.toastr) window.toastr.error('当前浏览器不支持 File System Access API');
            return;
        }
        try {
            const dirHandle = providedHandle || await window.showDirectoryPicker();
            // const dirHandle = await window.showDirectoryPicker();
            const fileHandles = await getAllAudioFilesFromDir(dirHandle);
            if (!fileHandles.length) {
                if (window.toastr) window.toastr.info('该目录下未发现 .wav / .mp3 / .ogg 文件');
                return;
            }
            let imported = 0;
            let skipped = 0;
            for (let i = 0; i < fileHandles.length; i++) {
                const f = fileHandles[i];
                try {
                    const file = await f.getFile();
                    const blob = file.slice(0, file.size, file.type || 'audio/wav');
                    const name = f.name;
                    const match = name.match(IMPORT_FILENAME_REGEX);
                    let character, text, hash;
                    if (match) {
                        character = (match[1] || '').trim() || 'Imported';
                        text = (match[2] || '').trim() || name;
                        hash = (match[3] || '').toLowerCase();
                    } else {
                        character = 'Imported';
                        text = name.replace(/\.(wav|mp3|ogg)$/i, '');
                        hash = await generateHash(character, 'imported', text, 1, 1);
                    }
                    const existing = await AudioStorage.getAudio(hash);
                    if (existing && existing.blob) {
                        skipped++;
                    } else {
                        const record = {
                            hash,
                            blob,
                            character,
                            text,
                            voice: '',
                            speed: 1,
                            volume: 1,
                            timestamp: Date.now(),
                        };
                        await AudioStorage.saveAudio(record);
                        imported++;
                    }
                } catch (e) {
                    console.warn('[IndexTTS2] import file error:', f.name, e);
                }
                if (window.toastr && (i + 1) % 10 === 0) {
                    window.toastr.info(`正在导入: ${i + 1}/${fileHandles.length}`);
                }
            }
            if (window.toastr) window.toastr.success(`同步完成：新增 ${imported} 条，跳过已存在 ${skipped} 条`);
        } catch (e) {
            if (e.name === 'AbortError') return;
            console.error('[IndexTTS2] importFromLocalDirectory error:', e);
            if (window.toastr) window.toastr.error('导入失败: ' + e.message);
        }
    }

    async function exportAudioCacheToFolder(providedHandle) {
        if (!AudioStorage || !AudioStorage.getAllAudios) return;
        if (!window.showDirectoryPicker) {
            if (window.toastr) window.toastr.error('当前浏览器不支持 File System Access API');
            return;
        }
        try {
            const records = await AudioStorage.getAllAudios();
            if (!records.length) {
                if (window.toastr) window.toastr.info('暂无可导出的缓存音频');
                return;
            }
            const dirHandle = providedHandle || await window.showDirectoryPicker();
            let idx = 0;
            for (const rec of records) {
                idx++;
                const safeChar = (rec.character || 'voice').slice(0, 16);
                const previewText = (rec.text || '').slice(0, 10).replace(/\s+/g, '');
                const shortHash = (rec.hash || 'hash').slice(0, 6);
                const rawName = `[${safeChar}]_${previewText}_${shortHash}.wav`;
                const fileName = rawName.replace(/[\\/:*?"<>|]/g, '_');

                const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
                const writable = await fileHandle.createWritable();
                await writable.write(rec.blob);
                await writable.close();

                if (window.toastr && idx % 5 === 0) {
                    window.toastr.info(`导出进度: ${idx}/${records.length}`);
                }
            }
            if (window.toastr) window.toastr.success(`导出完成，共 ${records.length} 条`);
        } catch (e) {
            console.error('[IndexTTS2] exportAudioCacheToFolder error:', e);
            if (window.toastr) window.toastr.error('导出失败: ' + e.message);
        }
    }

    // ==================== Event Listeners ====================
    function setupEventListeners() {
        try {
            const eventSource = window.eventSource || window.SillyTavern?.getContext?.()?.eventSource;
            const event_types = window.event_types || window.SillyTavern?.getContext?.()?.event_types;

            if (eventSource && event_types) {
                // Re-inject when message is edited
                if (event_types.MESSAGE_EDITED) {
                    eventSource.on(event_types.MESSAGE_EDITED, (mesId) => {
                        console.log('[IndexTTS2] MESSAGE_EDITED:', mesId);
                        setTimeout(() => {
                            const msg = document.querySelector(`.mes[mesid="${mesId}"]`);
                            if (msg) {
                                const mesText = msg.querySelector('.mes_text');
                                if (mesText) delete mesText.dataset.indexttsInjected;
                                injectMessageButtons(msg);
                                injectInlineButtons(msg, true);
                            }
                        }, 100);
                    });
                }

                // Re-inject when new message rendered
                if (event_types.CHARACTER_MESSAGE_RENDERED) {
                    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, () => {
                        console.log('[IndexTTS2] CHARACTER_MESSAGE_RENDERED');
                        setTimeout(() => polling(), 100);
                    });
                }

                if (event_types.MESSAGE_RECEIVED) {
                    eventSource.on(event_types.MESSAGE_RECEIVED, async (mesId) => {
                        console.log('[IndexTTS2] MESSAGE_RECEIVED', mesId);
                        // 等待 DOM 渲染
                        setTimeout(async () => {
                            polling();
                            // 自动推理逻辑
                            const settings = getSettings();
                            if (settings.autoInference) {
                                let msg = null;
                                if (mesId) {
                                    msg = document.querySelector(`.mes[mesid="${mesId}"]`);
                                }
                                // Fallback: try last message if mesId not found or not provided
                                if (!msg) {
                                    const all = document.querySelectorAll('.mes[is_user="false"]');
                                    if (all.length) msg = all[all.length - 1];
                                }
                                if (msg) {
                                    console.log('[IndexTTS2] Auto-inferring for message', mesId);
                                    await inferMessageAudios(msg, null, true); // silent = true
                                    // 自动播放：流式推理播放模式下已在 inferMessageAudios 内部处理
                                    // 非流式模式下，仅当启用"推理后自动播放"时调用
                                    if (settings.autoPlay) {
                                        await autoPlayMessage(msg);
                                    }
                                }
                            }
                        }, 500);
                    });
                }

                console.log('[IndexTTS2] Event listeners registered');
            }
        } catch (e) {
            console.log('[IndexTTS2] Event source not available, using polling only');
        }

        // Prompt Injection Logic
        try {
            const eventSource = window.eventSource || window.SillyTavern?.getContext?.()?.eventSource;
            const event_types = window.event_types || window.SillyTavern?.getContext?.()?.event_types;

            if (eventSource && event_types && event_types.CHAT_COMPLETION_PROMPT_READY) {
                eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, (eventData) => {
                    const settings = getSettings();
                    const config = settings.promptInjection;

                    if (config && config.enabled && config.content) {
                        const depth = parseInt(config.depth) || 0;
                        const injection = {
                            role: config.role || 'system',
                            content: config.content
                        };

                        // Calculate insertion index
                        let index = eventData.chat.length - depth;
                        if (index < 0) index = 0;
                        if (index > eventData.chat.length) index = eventData.chat.length;

                        eventData.chat.splice(index, 0, injection);
                        console.log(`[IndexTTS2] Injected prompt at depth ${depth} (index ${index})`, injection);
                    }
                });
            }
        } catch (e) {
            console.error('[IndexTTS2] Prompt injection setup error:', e);
        }
    }

    // ==================== Polling ====================
    function polling() {
        ensureCssLoaded();
        injectSettingsPanel();

        document.querySelectorAll('.mes[is_user="false"]').forEach(msg => {
            injectMessageButtons(msg);

            // Force re-inject if inline buttons are missing
            const mesText = msg.querySelector('.mes_text');
            if (mesText && mesText.dataset.indexttsInjected === 'true') {
                if (!mesText.querySelector('.indextts-inline-play')) {
                    delete mesText.dataset.indexttsInjected;
                }
            }
            injectInlineButtons(msg);

            const playBtn = msg.querySelector('.indextts-play');
            if (playBtn && !playBtn.classList.contains('indextts-prepared') && !playBtn.dataset.indexttsPollingCheck) {
                playBtn.dataset.indexttsPollingCheck = 'true';
                const mesId = getMessageId(msg);
                if (mesId && audioCache[mesId] && audioCache[mesId].length > 0) {
                    playBtn.classList.add('indextts-prepared');
                } else {
                    const lines = collectVNLinesFromMessage(msg);
                    if (lines.length > 0) {
                        const firstLine = lines[0];
                        if (firstLine.voice) {
                            (async () => {
                                const settings = getSettings();
                                const normVoice = ensureWavSuffix(firstLine.voice || settings.defaultVoice);
                                const speed = parseFloat(settings.speed || 1.0) || 1.0;
                                const volume = parseFloat(settings.volume || 1.0) || 1.0;
                                const hash = await generateHash(firstLine.character || 'Unknown', normVoice, firstLine.text, speed, volume, firstLine.emotion);
                                const cached = await AudioStorage.getAudio(hash);
                                if (cached && cached.blob) {
                                    playBtn.classList.add('indextts-prepared');
                                }
                            })();
                        }
                    }
                }
            }
        });
    }

    // ==================== Initialize ====================
    function init() {
        console.log('[IndexTTS2] v12 Initializing...');
        const loadedSettings = getSettings(); // Ensure settings exist
        console.log('[IndexTTS2] Loaded settings:', loadedSettings);
        LocalRepo.init();
        AmbientPlayer.init();
        setupEventListeners();
        setInterval(polling, 2000);
        polling(); // Initial run
        console.log('[IndexTTS2] v12 Ready - Stable Edition');

        setTimeout(async () => {
            try {
                const list = await AudioStorage.getAllAudios();
                if (!list || list.length === 0) {
                    console.log('[IndexTTS2] 缓存池为空，建议在设置中执行「扫描本地目录同步至缓存」以节省推理算力');
                    if (window.toastr) window.toastr.info('缓存池为空，建议执行「扫描本地目录同步至缓存」以节省算力');
                }
            } catch (e) { }
        }, 800);
    }

    // Wait for page ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // ==================== Global API for iframe / 前端渲染器 ====================
    // iframe 通过 window.parent.IndexTTS 访问，避免重复逻辑与播放冲突
    window.IndexTTS = {
        play: function (text, voice, character, context) {
            const ctx = context || {};
            // Requirement 2: 调用源自动识别，建立 iframe 与消息楼层的关联
            if (ctx.source === 'kanon_frontend') {
                const iframes = document.querySelectorAll('iframe');
                for (const f of iframes) {
                    // 由于 iframe 内无法直接通过 parent 知道自己是哪一个 iframe 元素
                    // 我们通过 closest('.mes') 来建立关联
                    const msgEl = f.closest('.mes');
                    if (msgEl) {
                        ctx.msg = msgEl;
                        ctx.mesId = getMessageId(msgEl);
                        // 一旦找到带有消息背景的 iframe，就认为锁定了 source message
                        break;
                    }
                }
            }
            return playSingleLine(text, voice || null, character || '', ctx);
        },
        getSettings: getSettings,
        getVoiceMap: getVoiceMap,
        parseVNLine: parseVNLine,
        getCardId: getCardId,
    };
})();