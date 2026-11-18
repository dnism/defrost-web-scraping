/**
 * Defrost AI Client
 * Direct client for the Google Generative Language API (no middlemen or proxies).
 * Translates research prompts into structured semantic DOM extraction strategies:
 * objectives, key concepts, boolean/exact expressions, and public web queries.
 */
(function (root) {
  'use strict';

  const DEFAULT_MODEL = 'gemini-2.5-flash';
  const DEFAULT_OLLAMA_URL = 'http://localhost:11434';
  const DEFAULT_OLLAMA_MODEL = 'qwen2.5:latest';
  const DEFAULT_OLLAMA_VISION_MODEL = 'qwen2.5vl:latest';
  const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
  const FALLBACK_GEMINI_MODELS = [
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    'gemini-2.5-pro'
  ];

  function normalizeOllamaUrl(url) {
    const raw = String(url || DEFAULT_OLLAMA_URL).trim().replace(/\/+$/, '');
    if (!raw) return DEFAULT_OLLAMA_URL;
    if (!/^https?:\/\//i.test(raw)) return `http://${raw}`;
    return raw;
  }

  function isVisionModelName(name) {
    return /vl|vision|llava|minicpm|gemma3|gemma4|qwen3\.5|pixtral|moondream|bakllava/i.test(String(name || ''));
  }

  /**
   * Normalizes model identifier, migrating fictional or retired model names to active models
   */
  function normalizeModelName(model) {
    const raw = String(model || DEFAULT_MODEL).trim();
    const clean = raw.replace(/^models\//i, '');
    if (!clean || clean === 'gemini-3.8-flash') return DEFAULT_MODEL;
    if (clean === 'gemini-3.8-pro' || clean === 'gemini-1.5-pro') return 'gemini-2.5-pro';
    if (clean === 'gemini-1.5-flash') return 'gemini-2.0-flash';
    return clean;
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

    const gMatch = key.match(/\b(AIza[0-9A-Za-z_-]{30,55})\b/);
    if (gMatch) return gMatch[1];

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

  function detectKeyProvider(cleanKey) {
    if (/^gsk_/i.test(cleanKey)) return 'groq';
    if (/^sk-or-/i.test(cleanKey)) return 'openrouter';
    if (/^sk-ant-/i.test(cleanKey)) return 'anthropic';
    if (/^sk-/i.test(cleanKey)) return 'openai';
    return 'google';
  }

  function resolveAuthConfig(apiKeyOrConfig, modelArg) {
    if (apiKeyOrConfig && typeof apiKeyOrConfig === 'object') {
      const cfg = apiKeyOrConfig;
      if (cfg.aiProvider === 'ollama' || cfg.provider === 'ollama') {
        return {
          provider: 'ollama',
          cleanKey: 'ollama',
          ollamaUrl: normalizeOllamaUrl(cfg.ollamaUrl),
          targetModel: String(cfg.ollamaModel || cfg.model || modelArg || DEFAULT_OLLAMA_MODEL).trim() || DEFAULT_OLLAMA_MODEL,
          visionModel: String(cfg.ollamaVisionModel || cfg.visionModel || DEFAULT_OLLAMA_VISION_MODEL).trim() || DEFAULT_OLLAMA_VISION_MODEL
        };
      }
      const cleanKey = sanitizeApiKey(cfg.apiKey || '');
      return {
        provider: detectKeyProvider(cleanKey),
        cleanKey,
        ollamaUrl: '',
        targetModel: normalizeModelName(cfg.model || modelArg),
        visionModel: ''
      };
    }

    const rawStr = String(apiKeyOrConfig || '').trim();
    if (rawStr === 'ollama' || /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(rawStr)) {
      return {
        provider: 'ollama',
        cleanKey: 'ollama',
        ollamaUrl: rawStr === 'ollama' ? DEFAULT_OLLAMA_URL : normalizeOllamaUrl(rawStr),
        targetModel: String(modelArg || DEFAULT_OLLAMA_MODEL).trim() || DEFAULT_OLLAMA_MODEL,
        visionModel: DEFAULT_OLLAMA_VISION_MODEL
      };
    }

    const cleanKey = sanitizeApiKey(rawStr);
    return {
      provider: detectKeyProvider(cleanKey),
      cleanKey,
      ollamaUrl: '',
      targetModel: normalizeModelName(modelArg),
      visionModel: ''
    };
  }

  // Strategy, visual OCR & model discovery caches
  const strategyCache = new Map();
  const STRATEGY_CACHE_LIMIT = 16;
  const visualCache = new Map();
  const VISUAL_CACHE_LIMIT = 24;
  const discoveredModelsCache = new Map();

  async function discoverGoogleModels(cleanKey) {
    const cached = discoveredModelsCache.get(cleanKey);
    if (cached && Date.now() - cached.at < 10 * 60 * 1000) {
      return { ok: true, models: cached.models };
    }
    const url = `${GEMINI_API_BASE}?key=${encodeURIComponent(cleanKey)}`;
    try {
      const response = await fetchWithRetry(url, {
        method: 'GET',
        headers: { 'x-goog-api-key': cleanKey }
      }, 1, 500, 12000);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const msg = (errorData.error && errorData.error.message) || `HTTP ${response.status}`;
        return { ok: false, status: response.status, error: msg };
      }

      const data = await response.json().catch(() => ({}));
      const list = Array.isArray(data.models) ? data.models : [];
      const supported = list
        .filter(m => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
        .map(m => String(m.name || '').replace(/^models\//i, ''))
        .filter(name => /^gemini-/i.test(name) && !/embedding|imagen|veo|tts|audio/i.test(name));

      if (supported.length > 0) {
        discoveredModelsCache.set(cleanKey, { at: Date.now(), models: supported });
      }
      return { ok: true, models: supported };
    } catch (err) {
      return { ok: false, status: 0, error: err.message || 'Network error' };
    }
  }

  function buildCandidateModelChain(preferredModel, discovered = []) {
    const chain = [];
    const pushUnique = (m) => {
      const clean = normalizeModelName(m);
      if (clean && !chain.includes(clean)) chain.push(clean);
    };
    pushUnique(preferredModel);
    FALLBACK_GEMINI_MODELS.forEach(pushUnique);
    discovered.forEach(pushUnique);
    return chain;
  }

  async function callOpenAiCompatibleProvider(provider, cleanKey, promptText, mediaPayload = null, jsonMode = true, systemText = '') {
    const endpoints = {
      openai: { url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' },
      groq: { url: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.3-70b-versatile' },
      openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions', model: 'google/gemini-2.5-flash' }
    };
    const cfg = endpoints[provider] || endpoints.openai;
    const content = mediaPayload && mediaPayload.base64Data && String(mediaPayload.mimeType || '').startsWith('image/')
      ? [
          { type: 'text', text: promptText },
          { type: 'image_url', image_url: { url: `data:${mediaPayload.mimeType};base64,${mediaPayload.base64Data}` } }
        ]
      : promptText;

    const messages = [];
    if (systemText) {
      messages.push({ role: 'system', content: systemText });
    }
    messages.push({ role: 'user', content });

    const body = {
      model: cfg.model,
      temperature: 0.3,
      max_tokens: 1600,
      messages
    };
    if (jsonMode && provider !== 'openrouter') {
      body.response_format = { type: 'json_object' };
    }

    const response = await fetchWithRetry(cfg.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cleanKey}`
      },
      body: JSON.stringify(body)
    }, 1, 600, 28000);

    if (!response.ok) {
      throw new Error(await parseApiErrorMessage(response));
    }
    const data = await response.json();
    const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!text) throw new Error('Empty response from AI provider.');
    return { rawText: text, usedModel: cfg.model };
  }

  async function callAnthropicProvider(cleanKey, promptText, systemText = '', mediaPayload = null) {
    const content = mediaPayload && mediaPayload.base64Data && String(mediaPayload.mimeType || '').startsWith('image/')
      ? [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaPayload.mimeType,
              data: mediaPayload.base64Data
            }
          },
          { type: 'text', text: promptText }
        ]
      : promptText;

    const reqBody = {
      model: 'claude-3-5-haiku-latest',
      max_tokens: 1600,
      messages: [{ role: 'user', content }]
    };
    if (systemText) {
      reqBody.system = systemText;
    }

    const response = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': cleanKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(reqBody)
    }, 1, 600, 28000);

    if (!response.ok) {
      throw new Error(await parseApiErrorMessage(response));
    }
    const data = await response.json();
    const text = data && Array.isArray(data.content) && data.content[0] && data.content[0].text;
    if (!text) throw new Error('Empty response from Anthropic API.');
    return { rawText: text, usedModel: 'claude-3-5-haiku-latest' };
  }

  function buildOllamaBaseCandidates(ollamaUrl) {
    const primary = normalizeOllamaUrl(ollamaUrl);
    const list = [primary];
    if (/^http:\/\/localhost\b/i.test(primary)) {
      list.push(primary.replace(/^http:\/\/localhost\b/i, 'http://127.0.0.1'));
    } else if (/^http:\/\/127\.0\.0\.1\b/i.test(primary)) {
      list.push(primary.replace(/^http:\/\/127\.0\.0\.1\b/i, 'http://localhost'));
    }
    return list;
  }

  async function discoverOllamaModels(ollamaUrl) {
    const candidates = buildOllamaBaseCandidates(ollamaUrl);
    let lastError = null;

    for (const baseUrl of candidates) {
      try {
        const response = await fetchWithRetry(`${baseUrl}/api/tags`, { method: 'GET' }, 0, 200, 3500);
        if (response.status === 403) {
          return {
            ok: false,
            status: 403,
            error: 'Ollama blocked browser extension origin (HTTP 403). Start Ollama with OLLAMA_ORIGINS="*" and retry.'
          };
        }
        if (!response.ok) {
          return { ok: false, status: response.status, error: `Ollama HTTP ${response.status}` };
        }
        const data = await response.json().catch(() => ({}));
        const list = Array.isArray(data.models) ? data.models : [];
        const models = list.map(m => String(m.name || m.model || '').trim()).filter(Boolean);
        const visionModels = models.filter(isVisionModelName);
        return { ok: true, baseUrl, models, visionModels };
      } catch (err) {
        lastError = err;
      }
    }

    const detail = lastError && lastError.message ? ` (${lastError.message})` : '';
    return {
      ok: false,
      status: 0,
      error: `Cannot reach Ollama at ${candidates[0]}. Install and start Ollama first, then retry${detail}.`
    };
  }

  async function callOllamaChat(ollamaUrl, targetModel, promptText, mediaPayload = null, jsonMode = true, systemText = '') {
    const candidates = buildOllamaBaseCandidates(ollamaUrl);
    const modelName = String(targetModel || DEFAULT_OLLAMA_MODEL).trim() || DEFAULT_OLLAMA_MODEL;
    const message = {
      role: 'user',
      content: promptText
    };
    if (mediaPayload && mediaPayload.base64Data) {
      if (String(mediaPayload.mimeType || '') === 'application/pdf') {
        throw new Error('Ollama local vision models support images/charts, not raw PDF binaries.');
      }
      message.images = [mediaPayload.base64Data];
    }

    const messages = [];
    if (systemText) {
      messages.push({ role: 'system', content: systemText });
    }
    messages.push(message);

    const body = {
      model: modelName,
      stream: false,
      options: { temperature: 0.35, num_predict: 2200 },
      messages
    };
    if (jsonMode) {
      body.format = 'json';
    }

    let response = null;
    let lastNetErr = null;
    for (const baseUrl of candidates) {
      try {
        response = await fetchWithRetry(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        }, 0, 300, 90000);
        break;
      } catch (err) {
        lastNetErr = err;
      }
    }
    if (!response) {
      throw lastNetErr || new Error(`Cannot reach Ollama at ${candidates[0]}. Make sure Ollama is running.`);
    }

    if (response.status === 403) {
      throw new Error('Ollama blocked Firefox extension POST requests (HTTP 403). Run in PowerShell: setx OLLAMA_ORIGINS "*" — then quit and reopen Ollama.');
    }
    if (response.status === 404) {
      throw new Error(`Ollama model "${modelName}" not found. Run: ollama pull ${modelName}`);
    }
    if (!response.ok) {
      const errText = await parseApiErrorMessage(response);
      throw new Error(errText || `Ollama HTTP ${response.status}`);
    }

    const data = await response.json();
    const text = data && data.message && data.message.content;
    if (!text) throw new Error('Empty response from local Ollama model.');
    return { rawText: text, usedModel: modelName };
  }

  /**
   * Executes a Google Gemini generateContent request with automatic fallback across available models
   * whenever a specific model returns 404 (not found), 503 (overloaded), or 429 (rate limited).
   */
  async function generateGeminiWithFallback(cleanKey, preferredModel, parts, generationConfig, timeoutMs = 28000, systemText = '') {
    const cachedDiscovered = discoveredModelsCache.get(cleanKey);
    let candidates = buildCandidateModelChain(preferredModel, cachedDiscovered ? cachedDiscovered.models : []);
    let lastErrorMsg = '';
    let triedDiscovery = Boolean(cachedDiscovered);

    for (let i = 0; i < candidates.length; i++) {
      const candidateModel = candidates[i];
      const url = `${GEMINI_API_BASE}/${encodeURIComponent(candidateModel)}:generateContent?key=${encodeURIComponent(cleanKey)}`;

      try {
        const reqPayload = {
          contents: [{ role: 'user', parts }],
          generationConfig
        };
        if (systemText) {
          reqPayload.systemInstruction = { parts: [{ text: systemText }] };
        }
        const response = await fetchWithRetry(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': cleanKey
          },
          body: JSON.stringify(reqPayload)
        }, 1, 500, timeoutMs);

        if (response.ok) {
          const data = await response.json();
          const rawText = extractRawResponseText(data);
          if (rawText) {
            return { ok: true, rawText, usedModel: candidateModel };
          }
          lastErrorMsg = 'Empty response generated by AI model.';
          continue;
        }

        const status = response.status;
        const errData = await response.json().catch(() => ({}));
        const detail = (errData.error && errData.error.message) || `HTTP ${status}`;

        // Genuine invalid key or permission error: stop immediately
        if (status === 401 || status === 403 || (status === 400 && /api_key_invalid|key not valid|invalid api key/i.test(detail))) {
          throw new Error(`Invalid or unauthorized API key: ${detail}`);
        }

        // If 404 model not found and we haven't queried /models yet, discover exact account models
        if (status === 404 && !triedDiscovery) {
          triedDiscovery = true;
          const disc = await discoverGoogleModels(cleanKey);
          if (disc.ok && disc.models.length > 0) {
            for (const dm of disc.models) {
              if (!candidates.includes(dm)) candidates.push(dm);
            }
          }
        }

        // On 404 (unavailable model), 503 (high demand spike), or 429 (model quota), try next fallback model
        if (status === 404 || status === 503 || status === 429) {
          lastErrorMsg = status === 503
            ? 'AI API (503): High demand spike across models. Please retry in a few seconds.'
            : (status === 429
              ? 'AI API (429): Rate limit exceeded. Please wait a moment before retrying.'
              : `Model "${candidateModel}" unavailable: ${detail}`);
          continue;
        }

        throw new Error(`AI API error (${status}): ${detail}`);
      } catch (err) {
        if (/Invalid or unauthorized API key/i.test(err.message)) {
          throw err;
        }
        lastErrorMsg = err.message || 'Network request failed.';
      }
    }

    throw new Error(lastErrorMsg || 'All candidate AI models failed to respond.');
  }

  function repairTruncatedJson(candidate) {
    let s = String(candidate || '').trim();
    const start = s.indexOf('{');
    if (start === -1) return null;
    s = s.slice(start);

    // Strip trailing partial line or unterminated string if cutoff happened mid-stream
    let inString = false;
    let escaped = false;
    const stack = [];
    let lastValidCommaOrOpen = -1;

    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\' && inString) {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === '{' || ch === '[') {
        stack.push(ch);
        lastValidCommaOrOpen = i;
      } else if (ch === '}' || ch === ']') {
        stack.pop();
        if (stack.length === 0) {
          const slice = s.slice(0, i + 1).replace(/,\s*([}\]])/g, '$1');
          return JSON.parse(slice);
        }
      } else if (ch === ',') {
        lastValidCommaOrOpen = i;
      }
    }

    // Reached EOF without closing root object: close unterminated string & drop trailing partial item
    if (inString && lastValidCommaOrOpen > 0) {
      s = s.slice(0, lastValidCommaOrOpen);
    }
    s = s.replace(/,\s*$/, '').replace(/:\s*$/, ': null');
    // Drop dangling object key without colon/value at EOF (e.g. {"a":1, "key")
    if (/,\s*"[^"]*"\s*$/.test(s)) {
      s = s.replace(/,\s*"[^"]*"\s*$/, '');
    }
    // Re-scan remaining open brackets
    const remStack = [];
    let remStr = false;
    let remEsc = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (remEsc) { remEsc = false; continue; }
      if (ch === '\\' && remStr) { remEsc = true; continue; }
      if (ch === '"') { remStr = !remStr; continue; }
      if (remStr) continue;
      if (ch === '{' || ch === '[') remStack.push(ch);
      else if (ch === '}' || ch === ']') remStack.pop();
    }
    if (remStr) s += '"';
    while (remStack.length > 0) {
      const open = remStack.pop();
      s += (open === '{' ? '}' : ']');
    }
    s = s.replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(s);
  }

  function parseGeminiJson(rawText) {
    let cleanedJson = String(rawText || '').trim();
    const fenceMatch = cleanedJson.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch && fenceMatch[1]) {
      cleanedJson = fenceMatch[1].trim();
    } else if (cleanedJson.includes('```')) {
      cleanedJson = cleanedJson.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    }
    try {
      return JSON.parse(cleanedJson);
    } catch (jsonErr) {
      const startIdx = cleanedJson.indexOf('{');
      const endIdx = cleanedJson.lastIndexOf('}');
      if (startIdx !== -1 && endIdx > startIdx) {
        try {
          return JSON.parse(cleanedJson.slice(startIdx, endIdx + 1).replace(/,\s*([}\]])/g, '$1'));
        } catch (_) {
          // fall through to truncated-JSON repair
        }
      }
      try {
        const repaired = repairTruncatedJson(cleanedJson);
        if (repaired && typeof repaired === 'object') return repaired;
      } catch (_) {
        // ignore repair error and surface original message
      }
      throw new Error('AI output could not be parsed as JSON: ' + jsonErr.message);
    }
  }

  function extractRawResponseText(data) {
    return data &&
      data.candidates &&
      data.candidates[0] &&
      data.candidates[0].content &&
      data.candidates[0].content.parts &&
      data.candidates[0].content.parts[0] &&
      data.candidates[0].content.parts[0].text;
  }

  async function parseApiErrorMessage(response) {
    const errorData = await response.json().catch(() => ({}));
    const msg = errorData.error && errorData.error.message ? errorData.error.message : `HTTP ${response.status}`;
    if (response.status === 503) {
      return 'AI API (503): High demand spike on model servers. Please retry in a few seconds.';
    }
    if (response.status === 429) {
      return 'AI API (429): Rate limit exceeded. Please wait a moment before retrying.';
    }
    return `AI API error (${response.status}): ${msg}`;
  }

  /**
   * Helper to perform fetch with timeout and automatic retry on temporary 503/429 spikes
   */
  async function fetchWithRetry(url, fetchOptions, maxRetries = 2, delayMs = 700, timeoutMs = 22000) {
    let lastResponse;
    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
      }

      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

      try {
        const opts = controller ? { ...fetchOptions, signal: controller.signal } : fetchOptions;
        const response = await fetch(url, opts);
        if (timer) clearTimeout(timer);
        if (response.ok) {
          return response;
        }

        lastResponse = response;
        // Only retry on transient server overload (503) or rate limiting (429)
        if (response.status !== 503 && response.status !== 429) {
          return response;
        }
      } catch (err) {
        if (timer) clearTimeout(timer);
        lastError = err && err.name === 'AbortError'
          ? new Error('Request timed out. Please try again.')
          : err;
      }
    }

    if (lastResponse) return lastResponse;
    throw lastError || new Error('Network request failed after retries.');
  }

  /**
   * Verifies the validity of the API key (or local Ollama server) and resolves an active model
   */
  async function testConnection(apiKeyOrConfig, model = DEFAULT_MODEL) {
    const auth = resolveAuthConfig(apiKeyOrConfig, model);
    if (auth.provider !== 'ollama' && !auth.cleanKey) {
      return { ok: false, error: 'API key is missing. Please paste your key in Settings.' };
    }

    const { provider, cleanKey, ollamaUrl, targetModel } = auth;

    try {
      if (provider === 'ollama') {
        const disc = await discoverOllamaModels(ollamaUrl);
        if (!disc.ok) {
          return { ok: false, error: disc.error };
        }
        if (disc.models.length === 0) {
          return {
            ok: false,
            error: `Ollama is running at ${ollamaUrl}, but no models are installed. Run: ollama pull qwen2.5`
          };
        }
        const resolvedModel = disc.models.includes(targetModel) ? targetModel : disc.models[0];
        // Verify POST requests with extension Origin header are not blocked with HTTP 403 by OLLAMA_ORIGINS
        try {
          const postCheck = await fetchWithRetry(`${disc.baseUrl || ollamaUrl}/api/show`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: resolvedModel })
          }, 0, 200, 4000);
          if (postCheck && postCheck.status === 403) {
            return {
              ok: false,
              error: 'Ollama is running but blocked Firefox extension POST requests (HTTP 403). Run in PowerShell: setx OLLAMA_ORIGINS "*" — then quit and reopen Ollama.'
            };
          }
        } catch (_) {
          // Ignore non-HTTP probe failures if /api/tags succeeded
        }
        return {
          ok: true,
          resolvedModel,
          availableModels: disc.models,
          visionModels: disc.visionModels,
          message: `Ollama connected (${resolvedModel} ready, ${disc.models.length} local model${disc.models.length === 1 ? '' : 's'}).`
        };
      }

      if (provider !== 'google') {
        if (provider === 'anthropic') {
          const res = await callAnthropicProvider(cleanKey, 'Reply with {"ok":true}');
          return { ok: true, resolvedModel: res.usedModel, message: `Connected (${provider}: ${res.usedModel})` };
        }
        const res = await callOpenAiCompatibleProvider(provider, cleanKey, 'Reply with {"ok":true}', null, false);
        return { ok: true, resolvedModel: res.usedModel, message: `Connected (${provider}: ${res.usedModel})` };
      }

      // 1. Fast, zero-token verification + model discovery via GET /v1beta/models
      const disc = await discoverGoogleModels(cleanKey);
      if (!disc.ok && (disc.status === 400 || disc.status === 401 || disc.status === 403)) {
        return { ok: false, error: `Invalid or unauthorized API key: ${disc.error}` };
      }

      if (disc.ok && disc.models.length > 0) {
        const resolvedModel = disc.models.includes(targetModel)
          ? targetModel
          : (FALLBACK_GEMINI_MODELS.find(m => disc.models.includes(m)) || disc.models[0]);
        return {
          ok: true,
          resolvedModel,
          availableModels: disc.models,
          message: `API key verified (${resolvedModel} ready).`
        };
      }

      // 2. Fallback ping with automatic model fallback chain
      const gen = await generateGeminiWithFallback(
        cleanKey,
        targetModel,
        [{ text: 'Reply with OK' }],
        { maxOutputTokens: 8, temperature: 0.1 },
        12000
      );
      return {
        ok: true,
        resolvedModel: gen.usedModel,
        message: `API key verified (${gen.usedModel} ready).`
      };
    } catch (err) {
      return { ok: false, error: err.message || 'Please check your API key and connection.' };
    }
  }

  /**
   * Sends research question to the AI API (or local Ollama) and parses a structured extraction strategy
   */
  async function interpretResearchPrompt(promptText, apiKeyOrConfig, model = DEFAULT_MODEL) {
    const cleanPrompt = String(promptText || '').trim();
    const auth = resolveAuthConfig(apiKeyOrConfig, model);

    if (auth.provider !== 'ollama' && !auth.cleanKey) {
      return { ok: false, error: 'AI API key missing. Configure it in Settings.' };
    }
    if (!cleanPrompt) {
      return { ok: false, error: 'Please enter a research inquiry or text to analyze.' };
    }

    const { provider, cleanKey, ollamaUrl, targetModel } = auth;
    const cacheKey = `${provider}::${ollamaUrl}::${targetModel}::${cleanPrompt}`;
    const cachedStrategy = strategyCache.get(cacheKey);
    if (cachedStrategy) {
      return { ok: true, strategy: cachedStrategy, cached: true };
    }

    const systemInstruction = `You are a Senior Research Analyst, Domain Taxonomist, and OSINT Search Engineer.
Your task is to DEEPLY INTERPRET the user's research question using real-world domain knowledge — NEVER copy or split words from the conversational prompt (ignore words like "ho bisogno", "ricerca", "web scraping", "vorrei conoscere", "I need", "research", "people").

Field rules:
- "objective": 1 crisp sentence in the prompt's language defining the real research goal.
- "synonymsAndTranslations": 5 to 7 DISTINCT short keyword items (1 item per array element, NEVER comma-joined!): include local-language technical names, full expanded forms of acronyms, AND English equivalents. Always prioritize real native local terminology when a country/language is specified!
- "standardsAndTechnicalTerms": 4 to 6 DISTINCT short keyword items: real protocols, standards, interoperability frameworks, regulations, or technical jargon.
- "entitiesAndPlayers": 4 to 6 DISTINCT short keyword items: real national agencies, public programs/platforms, major local + international software vendors, or authoritative organizations for that country/sector.
- "marketAndOutcomeTerms": 3 to 5 DISTINCT short keyword items: adoption metrics, costs, tenders/procurement, or operational impacts.
- "webQueries": 4 to 5 clean, ready-to-paste search-engine query strings (NO "Query 1:" prefix!). Mix native local queries and English queries using quotes "..." and OR/site: operators to discover: vendors/market, official agencies/regulations, technical standards, and adoption/case studies.
- "primaryExpressions": 4 to 6 flat Defrost DOM matching rules (plain concepts, "exact phrase", or "termA OR termB OR termC"). Avoid nested parentheses.
- "regexPatterns": 1 to 2 valid JS regex strings with /.../i delimiters matching domain acronyms or numeric metrics.
- "exclusions": 4 to 6 noise terms to ignore on webpages.

Output STRICT compact JSON matching this exact shape (1 keyword per string element):
{
  "objective": "...",
  "synonymsAndTranslations": ["...", "...", "...", "...", "..."],
  "standardsAndTechnicalTerms": ["...", "...", "...", "..."],
  "entitiesAndPlayers": ["...", "...", "...", "..."],
  "marketAndOutcomeTerms": ["...", "...", "..."],
  "webQueries": ["...", "...", "...", "..."],
  "primaryExpressions": ["...", "...", "...", "..."],
  "regexPatterns": ["/\\\\b(ACRONYM1|ACRONYM2)\\\\b/i", "/\\\\b\\\\d+(?:[.,]\\\\d+)?\\\\s*(?:%|€|\\\\$)\\\\b/i"],
  "exclusions": ["cookie", "privacy", "login", "newsletter", "careers"],
  "targetElements": ["paragraphs", "tables", "lists", "quotes_comments", "visuals"],
  "recommendedMinScore": 15,
  "enableVisualScan": true,
  "advice": "..."
}`;

    const userPrompt = `RESEARCH PROMPT:\n"""\n${cleanPrompt}\n"""\n\nOutput strict compact JSON only. Put 1 individual keyword per array string (never comma-separated strings) and clean search queries without "Query N:" labels.`;

    try {
      let rawText = '';
      let usedModel = targetModel;

      if (provider === 'ollama') {
        const gen = await callOllamaChat(ollamaUrl, targetModel, userPrompt, null, true, systemInstruction);
        rawText = gen.rawText;
        usedModel = gen.usedModel;
      } else if (provider === 'google') {
        const gen = await generateGeminiWithFallback(
          cleanKey,
          targetModel,
          [{ text: userPrompt }],
          {
            temperature: 0.3,
            maxOutputTokens: 1600,
            responseMimeType: 'application/json'
          },
          30000,
          systemInstruction
        );
        rawText = gen.rawText;
        usedModel = gen.usedModel;
      } else if (provider === 'anthropic') {
        const gen = await callAnthropicProvider(cleanKey, userPrompt, systemInstruction);
        rawText = gen.rawText;
        usedModel = gen.usedModel;
      } else {
        const gen = await callOpenAiCompatibleProvider(provider, cleanKey, userPrompt, null, true, systemInstruction);
        rawText = gen.rawText;
        usedModel = gen.usedModel;
      }

      const parsed = parseGeminiJson(rawText);
      const localFallback = (root.ExpressionEngine && root.ExpressionEngine.buildScrapingPlanFromQuestion)
        ? root.ExpressionEngine.buildScrapingPlanFromQuestion(cleanPrompt)
        : null;

      const cleanStringArray = (arr, limit = 30, splitCommas = false) => {
        if (!Array.isArray(arr)) return [];
        const out = [];
        const seen = new Set();
        for (const item of arr) {
          const chunks = splitCommas ? String(item || '').split(/[,;]+/) : [String(item || '')];
          for (const rawChunk of chunks) {
            const s = rawChunk.trim();
            if (s.length < 2) continue;
            const k = s.toLowerCase();
            if (seen.has(k)) continue;
            seen.add(k);
            out.push(s);
            if (out.length >= limit) return out;
          }
        }
        return out;
      };

      const aiConcepts = cleanStringArray([
        ...(Array.isArray(parsed.synonymsAndTranslations) ? parsed.synonymsAndTranslations : []),
        ...(Array.isArray(parsed.standardsAndTechnicalTerms) ? parsed.standardsAndTechnicalTerms : []),
        ...(Array.isArray(parsed.entitiesAndPlayers) ? parsed.entitiesAndPlayers : []),
        ...(Array.isArray(parsed.marketAndOutcomeTerms) ? parsed.marketAndOutcomeTerms : []),
        ...(Array.isArray(parsed.keyConcepts) ? parsed.keyConcepts : []),
        ...(Array.isArray(parsed.keywords) ? parsed.keywords : []),
        ...(Array.isArray(parsed.concepts) ? parsed.concepts : [])
      ], 26, true);
      const aiPrimary = cleanStringArray(parsed.primaryExpressions || parsed.expressions, 10);
      const aiRegex = cleanStringArray(parsed.regexPatterns || parsed.regex, 5).map(rx => {
        if (/^\/.+\/[gimsuy]*$/.test(rx)) return rx;
        const cleaned = rx.replace(/^\/+|\/+$/g, '');
        return cleaned ? `/${cleaned}/i` : '';
      }).filter(rx => {
        const m = /^\/(.+)\/([gimsuy]*)$/.exec(rx);
        if (!m) return false;
        try { new RegExp(m[1], m[2]); return true; } catch (_) { return false; }
      });
      const aiExcl = cleanStringArray(parsed.exclusions || parsed.exclude, 10, true);
      const rawQueries = cleanStringArray(parsed.webQueries || parsed.searchQueries || parsed.queries, 8);
      const aiQueries = rawQueries.map(q => q.replace(/^query\s*\d*\s*:\s*/i, '').trim()).filter(Boolean);
      const aiTargets = cleanStringArray(parsed.targetElements, 6);

      const strategy = {
        objective: String(parsed.objective || '').trim() || (localFallback && localFallback.objective) || cleanPrompt.slice(0, 120),
        keyConcepts: aiConcepts.length > 0 ? aiConcepts : ((localFallback && localFallback.keyConcepts) || []),
        primaryExpressions: aiPrimary.length > 0 ? aiPrimary : ((localFallback && localFallback.primaryExpressions) || [cleanPrompt.slice(0, 100)]),
        regexPatterns: aiRegex.length > 0 ? aiRegex : ((localFallback && localFallback.regexPatterns) || []),
        exclusions: aiExcl.length > 0 ? aiExcl : ((localFallback && localFallback.exclusions) || []),
        targetElements: aiTargets.length > 0
          ? aiTargets
          : ((localFallback && localFallback.targetElements) || ['paragraphs', 'quotes_comments', 'tables', 'lists', 'visuals']),
        recommendedMinScore: typeof parsed.recommendedMinScore === 'number'
          ? Math.max(5, Math.min(50, parsed.recommendedMinScore))
          : ((localFallback && localFallback.recommendedMinScore) || 15),
        enableVisualScan: parsed.enableVisualScan !== false,
        webQueries: aiQueries.length > 0 ? aiQueries : ((localFallback && localFallback.webQueries) || []),
        advice: String(parsed.advice || '').trim() || (localFallback && localFallback.advice) || '',
        usedModel
      };

      strategy.compiledExpressions = (root.ExpressionEngine && root.ExpressionEngine.compileStrategyExpressions)
        ? root.ExpressionEngine.compileStrategyExpressions(strategy)
        : [...strategy.primaryExpressions, ...strategy.regexPatterns].join('\n');

      if (strategyCache.size >= STRATEGY_CACHE_LIMIT) {
        strategyCache.delete(strategyCache.keys().next().value);
      }
      strategyCache.set(cacheKey, strategy);

      return { ok: true, strategy, usedModel };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * Analyzes an image, chart, SVG/canvas raster, or PDF via multimodal AI API
   * and returns structured OCR text + factual visual summary.
   */
  async function analyzeVisualMedia(mediaPayload, apiKeyOrConfig, model = DEFAULT_MODEL) {
    const auth = resolveAuthConfig(apiKeyOrConfig, model);
    if (auth.provider !== 'ollama' && !auth.cleanKey) {
      return { ok: false, error: 'AI API key missing. Configure it in Settings.' };
    }

    const base64Data = String((mediaPayload && mediaPayload.base64Data) || '').trim();
    const mimeType = String((mediaPayload && mediaPayload.mimeType) || 'image/png').trim();
    if (!base64Data) {
      return { ok: false, error: 'Empty visual media payload.' };
    }

    const { provider, cleanKey, ollamaUrl, targetModel, visionModel } = auth;
    const effectiveModel = provider === 'ollama' ? (visionModel || targetModel) : targetModel;
    const exprHint = String((mediaPayload && mediaPayload.expressions) || '').trim().slice(0, 300);
    const midIdx = Math.floor(base64Data.length / 2);
    const cacheKey = `${provider}::${ollamaUrl}::${effectiveModel}::${mimeType}::${base64Data.length}::${base64Data.slice(0, 48)}::${base64Data.slice(midIdx, midIdx + 32)}::${base64Data.slice(-24)}::${exprHint}`;
    const cached = visualCache.get(cacheKey);
    if (cached) {
      return { ok: true, result: cached, cached: true };
    }

    const ctxParts = [];
    if (mediaPayload.pageTitle) ctxParts.push(`Page: ${String(mediaPayload.pageTitle).slice(0, 120)}`);
    if (mediaPayload.captionText) ctxParts.push(`Caption: ${String(mediaPayload.captionText).slice(0, 220)}`);
    if (mediaPayload.altText) ctxParts.push(`Alt: ${String(mediaPayload.altText).slice(0, 180)}`);
    if (mediaPayload.researchContext) ctxParts.push(`Research Focus: ${String(mediaPayload.researchContext).slice(0, 220)}`);
    if (exprHint) ctxParts.push(`Target Keywords/Rules: ${exprHint}`);

    const promptText = `Extract all factual research information from this ${mimeType === 'application/pdf' ? 'PDF document' : 'image/chart/graphic'} as strict JSON (no markdown):
{
  "title": "Short descriptive title of this visual/document",
  "ocrText": "Exact verbatim text, numbers, chart labels, axes, legend entries, or table rows visible",
  "visualSummary": "Concise factual summary of trends, data points, or key visual evidence",
  "detectedTerms": ["keyword1", "keyword2"],
  "hasMeaningfulContent": true
}
Set "hasMeaningfulContent" to false ONLY for empty spacers, purely decorative stock icons, or UI buttons without informational content. Keep the original language of the image text.${ctxParts.length ? '\nCONTEXT:\n' + ctxParts.join('\n') : ''}`;

    try {
      let rawText = '';
      if (provider === 'ollama') {
        const gen = await callOllamaChat(ollamaUrl, effectiveModel, promptText, { base64Data, mimeType }, true);
        rawText = gen.rawText;
      } else if (provider === 'google') {
        const gen = await generateGeminiWithFallback(
          cleanKey,
          targetModel,
          [
            { text: promptText },
            { inlineData: { mimeType, data: base64Data } }
          ],
          {
            temperature: 0.15,
            maxOutputTokens: 900,
            responseMimeType: 'application/json'
          },
          28000
        );
        rawText = gen.rawText;
      } else if (provider === 'anthropic') {
        const gen = await callAnthropicProvider(cleanKey, promptText, '', { base64Data, mimeType });
        rawText = gen.rawText;
      } else {
        const gen = await callOpenAiCompatibleProvider(provider, cleanKey, promptText, { base64Data, mimeType }, true);
        rawText = gen.rawText;
      }

      const parsed = parseGeminiJson(rawText);
      const result = {
        title: String(parsed.title || mediaPayload.captionText || mediaPayload.altText || 'Visual Extract').trim(),
        ocrText: String(parsed.ocrText || '').trim(),
        visualSummary: String(parsed.visualSummary || '').trim(),
        detectedTerms: Array.isArray(parsed.detectedTerms) ? parsed.detectedTerms.map(t => String(t).trim()).filter(Boolean) : [],
        hasMeaningfulContent: parsed.hasMeaningfulContent !== false
      };

      if (visualCache.size >= VISUAL_CACHE_LIMIT) {
        visualCache.delete(visualCache.keys().next().value);
      }
      visualCache.set(cacheKey, result);

      return { ok: true, result };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  const GeminiClient = {
    DEFAULT_MODEL,
    DEFAULT_OLLAMA_URL,
    DEFAULT_OLLAMA_MODEL,
    DEFAULT_OLLAMA_VISION_MODEL,
    FALLBACK_GEMINI_MODELS,
    normalizeModelName,
    normalizeOllamaUrl,
    sanitizeApiKey,
    discoverOllamaModels,
    testConnection,
    interpretResearchPrompt,
    analyzeVisualMedia
  };

  root.GeminiClient = GeminiClient;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = GeminiClient;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
