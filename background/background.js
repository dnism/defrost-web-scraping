/**
 * LexiScrape Background Coordinator
 * Gestisce il menu contestuale, la scansione della scheda attiva e delle schede aperte
 * con rate-limiting automatico, il lancio di ricerche guidate e la sincronizzazione dello stato.
 */
(function (root) {
  'use strict';

  const SEARCH_ENGINES = {
    duckduckgo: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`,
    wikipedia_it: (q) => `https://it.wikipedia.org/w/index.php?search=${encodeURIComponent(q)}`,
    wikipedia_en: (q) => `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(q)}`,
    google: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
    scholar: (q) => `https://scholar.google.com/scholar?q=${encodeURIComponent(q)}`,
    arxiv: (q) => `https://arxiv.org/search/?query=${encodeURIComponent(q)}&searchtype=all`
  };

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function updateBadge() {
    try {
      const proj = await root.StorageManager.getActiveProject();
      const count = proj && Array.isArray(proj.items) ? proj.items.length : 0;
      const text = count > 0 ? (count > 99 ? '99+' : String(count)) : '';
      if (browser.action && browser.action.setBadgeText) {
        await browser.action.setBadgeText({ text });
        await browser.action.setBadgeBackgroundColor({ color: '#0284c7' });
      }
    } catch (_) {}
  }

  function notifyViews(payload) {
    try {
      browser.runtime.sendMessage(payload).catch(() => {});
    } catch (_) {}
  }

  /**
   * Assicura che i content script siano caricati nella scheda target
   * (utile per schede aperte prima dell'installazione dell'add-on)
   */
  async function ensureContentScript(tabId) {
    try {
      const pong = await browser.tabs.sendMessage(tabId, { type: 'PING' });
      if (pong && pong.ok) return true;
    } catch (_) {
      try {
        if (browser.scripting && browser.scripting.executeScript) {
          await browser.scripting.insertCSS({
            target: { tabId },
            files: ['content/extractor.css']
          }).catch(() => {});
          await browser.scripting.executeScript({
            target: { tabId },
            files: ['shared/expression-engine.js', 'content/extractor.js']
          });
          return true;
        }
      } catch (err) {
        return false;
      }
    }
    return false;
  }

  /**
   * Scansiona una singola scheda per le espressioni specificate
   */
  async function scanTab(tabId, expressions, options = {}) {
    const ready = await ensureContentScript(tabId);
    if (!ready) {
      return { ok: false, error: 'Impossibile accedere al contenuto di questa scheda (pagina protetta del browser o non supportata).' };
    }

    let includeVisuals = options.includeVisuals;
    if (typeof includeVisuals !== 'boolean') {
      const state = await root.StorageManager.loadState();
      includeVisuals = !state.settings || state.settings.includeLocalVisuals !== false;
    }

    try {
      const res = await browser.tabs.sendMessage(tabId, {
        type: 'SCAN_PAGE',
        expressions,
        highlight: options.highlight !== false,
        minScore: options.minScore || 10,
        includeVisuals,
        targetElements: options.targetElements
      });

      if (res && res.ok && options.autoSave && Array.isArray(res.matches) && res.matches.length > 0) {
        const saveStats = await root.StorageManager.addExtractedItems(res.matches, options.projectId);
        await updateBadge();
        notifyViews({ type: 'STATE_UPDATED', reason: 'scan_saved' });
        return { ...res, saveStats };
      }

      return res || { ok: false, error: 'Nessuna risposta dalla pagina.' };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : 'Errore durante la scansione della scheda.' };
    }
  }

  /**
   * Scansiona tutte le schede HTTP/HTTPS aperte nella finestra corrente
   * in batch concorrenti con rate-limit leggero e salvataggio batch singolo.
   */
  async function scanAllOpenTabs(expressions, options = {}) {
    const state = await root.StorageManager.loadState();
    const batchDelayMs = Math.min((state.settings && state.settings.rateLimitMs) || 60, 80);
    const includeVisuals = !state.settings || state.settings.includeLocalVisuals !== false;

    const tabs = await browser.tabs.query({ currentWindow: true });
    const webTabs = tabs.filter(t => t.url && /^https?:\/\//i.test(t.url));

    let scannedTabs = 0;
    let totalMatches = 0;
    let totalAdded = 0;
    let totalUpdated = 0;
    const tabSummaries = [];
    const batchedMatches = [];
    const CONCURRENCY = 4;

    for (let i = 0; i < webTabs.length; i += CONCURRENCY) {
      const batch = webTabs.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(async (tab) => {
          const res = await scanTab(tab.id, expressions, {
            highlight: options.highlight !== false,
            minScore: options.minScore || 10,
            includeVisuals,
            targetElements: options.targetElements,
            autoSave: false,
            projectId: options.projectId
          });
          return { tab, res };
        })
      );

      for (const { tab, res } of batchResults) {
        if (res && res.ok) {
          scannedTabs++;
          const matches = Array.isArray(res.matches) ? res.matches : [];
          totalMatches += matches.length;
          if (matches.length > 0) {
            batchedMatches.push(...matches);
          }
          tabSummaries.push({
            tabId: tab.id,
            title: tab.title || tab.url,
            url: tab.url,
            matchCount: matches.length
          });
        }
      }

      notifyViews({
        type: 'MULTI_SCAN_PROGRESS',
        current: Math.min(i + batch.length, webTabs.length),
        total: webTabs.length
      });

      if (i + CONCURRENCY < webTabs.length && batchDelayMs > 0) {
        await sleep(batchDelayMs);
      }
    }

    if (options.autoSave !== false && batchedMatches.length > 0) {
      const saveStats = await root.StorageManager.addExtractedItems(batchedMatches, options.projectId);
      totalAdded = saveStats.addedCount;
      totalUpdated = saveStats.updatedCount;
    }

    await updateBadge();
    notifyViews({ type: 'STATE_UPDATED', reason: 'multi_tab_scan_complete' });

    return {
      ok: true,
      scannedTabs,
      totalWebTabs: webTabs.length,
      totalMatches,
      totalAdded,
      totalUpdated,
      tabSummaries
    };
  }

  /**
   * Lancia una ricerca guidata sul motore scelto dall'utente
   */
  async function launchGuidedSearch(query, engineKey = 'duckduckgo') {
    const cleanQuery = String(query || '').trim();
    if (!cleanQuery) {
      return { ok: false, error: 'Inserisci una parola chiave o espressione da cercare.' };
    }
    const builder = SEARCH_ENGINES[engineKey] || SEARCH_ENGINES.duckduckgo;
    const targetUrl = builder(cleanQuery);
    const tab = await browser.tabs.create({ url: targetUrl, active: true });
    return { ok: true, tabId: tab.id, url: targetUrl };
  }

  /**
   * Waits for a browser tab to reach 'complete' status, with a timeout guard.
   */
  async function waitForTabComplete(tabId, timeoutMs = 12000) {
    try {
      const current = await browser.tabs.get(tabId);
      if (current && current.status === 'complete') return true;
    } catch (_) {
      return false;
    }

    return new Promise((resolve) => {
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (browser.tabs && browser.tabs.onUpdated) {
          browser.tabs.onUpdated.removeListener(onUpdated);
        }
        resolve(ok);
      };

      const onUpdated = (updatedId, changeInfo) => {
        if (updatedId === tabId && changeInfo && changeInfo.status === 'complete') {
          finish(true);
        }
      };

      const timer = setTimeout(() => finish(false), timeoutMs);
      browser.tabs.onUpdated.addListener(onUpdated);
    });
  }

  /**
   * Extracts up to `limit` organic result URLs from an open search engine tab.
   */
  async function extractSearchResultUrlsFromTab(tabId, limit = 5) {
    const maxCount = Math.max(1, Math.min(50, Number(limit) || 5));
    const injected = await browser.scripting.executeScript({
      target: { tabId },
      func: (maxUrls) => {
        const host = location.hostname.toLowerCase();
        const unwrapUrl = (rawHref) => {
          try {
            const u = new URL(rawHref, location.href);
            if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
            if (u.hostname.includes('google.') && u.pathname === '/url') {
              const q = u.searchParams.get('q') || u.searchParams.get('url');
              if (q) return new URL(q).href;
            }
            if (u.hostname.includes('duckduckgo.com') && u.pathname.startsWith('/l/')) {
              const uddg = u.searchParams.get('uddg');
              if (uddg) return new URL(uddg).href;
            }
            return u.href;
          } catch (_) {
            return null;
          }
        };

        const isNoiseUrl = (href) => {
          try {
            const u = new URL(href);
            const h = u.hostname.toLowerCase();
            if (h === host || h.endsWith(`.${host}`)) return true;
            if (
              h.includes('googleadservices.') ||
              h.includes('doubleclick.') ||
              h.includes('accounts.google.') ||
              h.includes('support.google.') ||
              h.includes('policies.google.') ||
              h.includes('maps.google.') ||
              (h.includes('google.') && (u.pathname.startsWith('/search') || u.pathname.startsWith('/preferences'))) ||
              (h.includes('bing.com') && (u.pathname.startsWith('/aclick') || u.pathname.startsWith('/search'))) ||
              (h.includes('duckduckgo.com') && (u.pathname === '/' || u.pathname.startsWith('/y.js')))
            ) {
              return true;
            }
            return false;
          } catch (_) {
            return true;
          }
        };

        const selectors = [
          // Google Search
          '#search a:has(h3), #rso a:has(h3)',
          // DuckDuckGo
          'article[data-testid="result"] a[data-testid="result-title-a"], a.result__a',
          // Bing
          '#b_results li.b_algo h2 a',
          // Google Scholar
          '#gs_res_ccl_mid .gs_rt a',
          // Brave / Startpage / Ecosia / Generic fallback
          'main a[href^="http"]:has(h2, h3), main a[href^="http"]'
        ];

        const seen = new Set();
        const results = [];
        for (const sel of selectors) {
          const nodes = Array.from(document.querySelectorAll(sel));
          for (const a of nodes) {
            if (!a || !a.getAttribute('href')) continue;
            if (a.closest('[data-text-ad], .ads-ad, #tads, #bottomads, .b_ad, .result--ad')) continue;
            const resolved = unwrapUrl(a.getAttribute('href'));
            if (!resolved || isNoiseUrl(resolved)) continue;
            const norm = resolved.split('#')[0];
            if (seen.has(norm)) continue;
            seen.add(norm);
            results.push({
              url: resolved,
              title: String(a.textContent || '').replace(/\s+/g, ' ').trim()
            });
            if (results.length >= maxUrls) return results;
          }
          if (results.length > 0) break;
        }
        return results;
      },
      args: [maxCount]
    });

    const first = Array.isArray(injected) && injected[0] ? injected[0].result : [];
    return Array.isArray(first) ? first : [];
  }

  const SOURCE_FILTER_RULES = {
    forums: {
      domains: [
        'reddit.com', 'quora.com', 'news.ycombinator.com', 'stackexchange.com',
        'stackoverflow.com', 'superuser.com', 'trustpilot.com', 'discourse.',
        'disqus.com', 'answers.microsoft.com', 'community.', 'forum.', 'forums.'
      ],
      pathOrTitle: /(?:\/forum|\/forums|\/thread|\/threads|\/topic|\/discussion|\/community|\/comments|\/opinioni|\/recensioni|\/reviews|\breddit\b|\bquora\b|\bforum\b|\bopinioni\b|\brecensioni\b|\bdiscussion\b)/i
    },
    papers: {
      domains: [
        'arxiv.org', 'pubmed.ncbi.nlm.nih.gov', 'pmc.ncbi.nlm.nih.gov', 'ncbi.nlm.nih.gov',
        'scholar.google.', 'sciencedirect.com', 'springer.com', 'link.springer.com',
        'researchgate.net', 'ieee.org', 'ieeexplore.ieee.org', 'nature.com',
        'plos.org', 'mdpi.com', 'wiley.com', 'onlinelibrary.wiley.com',
        'tandfonline.com', 'sagepub.com', 'jstor.org', 'academia.edu',
        'semanticscholar.org', 'frontiersin.org', 'bmj.com', 'thelancet.com',
        'dl.acm.org', 'biorxiv.org', 'medrxiv.org', 'ssrn.com', 'zenodo.org'
      ],
      pathOrTitle: /(?:\.pdf(?:$|\?)|\.edu(?:\/|$)|\/doi\/|\/paper|\/papers|\/article\/pii\/|\/articles\/pmc|\/chapter\/|\bjournal\b|\bpreprint\b|\babstract\b)/i
    },
    news: {
      domains: [
        'reuters.com', 'bbc.com', 'bbc.co.uk', 'nytimes.com', 'theguardian.com',
        'washingtonpost.com', 'bloomberg.com', 'forbes.com', 'wired.com', 'wired.it',
        'techcrunch.com', 'arstechnica.com', 'theverge.com', 'ilsole24ore.com',
        'repubblica.it', 'corriere.it', 'ansa.it', 'lastampa.it', 'ilpost.it',
        'fanpage.it', 'tg24.sky.it', 'agi.it', 'adnkronos.com', 'medium.com',
        'substack.com', 'apnews.com', 'cnn.com', 'economist.com', 'ft.com'
      ],
      pathOrTitle: /(?:\/news\/|\/notizie\/|\/articolo\/|\/articoli\/|\/cronaca\/|\/economia\/|\/blog\/|\/story\/|\/202[0-9]\/|\bnews\b|\beditorial\b|\bpress\b)/i
    },
    official: {
      domains: [
        'who.int', 'oecd.org', 'ec.europa.eu', 'europa.eu', 'agid.gov.it',
        'salute.gov.it', 'agenas.gov.it', 'nih.gov', 'cdc.gov', 'fda.gov',
        'unesco.org', 'un.org', 'worldbank.org', 'iso.org', 'w3.org'
      ],
      pathOrTitle: /(?:\.gov(?:\.[a-z]{2})?(?:\/|$)|\.europa\.eu(?:\/|$)|\.int(?:\/|$)|\.org(?:\/|$)|\/docs\/|\/documentation\/|\/publications\/|\/policy\/|\/guidelines\/)/i
    }
  };

  function matchesSourceFilters(item, filters) {
    if (!Array.isArray(filters) || filters.length === 0) return true;
    const urlStr = typeof item === 'string' ? item : String((item && item.url) || '');
    const titleStr = typeof item === 'object' && item ? String(item.title || '') : '';
    let hostname = '';
    try {
      hostname = new URL(urlStr).hostname.toLowerCase();
    } catch (_) {
      return false;
    }
    const combined = `${urlStr} ${titleStr}`;

    return filters.some((key) => {
      const rule = SOURCE_FILTER_RULES[key];
      if (!rule) return false;
      if (rule.domains.some(d => hostname.includes(d))) return true;
      return rule.pathOrTitle.test(combined);
    });
  }

  function applySourceFiltersToQuery(query, filters) {
    const clean = String(query || '').trim();
    if (!clean || !Array.isArray(filters) || filters.length === 0) return clean;
    const clauses = [];
    if (filters.includes('forums')) {
      clauses.push('site:reddit.com OR site:quora.com OR site:news.ycombinator.com OR forum OR opinioni');
    }
    if (filters.includes('papers')) {
      clauses.push('site:arxiv.org OR site:pmc.ncbi.nlm.nih.gov OR site:sciencedirect.com OR site:springer.com OR site:researchgate.net OR filetype:pdf');
    }
    if (filters.includes('news')) {
      clauses.push('news OR article OR articolo OR giornale OR editorial');
    }
    if (filters.includes('official')) {
      clauses.push('site:.gov OR site:.europa.eu OR site:.org');
    }
    if (!clauses.length) return clean;
    return `${clean} (${clauses.join(' OR ')})`;
  }

  async function clickDuckDuckGoMoreResults(tabId) {
    try {
      const res = await browser.scripting.executeScript({
        target: { tabId },
        func: () => {
          const btn = document.querySelector('button#more-results, a.result--more__btn, button[data-testid="more-results"]');
          if (!btn || btn.disabled) return false;
          btn.click();
          return true;
        }
      });
      return Boolean(res && res[0] && res[0].result);
    } catch (_) {
      return false;
    }
  }

  function buildPaginatedSearchUrl(baseUrl, pageIndex) {
    try {
      const u = new URL(baseUrl);
      const h = u.hostname.toLowerCase();
      if (h.includes('scholar.google.') || (h.includes('google.') && u.pathname.includes('/search'))) {
        u.searchParams.set('start', String(pageIndex * 10));
        return u.href;
      }
      if (h.includes('bing.com') && u.pathname.includes('/search')) {
        u.searchParams.set('first', String(pageIndex * 10 + 1));
        return u.href;
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  /**
   * Opens the top N search result pages from either a query or the active search tab,
   * automatically paginating across result pages when count > 10.
   */
  async function openTopSearchResults({ query = '', engine = 'duckduckgo', count = 5, sourceFilters = [], waitForLoad = false } = {}) {
    const maxCount = Math.max(1, Math.min(50, Number(count) || 5));
    const activeFilters = Array.isArray(sourceFilters) ? sourceFilters.filter(Boolean) : [];
    const perPageExtractLimit = activeFilters.length > 0 ? 50 : maxCount;
    let sourceTabId = null;
    let sourceUrl = '';
    let createdSearchTabId = null;

    if (String(query || '').trim()) {
      const builder = SEARCH_ENGINES[engine] || SEARCH_ENGINES.duckduckgo;
      const filteredQuery = applySourceFiltersToQuery(query, activeFilters);
      const targetUrl = builder(filteredQuery);
      const searchTab = await browser.tabs.create({ url: targetUrl, active: false });
      sourceTabId = searchTab.id;
      sourceUrl = targetUrl;
      createdSearchTabId = searchTab.id;
      await waitForTabComplete(searchTab.id, 12000);
      await new Promise(r => setTimeout(r, 450));
    } else {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      const activeTab = tabs && tabs[0];
      if (!activeTab || !activeTab.id || !/^https?:\/\//i.test(activeTab.url || '')) {
        return { ok: false, error: 'Open a web search page (Google, DuckDuckGo, Bing, Scholar) first.' };
      }
      sourceTabId = activeTab.id;
      sourceUrl = activeTab.url || '';
    }

    const collected = [];
    const seen = new Set();
    const addBatch = (batch) => {
      let added = 0;
      for (const item of batch || []) {
        const url = typeof item === 'string' ? item : String((item && item.url) || '');
        const norm = url.split('#')[0];
        if (!norm || seen.has(norm)) continue;
        seen.add(norm);
        if (!matchesSourceFilters(item, activeFilters)) continue;
        collected.push(url);
        added += 1;
        if (collected.length >= maxCount) break;
      }
      return added;
    };

    try {
      addBatch(await extractSearchResultUrlsFromTab(sourceTabId, perPageExtractLimit));

      // If more results are needed (>10 or filtered), paginate in background without disturbing the user's active tab
      if (collected.length < maxCount) {
        const isDdg = /duckduckgo\.com/i.test(sourceUrl);
        if (isDdg) {
          let ddgTabId = createdSearchTabId;
          if (!ddgTabId) {
            const cloneTab = await browser.tabs.create({ url: sourceUrl, active: false });
            ddgTabId = cloneTab.id;
            createdSearchTabId = cloneTab.id;
            await waitForTabComplete(ddgTabId, 12000);
            await new Promise(r => setTimeout(r, 450));
          }
          for (let step = 0; step < 6 && collected.length < maxCount; step++) {
            const clicked = await clickDuckDuckGoMoreResults(ddgTabId);
            if (!clicked) break;
            await new Promise(r => setTimeout(r, 950));
            const batch = await extractSearchResultUrlsFromTab(ddgTabId, perPageExtractLimit);
            addBatch(batch);
            if (!batch || batch.length === 0) break;
          }
        } else {
          for (let pageIdx = 1; pageIdx <= 5 && collected.length < maxCount; pageIdx++) {
            const nextUrl = buildPaginatedSearchUrl(sourceUrl, pageIdx);
            if (!nextUrl) break;
            let pageTabId = null;
            try {
              const pageTab = await browser.tabs.create({ url: nextUrl, active: false });
              pageTabId = pageTab.id;
              await waitForTabComplete(pageTabId, 12000);
              await new Promise(r => setTimeout(r, 350));
              const batch = await extractSearchResultUrlsFromTab(pageTabId, perPageExtractLimit);
              addBatch(batch);
              if (!batch || batch.length === 0) break;
            } finally {
              if (pageTabId) {
                await browser.tabs.remove(pageTabId).catch(() => {});
              }
            }
          }
        }
      }
    } finally {
      if (createdSearchTabId) {
        await browser.tabs.remove(createdSearchTabId).catch(() => {});
      }
    }

    const urls = collected.slice(0, maxCount);
    if (!urls.length) {
      return {
        ok: false,
        error: activeFilters.length > 0
          ? 'No search results matched the selected source filters.'
          : 'No search result links found on the page.'
      };
    }

    const openedTabIds = [];
    for (const url of urls) {
      try {
        const created = await browser.tabs.create({ url, active: false });
        if (created && created.id) openedTabIds.push(created.id);
      } catch (_) {}
    }

    if (waitForLoad && openedTabIds.length > 0) {
      await Promise.all(openedTabIds.map(id => waitForTabComplete(id, 12000)));
    }

    return {
      ok: true,
      openedCount: openedTabIds.length,
      urls,
      tabIds: openedTabIds
    };
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  function inferMimeFromUrl(url) {
    const clean = String(url || '').split(/[?#]/)[0].toLowerCase();
    if (clean.endsWith('.png')) return 'image/png';
    if (clean.endsWith('.jpg') || clean.endsWith('.jpeg')) return 'image/jpeg';
    if (clean.endsWith('.webp')) return 'image/webp';
    if (clean.endsWith('.gif')) return 'image/gif';
    if (clean.endsWith('.pdf')) return 'application/pdf';
    return '';
  }

  const SUPPORTED_MEDIA_MIMES = new Set([
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'image/gif',
    'application/pdf'
  ]);

  /**
   * Fetches an image or PDF URL in extension background context (bypassing page CORS)
   * and returns base64 + normalized MIME type.
   */
  async function fetchBinaryAsBase64(url, maxBytes = 6 * 1024 * 1024) {
    if (!url || !/^https?:\/\//i.test(url)) {
      return { ok: false, error: 'Unsupported media URL protocol.' };
    }
    try {
      const res = await fetch(url);
      if (!res.ok) {
        return { ok: false, error: `Media fetch failed (HTTP ${res.status}).` };
      }
      const headerType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      let mimeType = headerType === 'image/jpg' ? 'image/jpeg' : headerType;
      if (!SUPPORTED_MEDIA_MIMES.has(mimeType)) {
        mimeType = inferMimeFromUrl(url);
      }
      if (!SUPPORTED_MEDIA_MIMES.has(mimeType)) {
        return { ok: false, error: `Unsupported media format (${headerType || 'unknown'}).` };
      }

      const buf = await res.arrayBuffer();
      if (buf.byteLength === 0) {
        return { ok: false, error: 'Empty media file.' };
      }
      if (buf.byteLength > maxBytes) {
        return { ok: false, error: `Media exceeds ${(maxBytes / (1024 * 1024)).toFixed(0)} MB limit.` };
      }

      return {
        ok: true,
        mimeType: mimeType === 'image/jpg' ? 'image/jpeg' : mimeType,
        base64Data: arrayBufferToBase64(buf)
      };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : 'Failed to fetch media.' };
    }
  }

  function buildFallbackTabMetadata(tab) {
    const rawUrl = (tab && tab.url) || '';
    let domain = 'web';
    try {
      domain = new URL(rawUrl).hostname.replace(/^www\./, '');
    } catch (_) {}
    return {
      url: rawUrl,
      canonicalUrl: rawUrl.split('#')[0],
      domain,
      title: (tab && tab.title) || domain,
      author: '',
      publishedDate: '',
      siteName: domain,
      description: '',
      license: 'Public web content (verify site terms)',
      language: '',
      schemaType: ''
    };
  }

  async function processVisualCandidatesWithAi(tab, candidates, metadata, options = {}) {
    const state = await root.StorageManager.loadState();
    const creds = await root.StorageManager.getGeminiSettings();
    const isOllama = creds.aiProvider === 'ollama' || options.aiProvider === 'ollama';
    const apiKey = options.apiKey || creds.apiKey || state.geminiApiKey || '';
    const model = options.model || creds.model || state.geminiModel || root.GeminiClient.DEFAULT_MODEL;
    if (!isOllama && !apiKey) {
      return { ok: false, error: 'AI API key missing. Configure an API key or Local Ollama in Settings to use Visual OCR.' };
    }
    const authPayload = isOllama
      ? {
          aiProvider: 'ollama',
          ollamaUrl: options.ollamaUrl || creds.ollamaUrl,
          ollamaModel: creds.ollamaModel,
          ollamaVisionModel: options.ollamaVisionModel || creds.ollamaVisionModel
        }
      : apiKey;

    const activeProj = state.projects.find(p => p.id === (options.projectId || state.activeProjectId)) || state.projects[0];
    const expressions = typeof options.expressions === 'string'
      ? options.expressions
      : ((activeProj && activeProj.expressions) || '');
    const researchContext = (activeProj && activeProj.aiPrompt) || '';
    const minScore = typeof options.minScore === 'number' ? options.minScore : 10;
    const filterByExpressions = Boolean(options.filterByExpressions && expressions.trim());
    const explicitSingle = Boolean(options.explicitSingle);

    const matchedItems = [];
    const highlightEntries = [];
    const errors = [];
    const CONCURRENCY = 2;
    const now = new Date().toISOString();
    const stamp = Date.now().toString(36);
    const sourceMeta = metadata || buildFallbackTabMetadata(tab);

    for (let i = 0; i < candidates.length; i += CONCURRENCY) {
      const batch = candidates.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(batch.map(async (cand, bIdx) => {
        let base64Data = cand.base64Data || '';
        let mimeType = cand.mimeType || '';

        if (!base64Data && cand.imageUrl) {
          const fetched = await fetchBinaryAsBase64(cand.imageUrl);
          if (!fetched.ok) {
            return { ok: false, error: fetched.error };
          }
          base64Data = fetched.base64Data;
          mimeType = fetched.mimeType;
        }

        if (!base64Data) {
          return { ok: false, error: 'Unable to load visual bytes.' };
        }

        const aiRes = await root.GeminiClient.analyzeVisualMedia({
          base64Data,
          mimeType,
          expressions,
          researchContext,
          altText: cand.altText,
          captionText: cand.captionText,
          pageTitle: sourceMeta.title
        }, authPayload, model);

        if (!aiRes || !aiRes.ok || !aiRes.result) {
          return { ok: false, error: (aiRes && aiRes.error) || 'AI OCR failed.' };
        }

        const parsed = aiRes.result;
        if (!explicitSingle && parsed.hasMeaningfulContent === false) {
          return { ok: true, skipped: true };
        }

        const parts = [];
        if (parsed.ocrText) parts.push(parsed.ocrText);
        if (parsed.visualSummary && (!parsed.ocrText || !parsed.ocrText.includes(parsed.visualSummary))) {
          parts.push(`Visual summary: ${parsed.visualSummary}`);
        }
        const combinedText = parts.join('\n\n').trim();
        if (!combinedText) {
          return { ok: true, skipped: true };
        }

        const heading = parsed.title || cand.captionText || cand.heading || sourceMeta.title || 'Visual Extract';
        let evalRes = { matched: false, score: 0, matchedExpressions: [], matchedTerms: [] };
        if (expressions.trim()) {
          evalRes = root.ExpressionEngine.evaluateBlock(combinedText, heading, expressions);
        }

        if (filterByExpressions && (!evalRes.matched || evalRes.score < minScore)) {
          return { ok: true, skipped: true };
        }

        const mergedTerms = Array.from(new Set([...(evalRes.matchedTerms || []), ...(parsed.detectedTerms || [])])).slice(0, 12);
        const blockType = mimeType === 'application/pdf'
          ? 'pdf-ocr'
          : (cand.kind === 'svg' ? 'svg-ocr' : (cand.kind === 'canvas' ? 'canvas-ocr' : 'image-ocr'));

        const extractItem = {
          localId: `vis_${stamp}_${i + bIdx}`,
          text: combinedText,
          heading,
          blockType,
          score: evalRes.matched ? Math.max(evalRes.score, 65) : 78,
          matchedExpressions: evalRes.matched ? evalRes.matchedExpressions : ['AI Visual OCR'],
          matchedTerms: mergedTerms,
          tags: [blockType],
          media: {
            kind: cand.kind || (mimeType === 'application/pdf' ? 'pdf' : 'image'),
            url: cand.imageUrl || sourceMeta.url,
            alt: cand.altText || '',
            caption: cand.captionText || '',
            width: cand.width || 0,
            height: cand.height || 0,
            ocr: true
          },
          extractedAt: now,
          source: sourceMeta
        };

        return { ok: true, extractItem, candidateId: cand.candidateId };
      }));

      for (const r of batchResults) {
        if (!r.ok) {
          if (r.error) errors.push(r.error);
        } else if (r.extractItem) {
          matchedItems.push(r.extractItem);
          if (r.candidateId) {
            highlightEntries.push({
              candidateId: r.candidateId,
              extractItem: r.extractItem,
              saved: true
            });
          }
        }
      }
    }

    let saveStats = null;
    if (matchedItems.length > 0 && options.autoSave !== false) {
      saveStats = await root.StorageManager.addExtractedItems(matchedItems, activeProj.id);
      await updateBadge();
      notifyViews({
        type: 'STATE_UPDATED',
        reason: 'visual_ocr_saved',
        addedCount: saveStats.addedCount,
        updatedCount: saveStats.updatedCount
      });
    }

    if (tab && tab.id && highlightEntries.length > 0 && options.highlight !== false) {
      browser.tabs.sendMessage(tab.id, {
        type: 'HIGHLIGHT_VISUAL_CANDIDATES',
        items: highlightEntries
      }).catch(() => {});
    }

    if (matchedItems.length === 0 && errors.length > 0) {
      return { ok: false, error: errors[0], scannedCount: candidates.length };
    }

    return {
      ok: true,
      scannedCount: candidates.length,
      matchedCount: matchedItems.length,
      matches: matchedItems,
      saveStats,
      warnings: errors
    };
  }

  async function scanTabVisualsAi(tab, options = {}) {
    if (!tab || !tab.id) {
      return { ok: false, error: 'No active tab found.' };
    }

    const ready = await ensureContentScript(tab.id);
    if (ready) {
      try {
        const collected = await browser.tabs.sendMessage(tab.id, {
          type: 'COLLECT_VISUAL_CANDIDATES',
          maxItems: options.maxItems || 5,
          targetSrcUrl: options.targetSrcUrl || ''
        });
        if (collected && collected.ok && Array.isArray(collected.candidates) && collected.candidates.length > 0) {
          return processVisualCandidatesWithAi(tab, collected.candidates, collected.metadata, options);
        }
      } catch (_) {}
    }

    // Fallback: direct image or PDF open in browser tab (or direct targetSrcUrl)
    const directUrl = options.targetSrcUrl || tab.url || '';
    const mimeHint = inferMimeFromUrl(directUrl);
    if (directUrl && /^https?:\/\//i.test(directUrl) && mimeHint) {
      return processVisualCandidatesWithAi(
        tab,
        [{
          candidateId: '',
          kind: mimeHint === 'application/pdf' ? 'pdf' : 'image',
          imageUrl: directUrl,
          altText: '',
          captionText: '',
          heading: tab.title || directUrl
        }],
        buildFallbackTabMetadata(tab),
        options
      );
    }

    return { ok: true, scannedCount: 0, matchedCount: 0, matches: [] };
  }

  // Configure Context Menus
  function setupContextMenus() {
    if (!browser.contextMenus) return;
    browser.contextMenus.removeAll().then(() => {
      browser.contextMenus.create({
        id: 'defrost-save-selection',
        title: 'Save selection to active Defrost dossier',
        contexts: ['selection']
      });
      browser.contextMenus.create({
        id: 'defrost-ocr-image',
        title: 'Extract text & chart data with Defrost AI (OCR)',
        contexts: ['image']
      });
      browser.contextMenus.create({
        id: 'defrost-scan-page',
        title: 'Scan page with Defrost expressions',
        contexts: ['page']
      });
    }).catch(() => {});
  }

  if (typeof browser !== 'undefined' && browser.contextMenus && browser.contextMenus.onClicked) {
    browser.contextMenus.onClicked.addListener(async (info, tab) => {
      if (!tab || !tab.id) return;

      if (info.menuItemId === 'defrost-save-selection' || info.menuItemId === 'lexiscrape-save-selection') {
        await ensureContentScript(tab.id);
        try {
          const res = await browser.tabs.sendMessage(tab.id, { type: 'GET_SELECTION_EXTRACT' });
          if (res && res.ok && res.item) {
            await root.StorageManager.addExtractedItems([res.item]);
            await updateBadge();
            notifyViews({ type: 'STATE_UPDATED', reason: 'context_selection_saved' });
          }
        } catch (_) {}
      } else if (info.menuItemId === 'defrost-ocr-image') {
        const targetUrl = info.srcUrl || '';
        if (!targetUrl) return;
        notifyViews({ type: 'OCR_NOTIFICATION', message: 'Analyzing selected image with AI OCR...' });
        const ocrRes = await scanTabVisualsAi(tab, {
          targetSrcUrl: targetUrl,
          explicitSingle: true,
          filterByExpressions: false,
          autoSave: true,
          highlight: true
        });
        if (ocrRes && ocrRes.ok && ocrRes.matchedCount > 0) {
          notifyViews({ type: 'OCR_NOTIFICATION', message: 'Image OCR saved to active dossier.' });
        } else {
          notifyViews({
            type: 'OCR_NOTIFICATION',
            isError: true,
            message: (ocrRes && ocrRes.error) || 'Could not extract text from selected image.'
          });
        }
      } else if (info.menuItemId === 'defrost-scan-page' || info.menuItemId === 'lexiscrape-scan-page') {
        const proj = await root.StorageManager.getActiveProject();
        if (proj && proj.expressions) {
          await scanTab(tab.id, proj.expressions, { highlight: true, autoSave: true, projectId: proj.id });
        }
      }
    });
  }

  // Router dei messaggi runtime
  if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.onMessage) {
    browser.runtime.onMessage.addListener((msg, _sender) => {
      if (!msg || !msg.type) return false;

      if (msg.type === 'SAVE_SINGLE_EXTRACT') {
        return root.StorageManager.addExtractedItems([msg.item], msg.projectId).then(async (stats) => {
          await updateBadge();
          notifyViews({ type: 'STATE_UPDATED', reason: 'single_extract_saved' });
          return { ok: true, stats };
        });
      }

      if (msg.type === 'SAVE_MULTIPLE_EXTRACTS') {
        return root.StorageManager.addExtractedItems(msg.items || [], msg.projectId).then(async (stats) => {
          await updateBadge();
          notifyViews({ type: 'STATE_UPDATED', reason: 'multiple_extracts_saved' });
          return { ok: true, stats };
        });
      }

      if (msg.type === 'SCAN_ACTIVE_TAB') {
        return browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
          const activeTab = tabs && tabs[0];
          if (!activeTab || !activeTab.id) {
            return { ok: false, error: 'Nessuna scheda attiva trovata.' };
          }
          return scanTab(activeTab.id, msg.expressions || '', {
            highlight: msg.highlight !== false,
            minScore: msg.minScore || 10,
            autoSave: Boolean(msg.autoSave),
            projectId: msg.projectId
          });
        });
      }

      if (msg.type === 'TOGGLE_CONTINUOUS_SCAN_ACTIVE_TAB') {
        return browser.tabs.query({ active: true, currentWindow: true }).then(async (tabs) => {
          const activeTab = tabs && tabs[0];
          if (!activeTab || !activeTab.id) return { ok: false, error: 'Nessuna scheda attiva.' };

          let statusRes = await browser.tabs.sendMessage(activeTab.id, { type: 'GET_CONTINUOUS_STATUS' }).catch(() => null);
          if (!statusRes || !statusRes.ok) {
            const ready = await ensureContentScript(activeTab.id);
            if (!ready) {
              return { ok: false, error: 'Unable to access this page (browser-protected or unsupported tab).' };
            }
            statusRes = await browser.tabs.sendMessage(activeTab.id, { type: 'GET_CONTINUOUS_STATUS' }).catch(() => null);
          }
          const isCurrentlyActive = statusRes && statusRes.active;

          if (isCurrentlyActive) {
            const stopRes = await browser.tabs.sendMessage(activeTab.id, { type: 'STOP_CONTINUOUS_SCAN' });
            return { ok: true, active: false };
          } else {
            const state = await root.StorageManager.loadState();
            const includeVisuals = typeof msg.includeVisuals === 'boolean'
              ? msg.includeVisuals
              : (!state.settings || state.settings.includeLocalVisuals !== false);
            const autoAiOcr = typeof msg.autoAiOcr === 'boolean'
              ? msg.autoAiOcr
              : Boolean(state.settings && state.settings.autoAiOcr);

            const startRes = await browser.tabs.sendMessage(activeTab.id, {
              type: 'START_CONTINUOUS_SCAN',
              expressions: msg.expressions || '',
              highlight: msg.highlight !== false,
              minScore: msg.minScore || 10,
              includeVisuals,
              targetElements: msg.targetElements,
              autoSave: msg.autoSave !== false,
              projectId: msg.projectId
            });

            const hasLocalOllama = state.settings && state.settings.aiProvider === 'ollama';
            if (autoAiOcr && (state.geminiApiKey || hasLocalOllama)) {
              scanTabVisualsAi(activeTab, {
                expressions: msg.expressions || '',
                projectId: msg.projectId,
                filterByExpressions: Boolean((msg.expressions || '').trim()),
                autoSave: msg.autoSave !== false,
                highlight: msg.highlight !== false,
                maxItems: 4
              }).catch(() => {});
            }

            return { ok: true, active: true, ...startRes };
          }
        });
      }

      if (msg.type === 'GET_ACTIVE_TAB_CONTINUOUS_STATUS') {
        return browser.tabs.query({ active: true, currentWindow: true }).then(async (tabs) => {
          const activeTab = tabs && tabs[0];
          if (!activeTab || !activeTab.id) return { ok: false, active: false };
          try {
            const statusRes = await browser.tabs.sendMessage(activeTab.id, { type: 'GET_CONTINUOUS_STATUS' });
            return statusRes || { ok: false, active: false };
          } catch (_) {
            return { ok: false, active: false };
          }
        });
      }

      if (msg.type === 'TEST_GEMINI_API_KEY') {
        return root.StorageManager.getGeminiSettings().then(async (saved) => {
          if (msg.aiProvider === 'ollama' || (!msg.apiKey && saved.aiProvider === 'ollama')) {
            return root.GeminiClient.testConnection({
              aiProvider: 'ollama',
              ollamaUrl: msg.ollamaUrl || saved.ollamaUrl,
              ollamaModel: msg.ollamaModel || saved.ollamaModel
            });
          }
          const keyToUse = msg.apiKey || saved.apiKey || '';
          const modelToUse = msg.model || saved.model || root.GeminiClient.DEFAULT_MODEL;
          const res = await root.GeminiClient.testConnection(keyToUse, modelToUse);
          if (res && res.ok && keyToUse) {
            await root.StorageManager.saveGeminiSettings({
              apiKey: keyToUse,
              model: res.resolvedModel || modelToUse
            });
          }
          return res;
        });
      }

      if (msg.type === 'ANALYZE_RESEARCH_PROMPT_WITH_GEMINI') {
        return root.StorageManager.getGeminiSettings().then(async (saved) => {
          if (msg.aiProvider === 'ollama' || (!msg.apiKey && saved.aiProvider === 'ollama')) {
            return root.GeminiClient.interpretResearchPrompt(msg.prompt, {
              aiProvider: 'ollama',
              ollamaUrl: msg.ollamaUrl || saved.ollamaUrl,
              ollamaModel: msg.ollamaModel || saved.ollamaModel
            });
          }
          const keyToUse = msg.apiKey || saved.apiKey || '';
          const modelToUse = msg.model || saved.model || root.GeminiClient.DEFAULT_MODEL;
          if (msg.apiKey && msg.apiKey !== saved.apiKey) {
            await root.StorageManager.saveGeminiSettings({ apiKey: msg.apiKey, model: modelToUse });
          }
          return root.GeminiClient.interpretResearchPrompt(msg.prompt, keyToUse, modelToUse);
        });
      }

      if (msg.type === 'CONTINUOUS_NEW_MATCHES') {
        return root.StorageManager.addExtractedItems(msg.matches || [], msg.projectId).then(async (stats) => {
          await updateBadge();
          notifyViews({
            type: 'STATE_UPDATED',
            reason: 'continuous_matches_added',
            newMatches: msg.matches,
            totalSoFar: msg.totalSoFar,
            stats
          });
          return { ok: true, stats };
        });
      }

      if (msg.type === 'SCAN_ALL_OPEN_TABS') {
        return scanAllOpenTabs(msg.expressions || '', {
          highlight: msg.highlight !== false,
          minScore: msg.minScore || 10,
          includeVisuals: msg.includeVisuals,
          autoSave: msg.autoSave !== false,
          projectId: msg.projectId
        });
      }

      if (msg.type === 'SCAN_PAGE_VISUALS_AI') {
        return browser.tabs.query({ active: true, currentWindow: true }).then(async (tabs) => {
          const activeTab = tabs && tabs[0];
          if (!activeTab || !activeTab.id) {
            return { ok: false, error: 'No active tab found.' };
          }
          return scanTabVisualsAi(activeTab, {
            expressions: msg.expressions || '',
            projectId: msg.projectId,
            maxItems: msg.maxItems || 5,
            filterByExpressions: Boolean(msg.filterByExpressions),
            autoSave: msg.autoSave !== false,
            highlight: msg.highlight !== false
          });
        });
      }

      if (msg.type === 'CLIP_ACTIVE_SELECTION') {
        return browser.tabs.query({ active: true, currentWindow: true }).then(async (tabs) => {
          const activeTab = tabs && tabs[0];
          if (!activeTab || !activeTab.id) return { ok: false, error: 'Nessuna scheda attiva.' };
          await ensureContentScript(activeTab.id);
          const res = await browser.tabs.sendMessage(activeTab.id, {
            type: 'GET_SELECTION_EXTRACT',
            note: msg.note || ''
          });
          if (res && res.ok && res.item) {
            const stats = await root.StorageManager.addExtractedItems([res.item], msg.projectId);
            await updateBadge();
            notifyViews({ type: 'STATE_UPDATED', reason: 'selection_clipped' });
            return { ok: true, item: res.item, stats };
          }
          return { ok: false, error: 'Seleziona prima del testo nella pagina web attiva.' };
        });
      }

      if (msg.type === 'CLEAR_ACTIVE_HIGHLIGHTS') {
        return browser.tabs.query({ active: true, currentWindow: true }).then(async (tabs) => {
          const activeTab = tabs && tabs[0];
          if (activeTab && activeTab.id) {
            await browser.tabs.sendMessage(activeTab.id, { type: 'CLEAR_HIGHLIGHTS' }).catch(() => {});
          }
          return { ok: true };
        });
      }

      if (msg.type === 'LAUNCH_GUIDED_SEARCH') {
        return launchGuidedSearch(msg.query, msg.engine);
      }

      if (msg.type === 'OPEN_TOP_SEARCH_RESULTS') {
        return openTopSearchResults(msg);
      }

      if (msg.type === 'REFRESH_BADGE') {
        return updateBadge().then(() => ({ ok: true }));
      }

      return false;
    });
  }

  if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.onInstalled) {
    browser.runtime.onInstalled.addListener(() => {
      setupContextMenus();
      updateBadge();
    });
  }

  setupContextMenus();
  updateBadge();
})(typeof globalThis !== 'undefined' ? globalThis : window);
