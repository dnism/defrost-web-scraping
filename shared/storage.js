/**
 * LexiScrape Storage & Project Manager
 * Gestisce i Progetti di Ricerca, le espressioni salvate, gli estratti raccolti,
 * la deduplicazione automatica, i tag e le note utente in browser.storage.local.
 */
(function (root) {
  'use strict';

  const STORAGE_KEY = 'defrost_state_v2';
  const CREDENTIALS_KEY = 'defrost_ai_credentials_v1';
  const DEFAULT_AI_MODEL = 'gemini-2.5-flash';

  // Fallback in-memory per ambienti di test fuori dal browser
  let memoryStore = {};
  let cachedCredentials = { apiKey: '', model: '' };

  function readLocalFallbackKey() {
    try {
      if (typeof localStorage !== 'undefined' && localStorage.getItem) {
        return {
          apiKey: sanitizeApiKey(localStorage.getItem('defrost_api_key') || ''),
          model: localStorage.getItem('defrost_ai_model') || ''
        };
      }
    } catch (_) {}
    return { apiKey: '', model: '' };
  }

  function writeLocalFallbackKey(apiKey, model) {
    try {
      if (typeof localStorage !== 'undefined' && localStorage.setItem) {
        if (typeof apiKey === 'string') localStorage.setItem('defrost_api_key', apiKey);
        if (typeof model === 'string' && model) localStorage.setItem('defrost_ai_model', model);
      }
    } catch (_) {}
  }

  function normalizeStoredModel(model) {
    const raw = String(model || '').trim().replace(/^models\//i, '');
    if (!raw || raw === 'gemini-3.8-flash') return DEFAULT_AI_MODEL;
    if (raw === 'gemini-3.8-pro' || raw === 'gemini-1.5-pro') return 'gemini-2.5-pro';
    if (raw === 'gemini-1.5-flash') return 'gemini-2.0-flash';
    return raw;
  }

  function getBrowserStorage() {
    if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
      return browser.storage.local;
    }
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      return {
        get: (keys) => new Promise(resolve => chrome.storage.local.get(keys, resolve)),
        set: (obj) => new Promise(resolve => chrome.storage.local.set(obj, resolve))
      };
    }
    return {
      get: async (key) => ({ [key]: memoryStore[key] }),
      set: async (obj) => { Object.assign(memoryStore, obj); }
    };
  }

  function generateId(prefix = 'id') {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  /**
   * Sanitizes and cleans API keys (removes zero-width chars, quotes, Bearer/env prefixes, or extracts token)
   */
  function sanitizeApiKey(raw) {
    if (!raw) return '';
    let key = String(raw)
      .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '')
      .trim();
    if (!key) return '';

    // Extract explicit Google AI Studio key if pasted inside a curl/json/.env block
    const gMatch = key.match(/\b(AIza[0-9A-Za-z_-]{30,55})\b/);
    if (gMatch) return gMatch[1];

    // Extract explicit OpenRouter / Anthropic / Groq / OpenAI key if embedded
    const skMatch = key.match(/\b((?:sk-or-v1-|sk-ant-|sk-proj-|sk-|gsk_)[0-9A-Za-z_-]{18,160})\b/);
    if (skMatch) return skMatch[1];

    key = key.replace(/^["'`\s]+|["'`\s]+$/g, '').trim();
    key = key.replace(/^export\s+/i, '').trim();
    if (key.includes('=')) {
      const parts = key.split('=');
      key = parts[parts.length - 1].trim().replace(/^["'`\s]+|["'`\s]+$/g, '').trim();
    } else if (/^bearer\s+/i.test(key)) {
      key = key.replace(/^bearer\s+/i, '').trim().replace(/^["'`\s]+|["'`\s]+$/g, '').trim();
    } else if (key.includes(':') && /^[a-zA-Z_-]+:/.test(key)) {
      key = key.split(':').slice(1).join(':').trim().replace(/^["'`\s]+|["'`\s]+$/g, '').trim();
    }
    return key.replace(/\s+/g, '');
  }

  /**
   * Calcola una impronta (fingerprint) per deduplicare estratti identici
   * provenienti dalla stessa pagina.
   */
  function computeItemFingerprint(url, text) {
    const cleanUrl = String(url || '').split('#')[0].trim().toLowerCase();
    const cleanText = String(text || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      .slice(0, 320);
    let hash = 2166136261;
    const combined = `${cleanUrl}::${cleanText}`;
    for (let i = 0; i < combined.length; i++) {
      hash ^= combined.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  function createDefaultState() {
    const defaultProjId = generateId('proj');
    const now = new Date().toISOString();
    return {
      activeProjectId: defaultProjId,
      geminiApiKey: '',
      geminiModel: DEFAULT_AI_MODEL,
      settings: {
        autoHighlight: true,
        rateLimitMs: 80,
        defaultGrouping: 'expression', // 'expression' | 'domain' | 'tag' | 'chronological'
        minScore: 10,
        includeLocalVisuals: true,
        autoAiOcr: false,
        interpreterEnabled: true,
        aiProvider: 'cloud',
        ollamaUrl: 'http://localhost:11434',
        ollamaModel: 'qwen2.5:latest',
        ollamaVisionModel: 'qwen2.5vl:latest'
      },
      projects: [
        {
          id: defaultProjId,
          name: 'General Research',
          description: 'Default dossier for semantic web extraction with Defrost.',
          aiPrompt: '',
          aiStrategy: null,
          expressions: '',
          createdAt: now,
          updatedAt: now,
          items: []
        }
      ]
    };
  }

  // In-memory cache: avoids re-reading and deserializing the whole database on every call.
  // Kept in sync across extension contexts (background, sidebar, popup) via storage.onChanged.
  let cachedState = null;
  let loadingPromise = null;
  let legacyChecked = false;

  function isValidState(state) {
    return Boolean(state && Array.isArray(state.projects) && state.projects.length > 0);
  }

  if (typeof browser !== 'undefined' && browser.storage && browser.storage.onChanged) {
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes[CREDENTIALS_KEY] && changes[CREDENTIALS_KEY].newValue) {
        const cred = changes[CREDENTIALS_KEY].newValue;
        cachedCredentials = {
          apiKey: sanitizeApiKey(cred.apiKey || ''),
          model: normalizeStoredModel(cred.model)
        };
        if (cachedState) {
          cachedState.geminiApiKey = cachedCredentials.apiKey;
          cachedState.geminiModel = cachedCredentials.model;
        }
      }
      if (changes[STORAGE_KEY]) {
        const next = changes[STORAGE_KEY].newValue;
        if (isValidState(next)) {
          if (cachedCredentials.apiKey && !next.geminiApiKey) {
            next.geminiApiKey = cachedCredentials.apiKey;
          }
          next.geminiModel = normalizeStoredModel(next.geminiModel || cachedCredentials.model);
          cachedState = next;
        } else {
          cachedState = null;
        }
      }
    });
  }

  async function readAndMigrateState() {
    const store = getBrowserStorage();
    const data = await store.get([STORAGE_KEY, CREDENTIALS_KEY]);
    let state = data && data[STORAGE_KEY];
    const storedCred = (data && data[CREDENTIALS_KEY]) || {};
    const localCred = readLocalFallbackKey();
    let dirty = false;

    if (!isValidState(state)) {
      state = createDefaultState();
      dirty = true;
    }
    if (!state.projects.some(p => p.id === state.activeProjectId)) {
      state.activeProjectId = state.projects[0].id;
    }

    // Resolve API key from dedicated credentials store, state, or localStorage mirror
    const resolvedKey = sanitizeApiKey(
      storedCred.apiKey || state.geminiApiKey || localCred.apiKey || cachedCredentials.apiKey || ''
    );
    if (resolvedKey && state.geminiApiKey !== resolvedKey) {
      state.geminiApiKey = resolvedKey;
      dirty = true;
    }

    // Normalize model (fix fictional gemini-3.8-* or retired 1.5 models)
    const normalizedModel = normalizeStoredModel(storedCred.model || state.geminiModel || localCred.model);
    if (state.geminiModel !== normalizedModel) {
      state.geminiModel = normalizedModel;
      dirty = true;
    }

    if (!state.settings || typeof state.settings !== 'object') {
      state.settings = createDefaultState().settings;
      dirty = true;
    } else {
      if (typeof state.settings.includeLocalVisuals !== 'boolean') {
        state.settings.includeLocalVisuals = true;
        dirty = true;
      }
      if (typeof state.settings.autoAiOcr !== 'boolean') {
        state.settings.autoAiOcr = false;
        dirty = true;
      }
      if (typeof state.settings.interpreterEnabled !== 'boolean') {
        state.settings.interpreterEnabled = true;
        dirty = true;
      }
      if (!state.settings.aiProvider) {
        state.settings.aiProvider = 'cloud';
        dirty = true;
      }
      if (!state.settings.ollamaUrl) {
        state.settings.ollamaUrl = 'http://localhost:11434';
        dirty = true;
      }
      if (!state.settings.ollamaModel) {
        state.settings.ollamaModel = 'qwen2.5:latest';
        dirty = true;
      }
      if (!state.settings.ollamaVisionModel) {
        state.settings.ollamaVisionModel = 'qwen2.5vl:latest';
        dirty = true;
      }
    }
    // Recover API key from legacy storage keys (checked once per session only)
    if (!state.geminiApiKey && !legacyChecked) {
      legacyChecked = true;
      try {
        const legacy = await store.get(['defrost_state', 'lexiscrape_state_v1', 'lexiscrape_state', 'geminiApiKey', 'apiKey']);
        const found = (legacy && legacy.defrost_state && legacy.defrost_state.geminiApiKey) ||
                      (legacy && legacy.lexiscrape_state_v1 && legacy.lexiscrape_state_v1.geminiApiKey) ||
                      (legacy && legacy.lexiscrape_state && legacy.lexiscrape_state.geminiApiKey) ||
                      (legacy && legacy.geminiApiKey) ||
                      (legacy && legacy.apiKey);
        if (found) {
          state.geminiApiKey = sanitizeApiKey(found);
          dirty = true;
        }
      } catch (_) {}
    }

    cachedCredentials = {
      apiKey: state.geminiApiKey || '',
      model: state.geminiModel || DEFAULT_AI_MODEL
    };
    if (cachedCredentials.apiKey) {
      writeLocalFallbackKey(cachedCredentials.apiKey, cachedCredentials.model);
    }

    if (dirty) {
      await saveState(state);
    } else {
      cachedState = state;
    }
    return state;
  }

  async function loadState() {
    if (cachedState) {
      if (!cachedState.projects.some(p => p.id === cachedState.activeProjectId)) {
        cachedState.activeProjectId = cachedState.projects[0].id;
      }
      if (!cachedState.geminiApiKey) {
        const fallback = cachedCredentials.apiKey || readLocalFallbackKey().apiKey;
        if (fallback) cachedState.geminiApiKey = fallback;
      }
      cachedState.geminiModel = normalizeStoredModel(cachedState.geminiModel);
      return cachedState;
    }
    if (!loadingPromise) {
      loadingPromise = readAndMigrateState().finally(() => { loadingPromise = null; });
    }
    return loadingPromise;
  }

  async function saveState(state) {
    // Prevent project/item updates from accidentally wiping a saved API key
    if (!state.geminiApiKey && cachedCredentials.apiKey) {
      state.geminiApiKey = cachedCredentials.apiKey;
    }
    state.geminiModel = normalizeStoredModel(state.geminiModel || cachedCredentials.model);
    cachedState = state;
    const store = getBrowserStorage();
    await store.set({ [STORAGE_KEY]: state });
    return state;
  }

  async function updateSettings(patch) {
    const state = await loadState();
    state.settings = { ...(state.settings || {}), ...(patch || {}) };
    await saveState(state);
    return state.settings;
  }

  async function getActiveProject() {
    const state = await loadState();
    return state.projects.find(p => p.id === state.activeProjectId) || state.projects[0];
  }

  async function setActiveProject(projectId) {
    const state = await loadState();
    if (state.projects.some(p => p.id === projectId)) {
      state.activeProjectId = projectId;
      await saveState(state);
    }
    return state;
  }

  async function createProject({ name, description = '', expressions = '', aiPrompt = '', aiStrategy = null }) {
    const state = await loadState();
    const now = new Date().toISOString();
    const newProj = {
      id: generateId('proj'),
      name: (name || 'Nuovo Progetto').trim(),
      description: description.trim(),
      aiPrompt: (aiPrompt || '').trim(),
      aiStrategy: aiStrategy || null,
      expressions: expressions.trim(),
      createdAt: now,
      updatedAt: now,
      items: []
    };
    state.projects.unshift(newProj);
    state.activeProjectId = newProj.id;
    await saveState(state);
    return newProj;
  }

  async function updateProject(projectId, patch) {
    const state = await loadState();
    const proj = state.projects.find(p => p.id === projectId);
    if (!proj) return null;

    if (typeof patch.name === 'string' && patch.name.trim()) {
      proj.name = patch.name.trim();
    }
    if (typeof patch.description === 'string') {
      proj.description = patch.description.trim();
    }
    if (typeof patch.expressions === 'string') {
      proj.expressions = patch.expressions;
    }
    if (typeof patch.aiPrompt === 'string') {
      proj.aiPrompt = patch.aiPrompt;
    }
    if (patch.aiStrategy !== undefined) {
      proj.aiStrategy = patch.aiStrategy;
    }
    proj.updatedAt = new Date().toISOString();
    await saveState(state);
    return proj;
  }

  async function saveGeminiSettings({ apiKey, model } = {}) {
    const state = await loadState();
    if (typeof apiKey === 'string') {
      const cleaned = sanitizeApiKey(apiKey);
      state.geminiApiKey = cleaned;
      cachedCredentials.apiKey = cleaned;
    }
    if (typeof model === 'string' && model.trim()) {
      const normModel = normalizeStoredModel(model);
      state.geminiModel = normModel;
      cachedCredentials.model = normModel;
    }
    writeLocalFallbackKey(cachedCredentials.apiKey, cachedCredentials.model);
    const store = getBrowserStorage();
    cachedState = state;
    await store.set({
      [CREDENTIALS_KEY]: {
        apiKey: cachedCredentials.apiKey,
        model: cachedCredentials.model || state.geminiModel || DEFAULT_AI_MODEL,
        updatedAt: new Date().toISOString()
      },
      [STORAGE_KEY]: state
    });
    return state;
  }

  async function getGeminiSettings() {
    const state = await loadState();
    const localCred = readLocalFallbackKey();
    const apiKey = sanitizeApiKey(state.geminiApiKey || cachedCredentials.apiKey || localCred.apiKey || '');
    const model = normalizeStoredModel(state.geminiModel || cachedCredentials.model || localCred.model);
    const st = state.settings || {};
    return {
      apiKey,
      model,
      aiProvider: st.aiProvider === 'ollama' ? 'ollama' : 'cloud',
      ollamaUrl: String(st.ollamaUrl || 'http://localhost:11434').trim().replace(/\/+$/, ''),
      ollamaModel: String(st.ollamaModel || 'qwen2.5:latest').trim(),
      ollamaVisionModel: String(st.ollamaVisionModel || 'qwen2.5vl:latest').trim()
    };
  }

  async function deleteProject(projectId) {
    const state = await loadState();
    if (state.projects.length <= 1) {
      // Se è l'ultimo progetto, svuotalo invece di lasciare zero progetti
      state.projects[0].items = [];
      state.projects[0].updatedAt = new Date().toISOString();
      await saveState(state);
      return state;
    }
    state.projects = state.projects.filter(p => p.id !== projectId);
    if (state.activeProjectId === projectId) {
      state.activeProjectId = state.projects[0].id;
    }
    await saveState(state);
    return state;
  }

  /**
   * Aggiunge uno o più estratti al progetto attivo (o specificato),
   * deduplicando automaticamente quelli già presenti e unendo eventuali nuove espressioni/tag.
   */
  async function addExtractedItems(rawItems, projectId = null) {
    const state = await loadState();
    const targetId = projectId || state.activeProjectId;
    const proj = state.projects.find(p => p.id === targetId) || state.projects[0];

    const now = new Date().toISOString();
    let addedCount = 0;
    let updatedCount = 0;

    const existingByFp = new Map();
    for (const item of proj.items) {
      existingByFp.set(item.fingerprint, item);
    }

    for (const raw of rawItems) {
      if (!raw || !raw.text || !raw.text.trim()) continue;
      const sourceUrl = (raw.source && (raw.source.canonicalUrl || raw.source.url)) || raw.url || '';
      const fp = computeItemFingerprint(sourceUrl, raw.text);

      if (existingByFp.has(fp)) {
        const existing = existingByFp.get(fp);
        // Unisci espressioni e termini trovati se l'estratto è stato ritrovato con nuove query
        const mergedExprs = new Set([...(existing.matchedExpressions || []), ...(raw.matchedExpressions || [])]);
        const mergedTerms = new Set([...(existing.matchedTerms || []), ...(raw.matchedTerms || [])]);
        const mergedTags = new Set([...(existing.tags || []), ...(raw.tags || [])]);
        existing.matchedExpressions = Array.from(mergedExprs);
        existing.matchedTerms = Array.from(mergedTerms);
        existing.tags = Array.from(mergedTags);
        existing.score = Math.max(existing.score || 0, raw.score || 0);
        if (raw.media && (!existing.media || raw.media.ocr)) {
          existing.media = raw.media;
        }
        existing.updatedAt = now;
        updatedCount++;
      } else {
        const newItem = {
          id: generateId('item'),
          fingerprint: fp,
          text: raw.text.trim(),
          heading: (raw.heading || '').trim(),
          blockType: raw.blockType || 'paragraph',
          score: typeof raw.score === 'number' ? raw.score : 50,
          matchedExpressions: Array.from(new Set(raw.matchedExpressions || [])),
          matchedTerms: Array.from(new Set(raw.matchedTerms || [])),
          tags: Array.from(new Set(raw.tags || [])),
          note: (raw.note || '').trim(),
          ...(raw.media ? { media: raw.media } : {}),
          extractedAt: raw.extractedAt || now,
          updatedAt: now,
          source: {
            url: (raw.source && raw.source.url) || sourceUrl,
            canonicalUrl: (raw.source && raw.source.canonicalUrl) || sourceUrl,
            domain: (raw.source && raw.source.domain) || extractDomain(sourceUrl),
            title: (raw.source && raw.source.title) || 'Senza titolo',
            author: (raw.source && raw.source.author) || '',
            publishedDate: (raw.source && raw.source.publishedDate) || '',
            siteName: (raw.source && raw.source.siteName) || '',
            description: (raw.source && raw.source.description) || '',
            license: (raw.source && raw.source.license) || 'Non specificata (uso citazione/ricerca)',
            language: (raw.source && raw.source.language) || '',
            schemaType: (raw.source && raw.source.schemaType) || ''
          }
        };
        proj.items.unshift(newItem);
        existingByFp.set(fp, newItem);
        addedCount++;
      }
    }

    if (addedCount > 0 || updatedCount > 0) {
      proj.updatedAt = now;
      await saveState(state);
    }

    return {
      project: proj,
      addedCount,
      updatedCount,
      totalCount: proj.items.length
    };
  }

  async function updateItem(projectId, itemId, patch) {
    const state = await loadState();
    const proj = state.projects.find(p => p.id === (projectId || state.activeProjectId));
    if (!proj) return null;
    const item = proj.items.find(i => i.id === itemId);
    if (!item) return null;

    if (typeof patch.note === 'string') item.note = patch.note.trim();
    if (Array.isArray(patch.tags)) {
      item.tags = Array.from(new Set(patch.tags.map(t => t.trim()).filter(Boolean)));
    }
    if (typeof patch.text === 'string' && patch.text.trim()) {
      item.text = patch.text.trim();
    }
    item.updatedAt = new Date().toISOString();
    proj.updatedAt = item.updatedAt;
    await saveState(state);
    return item;
  }

  async function deleteItem(projectId, itemId) {
    const state = await loadState();
    const proj = state.projects.find(p => p.id === (projectId || state.activeProjectId));
    if (!proj) return null;
    proj.items = proj.items.filter(i => i.id !== itemId);
    proj.updatedAt = new Date().toISOString();
    await saveState(state);
    return proj;
  }

  async function clearProjectItems(projectId) {
    const state = await loadState();
    const proj = state.projects.find(p => p.id === (projectId || state.activeProjectId));
    if (!proj) return null;
    proj.items = [];
    proj.updatedAt = new Date().toISOString();
    await saveState(state);
    return proj;
  }

  function extractDomain(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch (_) {
      return 'locale';
    }
  }

  const StorageManager = {
    STORAGE_KEY,
    loadState,
    saveState,
    getActiveProject,
    setActiveProject,
    createProject,
    updateProject,
    deleteProject,
    saveGeminiSettings,
    getGeminiSettings,
    updateSettings,
    addExtractedItems,
    updateItem,
    deleteItem,
    clearProjectItems,
    computeItemFingerprint
  };

  root.StorageManager = StorageManager;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = StorageManager;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
