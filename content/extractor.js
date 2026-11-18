/**
 * LexiScrape Content Script — Semantic DOM & Metadata Extractor
 * Opera esclusivamente su contenuti pubblici visibili nel DOM della pagina.
 * Estrae metadati completi (OpenGraph, Schema.org JSON-LD, autore, data, licenza)
 * e blocchi semantici contestuali associati ai rispettivi titoli di sezione.
 */
(function (root) {
  'use strict';

  if (root.__lexiScrapeContentInitialized) return;
  root.__lexiScrapeContentInitialized = true;

  const NOISE_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'SVG', 'CANVAS', 'VIDEO', 'AUDIO',
    'NAV', 'FOOTER', 'HEADER', 'ASIDE', 'FORM', 'BUTTON', 'INPUT', 'SELECT',
    'TEXTAREA', 'DIALOG', 'MENU', 'TEMPLATE'
  ]);

  const NOISE_ROLE_OR_CLASS_RE = /\b(nav|navbar|navigation|menu|footer|sidebar|cookie|consent|gdpr|banner|popup|modal|advert|ads|ad-slot|promo|share|social|breadcrumb|pagination|toolbar|lexiscrape)\b/i;

  // Mappa per ritrovare i nodi DOM evidenziati nella pagina corrente
  const highlightedNodesMap = new Map();
  // Temporary map of visual DOM nodes offered for AI OCR so matches can be highlighted back
  const visualCandidateNodes = new Map();

  // Stato per la Scansione Continua (Live Infinite Scan)
  let continuousState = {
    active: false,
    expressions: '',
    options: {},
    observer: null,
    scrollListener: null,
    debounceTimer: null,
    idleCallbackId: null,
    firstPendingAt: 0,
    seenFingerprints: new Set(),
    matchedCount: 0
  };

  function getMetaContent(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const val = el.getAttribute('content') || el.getAttribute('datetime') || el.textContent;
        if (val && val.trim()) return val.trim();
      }
    }
    return '';
  }

  /**
   * Estrae eventuali metadati strutturati da blocchi JSON-LD (Schema.org)
   */
  function extractJsonLdMetadata() {
    const info = { author: '', publishedDate: '', license: '', schemaType: '' };
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      try {
        const parsed = JSON.parse(script.textContent || '{}');
        const candidates = Array.isArray(parsed)
          ? parsed
          : (parsed['@graph'] && Array.isArray(parsed['@graph']) ? parsed['@graph'] : [parsed]);

        for (const item of candidates) {
          if (!item || typeof item !== 'object') continue;
          if (!info.schemaType && item['@type']) {
            info.schemaType = Array.isArray(item['@type']) ? item['@type'].join(', ') : String(item['@type']);
          }
          if (!info.author && item.author) {
            if (typeof item.author === 'string') {
              info.author = item.author;
            } else if (Array.isArray(item.author)) {
              info.author = item.author.map(a => (typeof a === 'string' ? a : a.name)).filter(Boolean).join(', ');
            } else if (item.author.name) {
              info.author = item.author.name;
            }
          }
          if (!info.publishedDate && (item.datePublished || item.dateCreated)) {
            info.publishedDate = String(item.datePublished || item.dateCreated).slice(0, 10);
          }
          if (!info.license && item.license) {
            info.license = typeof item.license === 'string' ? item.license : (item.license.name || '');
          }
        }
      } catch (_) {
        // Ignora JSON-LD malformato
      }
    }
    return info;
  }

  /**
   * Rileva la licenza d'uso dichiarata nella pagina (Creative Commons, rel="license", copyright)
   */
  function detectPageLicense(jsonLdLicense) {
    if (jsonLdLicense) return jsonLdLicense;

    const licenseLink = document.querySelector(
      'a[rel~="license"], a[href*="creativecommons.org/licenses/"], a[href*="creativecommons.org/publicdomain/"]'
    );
    if (licenseLink) {
      const href = licenseLink.getAttribute('href') || '';
      const text = (licenseLink.textContent || '').replace(/\s+/g, ' ').trim();
      const ccMatch = href.match(/creativecommons\.org\/(?:licenses|publicdomain)\/([^/]+)\/([^/]+)/i);
      if (ccMatch) {
        return `Creative Commons CC ${ccMatch[1].toUpperCase()} ${ccMatch[2]}`;
      }
      return text ? `${text} (${href})` : href;
    }

    const metaRights = getMetaContent([
      'meta[name="dcterms.rights"]',
      'meta[name="dc.rights"]',
      'meta[name="copyright"]',
      'meta[name="rights"]'
    ]);
    if (metaRights) return metaRights.slice(0, 120);

    return 'Uso citazione / ricerca (verifica termini del sito)';
  }

  /**
   * Estrae tutti i metadati descrittivi e di attribuzione della pagina corrente
   */
  function extractPageMetadata() {
    const jsonLd = extractJsonLdMetadata();

    const canonicalEl = document.querySelector('link[rel="canonical"]');
    const canonicalUrl = (canonicalEl && canonicalEl.href) ? canonicalEl.href : window.location.href.split('#')[0];

    let domain = 'locale';
    try {
      domain = new URL(canonicalUrl).hostname.replace(/^www\./, '');
    } catch (_) {}

    const title = getMetaContent([
      'meta[property="og:title"]',
      'meta[name="twitter:title"]'
    ]) || document.title || domain;

    const author = jsonLd.author || getMetaContent([
      'meta[name="author"]',
      'meta[property="article:author"]',
      'meta[name="dc.creator"]',
      'meta[name="dcterms.creator"]',
      '[rel="author"]',
      '.author-name',
      '.byline'
    ]);

    const rawDate = jsonLd.publishedDate || getMetaContent([
      'meta[property="article:published_time"]',
      'meta[name="publication_date"]',
      'meta[name="date"]',
      'meta[name="dc.date"]',
      'time[datetime]'
    ]);
    const publishedDate = rawDate ? rawDate.slice(0, 10) : '';

    const siteName = getMetaContent([
      'meta[property="og:site_name"]',
      'meta[name="application-name"]'
    ]) || domain;

    const description = getMetaContent([
      'meta[name="description"]',
      'meta[property="og:description"]'
    ]);

    const license = detectPageLicense(jsonLd.license);
    const language = document.documentElement.lang || getMetaContent(['meta[http-equiv="content-language"]']) || '';

    return {
      url: window.location.href,
      canonicalUrl,
      domain,
      title: title.replace(/\s+/g, ' ').trim(),
      author: author.replace(/\s+/g, ' ').trim().slice(0, 100),
      publishedDate,
      siteName: siteName.replace(/\s+/g, ' ').trim(),
      description: description.replace(/\s+/g, ' ').trim().slice(0, 300),
      license,
      language,
      schemaType: jsonLd.schemaType
    };
  }

  function isElementVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.hidden || el.getAttribute('aria-hidden') === 'true') return false;
    // Native, browser-optimized visibility check (accounts for hidden ancestors too)
    if (typeof el.checkVisibility === 'function') {
      return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    }
    // Fallback: elements with display:none (or inside one) have no layout boxes
    if (el.getClientRects().length === 0) return false;
    const style = window.getComputedStyle(el);
    return style.visibility !== 'hidden' && parseFloat(style.opacity) !== 0;
  }

  function isNoiseElement(el) {
    if (!el || el.nodeType !== 1) return true;
    if (NOISE_TAGS.has(el.tagName)) return true;
    if (el.classList && el.classList.contains('lexiscrape-badge-bar')) return true;

    const role = el.getAttribute('role') || '';
    if (/^(navigation|banner|contentinfo|complementary|search|dialog|menu)$/i.test(role)) {
      return true;
    }

    const idAndClass = `${el.id || ''} ${typeof el.className === 'string' ? el.className : ''}`;
    if (NOISE_ROLE_OR_CLASS_RE.test(idAndClass) && !/^(MAIN|ARTICLE|BODY)$/i.test(el.tagName)) {
      return true;
    }
    return false;
  }

  /**
   * Pulisce il testo estratto da un nodo ignorando i badge di LexiScrape
   */
  const STRIP_SELECTOR = '.lexiscrape-badge-bar, script, style, noscript, sup.reference';

  function getCleanNodeText(node) {
    if (!node) return '';

    // Fast path: plain text blocks need no cloning
    const needsStrip = node.querySelector(STRIP_SELECTOR) !== null;
    if (!needsStrip && node.tagName !== 'TABLE' && node.tagName !== 'UL' && node.tagName !== 'OL') {
      return (node.textContent || '').replace(/\s+/g, ' ').trim();
    }

    const clone = needsStrip ? node.cloneNode(true) : node;
    if (needsStrip) {
      clone.querySelectorAll(STRIP_SELECTOR).forEach(b => b.remove());
    }

    if (clone.tagName === 'TABLE') {
      const rows = Array.from(clone.querySelectorAll('tr'));
      return rows
        .map(r => Array.from(r.querySelectorAll('th, td')).map(c => c.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' | '))
        .filter(Boolean)
        .join('\n');
    }

    if (clone.tagName === 'UL' || clone.tagName === 'OL') {
      const items = Array.from(clone.querySelectorAll(':scope > li'));
      return items
        .map(li => `• ${li.textContent.replace(/\s+/g, ' ').trim()}`)
        .filter(line => line.length > 3)
        .join('\n');
    }

    return (clone.textContent || '').replace(/\s+/g, ' ').trim();
  }

  /**
   * Scansiona il DOM alla ricerca di blocchi semantici significativi (paragrafi,
   * citazioni, elenchi, tabelle, sezioni) mantenendo traccia dell'ultimo titolo (h1-h6).
   */
  function extractSemanticBlocks(rootNode = document.body, opts = {}) {
    if (!rootNode) return [];
    // Continuous scan: remembers each evaluated element and its text length, so unchanged
    // elements are skipped cheaply while elements whose text grew are re-evaluated.
    const seenMap = opts.seenMap || null;
    const isUnchanged = (el, rawLen) => seenMap !== null && seenMap.get(el) === rawLen;
    const targetSet = Array.isArray(opts.targetElements) && opts.targetElements.length > 0
      ? new Set(opts.targetElements)
      : null;
    const allowParagraphs = !targetSet || targetSet.has('paragraphs');
    const allowQuotes = !targetSet || targetSet.has('quotes_comments') || targetSet.has('quotes') || targetSet.has('comments');
    const allowTables = !targetSet || targetSet.has('tables');
    const allowLists = !targetSet || targetSet.has('lists');
    const allowVisuals = (opts.includeVisuals !== false) && (!targetSet || targetSet.has('visuals') || targetSet.has('charts'));
    let candidateCount = 0;

    // Preferisci <main> o <article> se presenti e ricchi di testo, altrimenti <body>
    const mainCandidate = document.querySelector('main, [role="main"], article');
    const startRoot = (mainCandidate && (mainCandidate.textContent || '').length > 250)
      ? mainCandidate
      : rootNode;

    const blocks = [];
    const seenTexts = new Set();
    let currentHeading = document.title || '';

    // Only structural noise is filtered while walking (no style/layout queries);
    // visibility is checked lazily on candidate blocks only.
    const walker = document.createTreeWalker(
      startRoot,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode(el) {
          return isNoiseElement(el) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let node = walker.currentNode;
    while (node) {
      const tag = node.tagName;

      if (tag.length === 2 && tag[0] === 'H' && tag[1] >= '1' && tag[1] <= '6') {
        const hText = (node.textContent || '').replace(/\s+/g, ' ').trim();
        if (hText.length >= 2 && hText.length <= 180 && isElementVisible(node)) {
          currentHeading = hText;
        }
      } else if (
        ((tag === 'P' || tag === 'PRE') && allowParagraphs) ||
        (tag === 'BLOCKQUOTE' && allowQuotes) ||
        ((tag === 'TABLE' || tag === 'DD') && allowTables) ||
        ((tag === 'UL' || tag === 'OL') && allowLists)
      ) {
        // Cheap length pre-check before any expensive work
        const rawLen = (node.textContent || '').length;
        if (rawLen >= 35) candidateCount++;
        if (rawLen >= 35 && !isUnchanged(node, rawLen)) {
          // Evita di estrarre due volte una lista/tabella annidata in un altro blocco già catturato
          const parentBlock = node.parentElement && node.parentElement.closest('blockquote, table, ul, ol, p');
          if (!parentBlock && isElementVisible(node)) {
            if (seenMap) seenMap.set(node, rawLen);
            const text = getCleanNodeText(node);
            // Considera solo blocchi con contenuto informativo sufficiente (>= 35 caratteri)
            if (text.length >= 35 && text.length <= 4500) {
              const normKey = text.toLowerCase().slice(0, 220);
              if (!seenTexts.has(normKey)) {
                seenTexts.add(normKey);
                blocks.push({
                  element: node,
                  text,
                  heading: currentHeading,
                  blockType: tag.toLowerCase()
                });
              }
            }
          }
        }
      }

      node = walker.nextNode();
    }

    // Fallback se la pagina usa <div> invece di <p> per il testo
    if (candidateCount < 3) {
      const divs = startRoot.querySelectorAll('div, section, article');
      for (const div of divs) {
        const rawLen = (div.textContent || '').length;
        if (rawLen < 45 || rawLen > 6000 || isUnchanged(div, rawLen)) continue;
        // Prendi solo div "foglia" di testo (senza grandi blocchi figli)
        if (div.querySelector('div, p, section, article, table, ul, ol')) continue;
        if (isNoiseElement(div) || !isElementVisible(div)) continue;
        if (seenMap) seenMap.set(div, rawLen);
        const text = getCleanNodeText(div);
        if (text.length >= 45 && text.length <= 2500) {
          const normKey = text.toLowerCase().slice(0, 220);
          if (!seenTexts.has(normKey)) {
            seenTexts.add(normKey);
            blocks.push({
              element: div,
              text,
              heading: currentHeading,
              blockType: 'section'
            });
          }
        }
      }
    }

    if (allowVisuals) {
      extractVisualBlocks(startRoot, opts, seenTexts, blocks);
    }

    return blocks;
  }

  function hasNoiseAncestor(el, stopAt) {
    let cur = el.parentElement;
    while (cur && cur !== stopAt && cur !== document.body) {
      if (isNoiseElement(cur)) return true;
      cur = cur.parentElement;
    }
    return false;
  }

  function findNearestHeading(el) {
    if (!el) return document.title || '';
    const fig = el.closest && el.closest('figure');
    if (fig) {
      const cap = fig.querySelector('figcaption');
      if (cap) {
        const capText = (cap.textContent || '').replace(/\s+/g, ' ').trim();
        if (capText) return capText.slice(0, 140);
      }
    }
    const section = el.closest && el.closest('section, article, main');
    if (section) {
      const h = section.querySelector('h1, h2, h3, h4');
      if (h) {
        const hText = (h.textContent || '').replace(/\s+/g, ' ').trim();
        if (hText) return hText.slice(0, 140);
      }
    }
    return document.title || '';
  }

  function extractSvgReadableText(svg) {
    if (!svg) return '';
    const parts = [];
    const aria = (svg.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
    if (aria) parts.push(aria);

    const textEls = svg.querySelectorAll('title, desc, text');
    const maxNodes = Math.min(textEls.length, 120);
    let prev = '';
    for (let i = 0; i < maxNodes; i++) {
      const t = (textEls[i].textContent || '').replace(/\s+/g, ' ').trim();
      if (t.length >= 2 && t !== prev) {
        parts.push(t);
        prev = t;
      }
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  function extractVisualBlocks(startRoot, opts, seenTexts, blocks) {
    const seenMap = opts.seenMap || null;
    const processedMedia = new Set();

    const addVisualCandidate = (targetEl, text, blockType, mediaMeta, sigKey) => {
      const clean = String(text || '').replace(/\s+/g, ' ').trim();
      if (clean.length < 20 || clean.length > 3500) return;
      if (seenMap && seenMap.get(targetEl) === sigKey) return;
      const normKey = clean.toLowerCase().slice(0, 220);
      if (seenTexts.has(normKey)) return;
      if (seenMap) seenMap.set(targetEl, sigKey);
      seenTexts.add(normKey);
      blocks.push({
        element: targetEl,
        text: clean,
        heading: findNearestHeading(targetEl),
        blockType,
        media: mediaMeta
      });
    };

    // 1. Figures (capturing figcaption + inner img/svg/canvas together cleanly)
    const figures = startRoot.querySelectorAll('figure');
    for (const fig of figures) {
      if (hasNoiseAncestor(fig, startRoot) || !isElementVisible(fig)) continue;
      const capEl = fig.querySelector('figcaption');
      const caption = capEl ? (capEl.textContent || '').replace(/\s+/g, ' ').trim() : '';
      const img = fig.querySelector('img');
      const svg = fig.querySelector('svg');
      const canvas = fig.querySelector('canvas');

      if (img) processedMedia.add(img);
      if (svg) processedMedia.add(svg);
      if (canvas) processedMedia.add(canvas);

      const pieces = [];
      let blockType = 'image';
      let mediaMeta = null;

      if (caption) pieces.push(caption);
      if (img) {
        const alt = (img.getAttribute('alt') || img.getAttribute('aria-label') || img.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
        if (alt && !caption.toLowerCase().includes(alt.toLowerCase())) pieces.push(alt);
        const rect = img.getBoundingClientRect();
        mediaMeta = {
          kind: 'image',
          url: img.currentSrc || img.src || '',
          alt,
          caption,
          width: Math.round(rect.width || img.naturalWidth || 0),
          height: Math.round(rect.height || img.naturalHeight || 0)
        };
      } else if (svg) {
        blockType = 'svg';
        const svgText = extractSvgReadableText(svg);
        if (svgText) pieces.push(svgText);
        const rect = svg.getBoundingClientRect();
        mediaMeta = {
          kind: 'svg',
          url: window.location.href,
          caption,
          width: Math.round(rect.width || 0),
          height: Math.round(rect.height || 0)
        };
      } else if (canvas) {
        blockType = 'canvas';
        const cLabel = (canvas.getAttribute('aria-label') || canvas.getAttribute('title') || canvas.textContent || '').replace(/\s+/g, ' ').trim();
        if (cLabel) pieces.push(cLabel);
        const rect = canvas.getBoundingClientRect();
        mediaMeta = {
          kind: 'canvas',
          url: window.location.href,
          caption,
          width: Math.round(rect.width || 0),
          height: Math.round(rect.height || 0)
        };
      }

      const combined = pieces.join(' — ');
      if (combined.length >= 20) {
        addVisualCandidate(fig, combined, blockType, mediaMeta, `fig:${combined.length}:${combined.slice(0, 60)}`);
      }
    }

    // 2. Standalone visible images with alt/title/aria-label
    const imgs = startRoot.querySelectorAll('img');
    for (const img of imgs) {
      if (processedMedia.has(img)) continue;
      const alt = (img.getAttribute('alt') || img.getAttribute('aria-label') || img.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
      if (alt.length < 20) continue;
      const url = img.currentSrc || img.src || '';
      const sigKey = `img:${url.slice(0, 80)}:${alt.length}`;
      if (seenMap && seenMap.get(img) === sigKey) continue;
      if (hasNoiseAncestor(img, startRoot) || isNoiseElement(img) || !isElementVisible(img)) continue;
      const rect = img.getBoundingClientRect();
      const w = rect.width || img.naturalWidth || 0;
      const h = rect.height || img.naturalHeight || 0;
      if (w < 80 || h < 50) continue;
      addVisualCandidate(
        img,
        alt,
        'image',
        { kind: 'image', url, alt, width: Math.round(w), height: Math.round(h) },
        sigKey
      );
    }

    // 3. Inline SVGs large enough to be charts/diagrams with readable labels
    const svgs = startRoot.querySelectorAll('svg');
    for (const svg of svgs) {
      if (processedMedia.has(svg)) continue;
      // Fast pre-check before any layout/visibility query: skip icon SVGs with no accessible text
      if (!svg.getAttribute('aria-label') && !svg.querySelector('title, desc, text')) continue;
      const svgText = extractSvgReadableText(svg);
      if (svgText.length < 20) continue;
      const sigKey = `svg:${svgText.length}:${svgText.slice(0, 40)}`;
      if (seenMap && seenMap.get(svg) === sigKey) continue;
      if (hasNoiseAncestor(svg, startRoot) || !isElementVisible(svg)) continue;
      const rect = svg.getBoundingClientRect();
      if (rect.width < 100 || rect.height < 65) continue;
      addVisualCandidate(
        svg,
        svgText,
        'svg',
        { kind: 'svg', url: window.location.href, width: Math.round(rect.width), height: Math.round(rect.height) },
        sigKey
      );
    }

    // 4. Canvas charts/visuals with ARIA labels or fallback text
    const canvases = startRoot.querySelectorAll('canvas');
    for (const canvas of canvases) {
      if (processedMedia.has(canvas)) continue;
      const label = (canvas.getAttribute('aria-label') || canvas.getAttribute('title') || canvas.textContent || '').replace(/\s+/g, ' ').trim();
      if (label.length < 20) continue;
      const sigKey = `cvs:${label.length}:${label.slice(0, 40)}`;
      if (seenMap && seenMap.get(canvas) === sigKey) continue;
      if (hasNoiseAncestor(canvas, startRoot) || !isElementVisible(canvas)) continue;
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 100 || rect.height < 65) continue;
      addVisualCandidate(
        canvas,
        label,
        'canvas',
        { kind: 'canvas', url: window.location.href, width: Math.round(rect.width), height: Math.round(rect.height) },
        sigKey
      );
    }

    // 5. Video/audio labels & track labels + same-origin accessible iframe text
    const medias = startRoot.querySelectorAll('video, audio');
    for (const m of medias) {
      if (hasNoiseAncestor(m, startRoot) || !isElementVisible(m)) continue;
      const tracks = Array.from(m.querySelectorAll('track'))
        .map(t => [t.getAttribute('label'), t.getAttribute('srclang')].filter(Boolean).join(' '))
        .filter(Boolean);
      const label = [m.getAttribute('aria-label'), m.getAttribute('title'), ...tracks]
        .filter(Boolean)
        .join(' — ')
        .replace(/\s+/g, ' ')
        .trim();
      if (label.length >= 20) {
        addVisualCandidate(
          m,
          label,
          m.tagName.toLowerCase(),
          { kind: m.tagName.toLowerCase(), url: m.currentSrc || m.src || window.location.href },
          `media:${label.length}:${label.slice(0, 40)}`
        );
      }
    }

    const iframes = startRoot.querySelectorAll('iframe');
    for (const frame of iframes) {
      if (hasNoiseAncestor(frame, startRoot) || !isElementVisible(frame)) continue;
      const rect = frame.getBoundingClientRect();
      if (rect.width < 120 || rect.height < 80) continue;
      try {
        const doc = frame.contentDocument;
        if (!doc || !doc.body) continue;
        const iframeText = (doc.body.innerText || doc.body.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 2500);
        if (iframeText.length >= 35) {
          addVisualCandidate(
            frame,
            iframeText,
            'iframe',
            { kind: 'iframe', url: frame.src || window.location.href },
            `iframe:${iframeText.length}:${iframeText.slice(0, 40)}`
          );
        }
      } catch (_) {
        // Cross-origin iframe is inaccessible directly; capture title/aria-label if informative
        const fTitle = (frame.getAttribute('title') || frame.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
        if (fTitle.length >= 25) {
          addVisualCandidate(
            frame,
            fTitle,
            'iframe',
            { kind: 'iframe', url: frame.src || window.location.href },
            `iframetitle:${fTitle.length}`
          );
        }
      }
    }
  }

  /**
   * Rimuove tutte le evidenziazioni di LexiScrape dalla pagina corrente
   */
  function clearHighlights() {
    document.querySelectorAll('.lexiscrape-badge-bar').forEach(el => el.remove());
    document.querySelectorAll('.lexiscrape-matched-block').forEach(el => {
      el.classList.remove('lexiscrape-matched-block', 'lexiscrape-saved', 'lexiscrape-pulse-focus');
    });
    highlightedNodesMap.clear();
  }

  /**
   * Applica l'evidenziazione visiva e il pulsante rapido "+ Salva" sui blocchi trovati
   */
  function decorateMatchedBlock(element, extractData) {
    if (!element || element.nodeType !== 1) return;
    element.classList.add('lexiscrape-matched-block');
    highlightedNodesMap.set(extractData.localId, element);

    const isReplacedOrVector = /^(IMG|SVG|CANVAS|VIDEO|IFRAME)$/i.test(element.tagName);
    if (isReplacedOrVector) {
      const nextEl = element.nextElementSibling;
      if (nextEl && nextEl.classList && nextEl.classList.contains('lexiscrape-badge-bar')) {
        nextEl.remove();
      }
    } else {
      const existingBadge = element.querySelector(':scope > .lexiscrape-badge-bar');
      if (existingBadge) existingBadge.remove();
    }

    const badge = document.createElement('span');
    badge.className = isReplacedOrVector ? 'lexiscrape-badge-bar lexiscrape-badge-inline' : 'lexiscrape-badge-bar';
    badge.setAttribute('contenteditable', 'false');

    const scoreSpan = document.createElement('span');
    scoreSpan.className = 'lexiscrape-badge-score';
    scoreSpan.textContent = `${extractData.score}%`;

    const termsSpan = document.createElement('span');
    const previewTerms = (extractData.matchedTerms || []).slice(0, 3).join(', ');
    termsSpan.textContent = previewTerms ? `• ${previewTerms}` : '• Match';

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'lexiscrape-badge-btn';
    saveBtn.textContent = '+ Save';
    saveBtn.title = 'Save this block to active Defrost dossier';

    saveBtn.addEventListener('click', async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (saveBtn.classList.contains('is-saved')) return;
      try {
        await browser.runtime.sendMessage({
          type: 'SAVE_SINGLE_EXTRACT',
          item: extractData
        });
        saveBtn.textContent = 'Saved';
        saveBtn.classList.add('is-saved');
        element.classList.add('lexiscrape-saved');
      } catch (err) {
        console.error('Error saving extract:', err);
      }
    });

    badge.appendChild(scoreSpan);
    badge.appendChild(termsSpan);
    badge.appendChild(saveBtn);
    if (isReplacedOrVector) {
      element.insertAdjacentElement('afterend', badge);
    } else {
      element.appendChild(badge);
    }
  }

  // Page metadata is cached per URL (JSON-LD parsing and meta lookups are not repeated on every pass)
  let metadataCache = { url: '', data: null };
  function getPageMetadataCached() {
    const href = window.location.href;
    if (metadataCache.url !== href || !metadataCache.data) {
      metadataCache = { url: href, data: extractPageMetadata() };
    }
    return metadataCache.data;
  }

  /**
   * Evaluates extracted blocks against the expressions and decorates matches.
   */
  let blockLocalIdCounter = 0;
  function evaluateBlocks(blocks, expressions, options, onMatch) {
    const minScore = typeof options.minScore === 'number' ? options.minScore : 10;
    const highlight = options.highlight !== false;
    const metadata = getPageMetadataCached();
    const now = new Date().toISOString();
    const stamp = Date.now().toString(36);
    const matches = [];

    for (let idx = 0; idx < blocks.length; idx++) {
      const blk = blocks[idx];
      if (onMatch && onMatch.skip && onMatch.skip(blk)) continue;
      const evalRes = root.ExpressionEngine.evaluateBlock(blk.text, blk.heading, expressions);
      if (!evalRes.matched || evalRes.score < minScore) continue;

      const extractItem = {
        localId: `blk_${stamp}_${++blockLocalIdCounter}`,
        text: blk.text,
        heading: blk.heading,
        blockType: blk.blockType,
        score: evalRes.score,
        matchedExpressions: evalRes.matchedExpressions,
        matchedTerms: evalRes.matchedTerms,
        highlights: evalRes.highlights,
        ...(blk.media ? { media: blk.media } : {}),
        extractedAt: now,
        source: metadata
      };
      matches.push(extractItem);
      if (onMatch && onMatch.matched) onMatch.matched(blk, extractItem);

      if (highlight) {
        decorateMatchedBlock(blk.element, extractItem);
        // Record the decorated length so our own badge does not trigger a re-evaluation
        if (options.seenMap) options.seenMap.set(blk.element, (blk.element.textContent || '').length);
      }
    }
    return { metadata, matches };
  }

  /**
   * Esegue la scansione della pagina corrente in base alle espressioni fornite
   */
  function scanPageForExpressions(expressions, options = {}) {
    clearHighlights();
    metadataCache = { url: '', data: null };

    const blocks = extractSemanticBlocks(document.body, {
      seenMap: options.seenMap || null,
      includeVisuals: options.includeVisuals !== false,
      targetElements: options.targetElements
    });
    const { metadata, matches } = evaluateBlocks(blocks, expressions, options);

    // Ordina per rilevanza decrescente
    matches.sort((a, b) => b.score - a.score);

    return {
      metadata,
      totalScannedBlocks: blocks.length,
      matches
    };
  }

  function isOwnBadgeNode(node) {
    return node.nodeType === 1 && node.classList && node.classList.contains('lexiscrape-badge-bar');
  }

  /**
   * Avvia la scansione continua (infinita) della pagina:
   * osserva le mutazioni del DOM, analizzando e salvando all'istante
   * solo i nuovi blocchi appena vengono caricati dinamicamente.
   */
  function startContinuousScanning(expressions, options = {}) {
    stopContinuousScanning(); // Reset precedente se attivo
    if (!document.body) {
      return { ok: false, active: false, error: 'Document body not available.' };
    }

    const seenMap = new WeakMap();
    const scanOptions = { ...options, seenMap };

    continuousState.active = true;
    continuousState.expressions = expressions;
    continuousState.options = scanOptions;
    continuousState.seenFingerprints.clear();
    continuousState.matchedCount = 0;

    const fingerprintOf = (blk) => `${blk.heading || ''}::${blk.text.slice(0, 180)}`;

    // 1. Esegui subito la prima scansione sui contenuti già presenti
    const initialResult = scanPageForExpressions(expressions, scanOptions);
    initialResult.matches.forEach(m => continuousState.seenFingerprints.add(fingerprintOf(m)));
    continuousState.matchedCount = initialResult.matches.length;

    if (initialResult.matches.length > 0 && options.autoSave) {
      browser.runtime.sendMessage({
        type: 'CONTINUOUS_NEW_MATCHES',
        matches: initialResult.matches,
        projectId: options.projectId,
        totalSoFar: continuousState.matchedCount
      }).catch(() => {});
    }

    // 2. Incremental pass: only elements that are new or whose text changed are evaluated
    const runIncrementalPass = () => {
      if (!continuousState.active) return;
      continuousState.firstPendingAt = 0;

      const blocks = extractSemanticBlocks(document.body, {
        seenMap,
        includeVisuals: scanOptions.includeVisuals !== false,
        targetElements: scanOptions.targetElements
      });
      if (blocks.length === 0) return;

      const { matches } = evaluateBlocks(blocks, continuousState.expressions, scanOptions, {
        skip: (blk) => continuousState.seenFingerprints.has(fingerprintOf(blk)),
        matched: (blk) => continuousState.seenFingerprints.add(fingerprintOf(blk))
      });

      if (matches.length > 0) {
        continuousState.matchedCount += matches.length;
        browser.runtime.sendMessage({
          type: 'CONTINUOUS_NEW_MATCHES',
          matches,
          projectId: options.projectId,
          totalSoFar: continuousState.matchedCount
        }).catch(() => {});
      }
    };

    // Debounce with a max wait, so constantly-mutating pages are still scanned regularly,
    // and run during browser idle time so scrolling and typing stay smooth.
    const DEBOUNCE_MS = 350;
    const MAX_WAIT_MS = 1500;
    const scheduleIncrementalPass = () => {
      if (!continuousState.active) return;
      const now = Date.now();
      if (!continuousState.firstPendingAt) continuousState.firstPendingAt = now;
      const waited = now - continuousState.firstPendingAt;
      clearTimeout(continuousState.debounceTimer);
      continuousState.debounceTimer = setTimeout(() => {
        continuousState.debounceTimer = null;
        if (typeof window.requestIdleCallback === 'function') {
          continuousState.idleCallbackId = window.requestIdleCallback(() => {
            continuousState.idleCallbackId = null;
            runIncrementalPass();
          }, { timeout: 800 });
        } else {
          runIncrementalPass();
        }
      }, waited >= MAX_WAIT_MS ? 0 : DEBOUNCE_MS);
    };

    // 3. Osserva le mutazioni dell'albero DOM, ignorando quelle generate dai nostri badge
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (!m.addedNodes || m.addedNodes.length === 0) continue;
        if (m.target && m.target.nodeType === 1 && m.target.closest && m.target.closest('.lexiscrape-badge-bar')) continue;
        for (const n of m.addedNodes) {
          if (n.nodeType === 3 ? n.textContent.trim().length > 0 : (n.nodeType === 1 && !isOwnBadgeNode(n))) {
            scheduleIncrementalPass();
            return;
          }
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    continuousState.observer = observer;

    return {
      ok: true,
      active: true,
      totalInitial: initialResult.matches.length
    };
  }

  function stopContinuousScanning() {
    continuousState.active = false;
    continuousState.firstPendingAt = 0;
    if (continuousState.debounceTimer) {
      clearTimeout(continuousState.debounceTimer);
      continuousState.debounceTimer = null;
    }
    if (continuousState.idleCallbackId !== null && typeof window.cancelIdleCallback === 'function') {
      window.cancelIdleCallback(continuousState.idleCallbackId);
      continuousState.idleCallbackId = null;
    }
    if (continuousState.observer) {
      continuousState.observer.disconnect();
      continuousState.observer = null;
    }
    if (continuousState.scrollListener) {
      window.removeEventListener('scroll', continuousState.scrollListener);
      continuousState.scrollListener = null;
    }
    continuousState.seenFingerprints.clear();
    continuousState.options = {};
    return { ok: true, active: false };
  }

  /**
   * Estrae il testo selezionato manualmente dall'utente con il contesto (heading + metadati)
   */
  function extractCurrentSelection(customNote = '') {
    const sel = window.getSelection();
    const selectedText = sel ? sel.toString().replace(/\s+/g, ' ').trim() : '';
    if (!selectedText) return null;

    let heading = document.title || '';
    if (sel && sel.anchorNode) {
      const container = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
      if (container) {
        const section = container.closest('section, article, main, div');
        if (section) {
          const h = section.querySelector('h1, h2, h3, h4');
          if (h) heading = getCleanNodeText(h);
        }
      }
    }

    const metadata = extractPageMetadata();
    return {
      text: selectedText,
      heading,
      blockType: 'selection',
      score: 100,
      matchedExpressions: ['Selezione Manuale'],
      matchedTerms: [],
      tags: ['selezione-manuale'],
      note: customNote,
      extractedAt: new Date().toISOString(),
      source: metadata
    };
  }

  function scrollToBlock(localId) {
    const el = highlightedNodesMap.get(localId);
    if (el && el.isConnected && el.scrollIntoView) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.remove('lexiscrape-pulse-focus');
      void el.offsetWidth;
      el.classList.add('lexiscrape-pulse-focus');
      return true;
    }
    return false;
  }

  function dataUrlToParts(dataUrl) {
    const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/i);
    if (!match) return null;
    return { mimeType: match[1].toLowerCase(), base64Data: match[2] };
  }

  function rasterizeImageToPngBase64(img, maxDim = 1400) {
    const w = img.naturalWidth || img.width || 800;
    const h = img.naturalHeight || img.height || 600;
    const scale = Math.min(1, maxDim / Math.max(w, h, 1));
    const targetW = Math.max(1, Math.round(w * scale));
    const targetH = Math.max(1, Math.round(h * scale));
    const cvs = document.createElement('canvas');
    cvs.width = targetW;
    cvs.height = targetH;
    const ctx = cvs.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetW, targetH);
    ctx.drawImage(img, 0, 0, targetW, targetH);
    return dataUrlToParts(cvs.toDataURL('image/png'));
  }

  function svgElementToPngBase64(svg, maxDim = 1400) {
    return new Promise((resolve) => {
      try {
        const rect = svg.getBoundingClientRect();
        const w = Math.max(Math.round(rect.width || 600), 100);
        const h = Math.max(Math.round(rect.height || 400), 70);
        const clone = svg.cloneNode(true);
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        clone.setAttribute('width', String(w));
        clone.setAttribute('height', String(h));

        const xml = new XMLSerializer().serializeToString(clone);
        const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
        const blobUrl = URL.createObjectURL(blob);
        const img = new Image();
        const timer = setTimeout(() => {
          URL.revokeObjectURL(blobUrl);
          resolve(null);
        }, 2000);

        img.onload = () => {
          clearTimeout(timer);
          try {
            const parts = rasterizeImageToPngBase64(img, maxDim);
            resolve(parts);
          } catch (_) {
            resolve(null);
          } finally {
            URL.revokeObjectURL(blobUrl);
          }
        };
        img.onerror = () => {
          clearTimeout(timer);
          URL.revokeObjectURL(blobUrl);
          resolve(null);
        };
        img.src = blobUrl;
      } catch (_) {
        resolve(null);
      }
    });
  }

  async function blobOrDataUrlToBase64(url) {
    if (!url) return null;
    if (url.startsWith('data:')) {
      const parts = dataUrlToParts(url);
      if (!parts) return null;
      if (parts.mimeType === 'image/svg+xml') {
        return new Promise((resolve) => {
          const img = new Image();
          const timer = setTimeout(() => resolve(null), 2000);
          img.onload = () => {
            clearTimeout(timer);
            try { resolve(rasterizeImageToPngBase64(img)); } catch (_) { resolve(null); }
          };
          img.onerror = () => {
            clearTimeout(timer);
            resolve(null);
          };
          img.src = url;
        });
      }
      return parts;
    }
    if (url.startsWith('blob:')) {
      try {
        const res = await fetch(url);
        const blob = await res.blob();
        const mimeType = (blob.type || 'image/png').toLowerCase();
        return await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(dataUrlToParts(reader.result) || { mimeType, base64Data: '' });
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(blob);
        });
      } catch (_) {
        return null;
      }
    }
    return null;
  }

  /**
   * Collects top visible visual elements (images, inline SVGs, canvases) for multimodal AI OCR.
   * When targetSrcUrl is given, resolves metadata/element for that exact image (used by context menu).
   */
  async function collectVisualCandidatesForAi(opts = {}) {
    // Prune disconnected DOM references to prevent memory leaks across SPA navigations
    for (const [id, node] of visualCandidateNodes.entries()) {
      if (!node || !node.isConnected) visualCandidateNodes.delete(id);
    }

    const maxItems = typeof opts.maxItems === 'number' ? opts.maxItems : 5;
    const minWidth = typeof opts.minWidth === 'number' ? opts.minWidth : 100;
    const minHeight = typeof opts.minHeight === 'number' ? opts.minHeight : 70;
    const targetSrcUrl = String(opts.targetSrcUrl || '').trim();
    const metadata = getPageMetadataCached();
    const rootScope = document.querySelector('main, [role="main"], article') || document.body;

    if (targetSrcUrl) {
      const imgs = document.querySelectorAll('img');
      let matchedImg = null;
      for (const img of imgs) {
        const cur = img.currentSrc || img.src || '';
        if (cur === targetSrcUrl || img.src === targetSrcUrl) {
          matchedImg = img;
          break;
        }
      }
      if (matchedImg) {
        const fig = matchedImg.closest('figure');
        const capEl = fig && fig.querySelector('figcaption');
        const captionText = capEl ? (capEl.textContent || '').replace(/\s+/g, ' ').trim() : '';
        const altText = (matchedImg.getAttribute('alt') || matchedImg.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
        const heading = findNearestHeading(matchedImg);
        const candidateId = `vis_${Date.now().toString(36)}_target`;
        visualCandidateNodes.set(candidateId, matchedImg);
        const inlineParts = (targetSrcUrl.startsWith('data:') || targetSrcUrl.startsWith('blob:'))
          ? await blobOrDataUrlToBase64(targetSrcUrl)
          : null;
        return {
          metadata,
          candidates: [{
            candidateId,
            kind: 'image',
            imageUrl: targetSrcUrl,
            ...(inlineParts || {}),
            altText,
            captionText,
            heading,
            width: Math.round(matchedImg.getBoundingClientRect().width || matchedImg.naturalWidth || 0),
            height: Math.round(matchedImg.getBoundingClientRect().height || matchedImg.naturalHeight || 0)
          }]
        };
      }
      return {
        metadata,
        candidates: [{
          candidateId: '',
          kind: 'image',
          imageUrl: targetSrcUrl,
          altText: '',
          captionText: '',
          heading: metadata.title || '',
          width: 0,
          height: 0
        }]
      };
    }

    const rawCandidates = [];
    const seenUrls = new Set();

    const pushElCandidate = (el, kind, extra = {}) => {
      if (!el || hasNoiseAncestor(el, rootScope) || isNoiseElement(el) || !isElementVisible(el)) return;
      const rect = el.getBoundingClientRect();
      const w = Math.round(rect.width || el.naturalWidth || 0);
      const h = Math.round(rect.height || el.naturalHeight || 0);
      if (w < minWidth || h < minHeight) return;

      const fig = el.closest && el.closest('figure');
      const capEl = fig && fig.querySelector('figcaption');
      const captionText = capEl ? (capEl.textContent || '').replace(/\s+/g, ' ').trim() : '';
      const altText = (el.getAttribute('alt') || el.getAttribute('aria-label') || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim();

      let priority = w * h;
      if (fig) priority *= 1.4;
      if (captionText || altText) priority *= 1.2;
      if (kind === 'svg' || kind === 'canvas') priority *= 1.3;

      rawCandidates.push({
        el,
        kind,
        width: w,
        height: h,
        captionText,
        altText,
        heading: findNearestHeading(el),
        priority,
        ...extra
      });
    };

    for (const img of rootScope.querySelectorAll('img')) {
      const url = img.currentSrc || img.src || '';
      if (!url || seenUrls.has(url)) continue;
      if (/\.gif(\?|$)/i.test(url)) continue;
      seenUrls.add(url);
      pushElCandidate(img, 'image', { imageUrl: url });
    }
    for (const svg of rootScope.querySelectorAll('svg')) {
      pushElCandidate(svg, 'svg', { imageUrl: window.location.href });
    }
    for (const canvas of rootScope.querySelectorAll('canvas')) {
      pushElCandidate(canvas, 'canvas', { imageUrl: window.location.href });
    }

    rawCandidates.sort((a, b) => b.priority - a.priority);
    const chosen = rawCandidates.slice(0, maxItems);
    const candidates = [];

    for (let i = 0; i < chosen.length; i++) {
      const item = chosen[i];
      const candidateId = `vis_${Date.now().toString(36)}_${i}`;
      let base64Data = '';
      let mimeType = '';

      if (item.kind === 'canvas') {
        try {
          const scaled = rasterizeImageToPngBase64(item.el, 1400);
          if (scaled) {
            base64Data = scaled.base64Data;
            mimeType = scaled.mimeType;
          }
        } catch (_) {}
        if (!base64Data) continue;
      } else if (item.kind === 'svg') {
        const parts = await svgElementToPngBase64(item.el, 1400);
        if (parts && parts.base64Data) {
          base64Data = parts.base64Data;
          mimeType = parts.mimeType;
        } else {
          continue;
        }
      } else if (item.imageUrl.startsWith('data:') || item.imageUrl.startsWith('blob:')) {
        const parts = await blobOrDataUrlToBase64(item.imageUrl);
        if (parts && parts.base64Data) {
          base64Data = parts.base64Data;
          mimeType = parts.mimeType;
        } else {
          continue;
        }
      }

      visualCandidateNodes.set(candidateId, item.el);
      candidates.push({
        candidateId,
        kind: item.kind,
        imageUrl: item.imageUrl,
        base64Data,
        mimeType,
        altText: item.altText,
        captionText: item.captionText,
        heading: item.heading,
        width: item.width,
        height: item.height
      });
    }

    return { metadata, candidates };
  }

  // Listener per i messaggi provenienti da Background, Sidebar o Popup
  if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.onMessage) {
    browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg || !msg.type) return false;

      if (msg.type === 'PING') {
        sendResponse({ ok: true });
        return false;
      }

      if (msg.type === 'SCAN_PAGE') {
        const result = scanPageForExpressions(msg.expressions || '', {
          highlight: msg.highlight !== false,
          minScore: msg.minScore || 10,
          includeVisuals: msg.includeVisuals !== false,
          targetElements: msg.targetElements
        });
        sendResponse({ ok: true, ...result });
        return false;
      }

      if (msg.type === 'START_CONTINUOUS_SCAN') {
        const result = startContinuousScanning(msg.expressions || '', {
          highlight: msg.highlight !== false,
          minScore: msg.minScore || 10,
          autoSave: msg.autoSave !== false,
          includeVisuals: msg.includeVisuals !== false,
          targetElements: msg.targetElements,
          projectId: msg.projectId
        });
        sendResponse(result);
        return false;
      }

      if (msg.type === 'STOP_CONTINUOUS_SCAN') {
        const result = stopContinuousScanning();
        sendResponse(result);
        return false;
      }

      if (msg.type === 'GET_CONTINUOUS_STATUS') {
        sendResponse({
          ok: true,
          active: Boolean(continuousState.active),
          matchedCount: continuousState.matchedCount || 0
        });
        return false;
      }

      if (msg.type === 'GET_PAGE_METADATA') {
        sendResponse({ ok: true, metadata: getPageMetadataCached() });
        return false;
      }

      if (msg.type === 'GET_SELECTION_EXTRACT') {
        const item = extractCurrentSelection(msg.note || '');
        sendResponse({ ok: Boolean(item), item });
        return false;
      }

      if (msg.type === 'CLEAR_HIGHLIGHTS') {
        clearHighlights();
        sendResponse({ ok: true });
        return false;
      }

      if (msg.type === 'SCROLL_TO_BLOCK') {
        const found = scrollToBlock(msg.localId);
        sendResponse({ ok: found });
        return false;
      }

      if (msg.type === 'COLLECT_VISUAL_CANDIDATES') {
        collectVisualCandidatesForAi({
          maxItems: msg.maxItems,
          targetSrcUrl: msg.targetSrcUrl
        }).then(data => sendResponse({ ok: true, ...data }))
          .catch(err => sendResponse({ ok: false, error: err.message }));
        return true;
      }

      if (msg.type === 'HIGHLIGHT_VISUAL_CANDIDATES') {
        const items = Array.isArray(msg.items) ? msg.items : [];
        for (const entry of items) {
          const el = visualCandidateNodes.get(entry.candidateId);
          if (el && entry.extractItem) {
            decorateMatchedBlock(el, entry.extractItem);
            if (entry.saved) el.classList.add('lexiscrape-saved');
          }
        }
        sendResponse({ ok: true });
        return false;
      }

      return false;
    });
  }

  root.LexiScrapeContent = {
    extractPageMetadata,
    extractSemanticBlocks,
    scanPageForExpressions,
    extractCurrentSelection,
    clearHighlights
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
