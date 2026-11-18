/**
 * Defrost Studio — Sidebar Controller (English Edition)
 * Zero emoji, crisp typography, clean status messages.
 */
(function () {
  'use strict';

  const els = {
    // Navigation Rail
    railNavDashboard: document.getElementById('railNavDashboard'),
    railNavTabOpener: document.getElementById('railNavTabOpener'),
    railNavDocs: document.getElementById('railNavDocs'),
    railNavExport: document.getElementById('railNavExport'),
    railNavSettings: document.getElementById('railNavSettings'),

    // Views
    viewDashboard: document.getElementById('viewDashboard'),
    viewTabOpener: document.getElementById('viewTabOpener'),
    tabOpenerFiltersBar: document.getElementById('tabOpenerFiltersBar'),
    viewDocs: document.getElementById('viewDocs'),
    viewExport: document.getElementById('viewExport'),
    viewSettings: document.getElementById('viewSettings'),
    tabOpenerQueryInput: document.getElementById('tabOpenerQueryInput'),
    tabOpenerResultsWrap: document.getElementById('tabOpenerResultsWrap'),
    tabOpenerResultsList: document.getElementById('tabOpenerResultsList'),

    // Project Header
    projectSelectContainer: document.getElementById('projectSelectContainer'),
    projectSelect: document.getElementById('projectSelect'),
    projectRenameInline: document.getElementById('projectRenameInline'),
    btnNewProject: document.getElementById('btnNewProject'),
    btnDeleteProject: document.getElementById('btnDeleteProject'),
    newProjectPanel: document.getElementById('newProjectPanel'),
    newProjectName: document.getElementById('newProjectName'),
    btnConfirmNewProject: document.getElementById('btnConfirmNewProject'),
    btnCancelNewProject: document.getElementById('btnCancelNewProject'),

    // KPI Banner
    statExtracts: document.getElementById('statExtracts'),
    statSources: document.getElementById('statSources'),
    statLiveMatches: document.getElementById('statLiveMatches'),
    footerStatusPill: document.getElementById('footerStatusPill'),

    // Gemini AI Panel
    interpreterCard: document.getElementById('interpreterCard'),
    btnToggleInterpreter: document.getElementById('btnToggleInterpreter'),
    interpreterToggleLabel: document.getElementById('interpreterToggleLabel'),
    interpreterBodyWrap: document.getElementById('interpreterBodyWrap'),
    interpreterDisabledBanner: document.getElementById('interpreterDisabledBanner'),
    toggleSettingsInterpreter: document.getElementById('toggleSettingsInterpreter'),
    aiPromptInput: document.getElementById('aiPromptInput'),
    btnInterpretWithGemini: document.getElementById('btnInterpretWithGemini'),
    interpreterErrorBanner: document.getElementById('interpreterErrorBanner'),
    geminiModelBadge: document.getElementById('geminiModelBadge'),
    geminiStrategyCard: document.getElementById('geminiStrategyCard'),
    geminiObjectiveText: document.getElementById('geminiObjectiveText'),
    geminiKeyConceptsList: document.getElementById('geminiKeyConceptsList'),
    geminiExclusionsWrap: document.getElementById('geminiExclusionsWrap'),
    geminiExclusionsList: document.getElementById('geminiExclusionsList'),
    geminiWebQueriesList: document.getElementById('geminiWebQueriesList'),

    // Scanning & Expressions
    expressionsInput: document.getElementById('expressionsInput'),
    scannerKeywordsList: document.getElementById('scannerKeywordsList'),
    scannerKeywordsCount: document.getElementById('scannerKeywordsCount'),
    scannerKeywordAddInput: document.getElementById('scannerKeywordAddInput'),
    btnAddScannerKeyword: document.getElementById('btnAddScannerKeyword'),
    scannerTargetElementsBar: document.getElementById('scannerTargetElementsBar'),
    toggleIncludeVisuals: document.getElementById('toggleIncludeVisuals'),
    toggleAutoAiOcr: document.getElementById('toggleAutoAiOcr'),
    btnScanActive: document.getElementById('btnScanActive'),
    scanActiveLabel: document.getElementById('scanActiveLabel'),
    scanLiveDot: document.getElementById('scanLiveDot'),
    btnScanAllTabs: document.getElementById('btnScanAllTabs'),
    topResultsCountInput: document.getElementById('topResultsCountInput'),
    btnOpenTopResults: document.getElementById('btnOpenTopResults'),
    toggleAutoScanTopResults: document.getElementById('toggleAutoScanTopResults'),
    btnClipSelection: document.getElementById('btnClipSelection'),
    btnClearHighlights: document.getElementById('btnClearHighlights'),
    btnScanVisualsAi: document.getElementById('btnScanVisualsAi'),
    scanStatusBanner: document.getElementById('scanStatusBanner'),

    // Dossier & Items
    savedItemsList: document.getElementById('savedItemsList'),
    filterSavedInput: document.getElementById('filterSavedInput'),
    btnClearItems: document.getElementById('btnClearItems'),

    // Export
    groupBySelect: document.getElementById('groupBySelect'),
    btnExportMd: document.getElementById('btnExportMd'),
    btnExportJson: document.getElementById('btnExportJson'),
    btnExportCsv: document.getElementById('btnExportCsv'),

    // Settings & Tutorial
    missingKeyInlineNotice: document.getElementById('missingKeyInlineNotice'),
    inlineApiKeyInput: document.getElementById('inlineApiKeyInput'),
    btnSaveInlineKey: document.getElementById('btnSaveInlineKey'),
    btnQuickConfigKey: document.getElementById('btnQuickConfigKey'),
    btnModeCloudApi: document.getElementById('btnModeCloudApi'),
    btnModeLocalOllama: document.getElementById('btnModeLocalOllama'),
    cloudApiSettingsGroup: document.getElementById('cloudApiSettingsGroup'),
    ollamaSettingsGroup: document.getElementById('ollamaSettingsGroup'),
    ollamaUrlInput: document.getElementById('ollamaUrlInput'),
    btnDetectOllamaModels: document.getElementById('btnDetectOllamaModels'),
    ollamaModelInput: document.getElementById('ollamaModelInput'),
    ollamaVisionModelInput: document.getElementById('ollamaVisionModelInput'),
    ollamaModelsDatalist: document.getElementById('ollamaModelsDatalist'),
    ollamaVisionModelsDatalist: document.getElementById('ollamaVisionModelsDatalist'),
    tutorialToggle: document.getElementById('tutorialToggle'),
    tutorialBody: document.getElementById('tutorialBody'),
    tutorialIcon: document.getElementById('tutorialIcon'),
    geminiApiKeyInput: document.getElementById('geminiApiKeyInput'),
    btnToggleKeyVisibility: document.getElementById('btnToggleKeyVisibility'),
    geminiModelSelect: document.getElementById('geminiModelSelect'),
    btnTestGeminiKey: document.getElementById('btnTestGeminiKey'),
    geminiTestFeedback: document.getElementById('geminiTestFeedback')
  };

  let currentState = null;
  let activeProject = null;
  let isContinuousScanRunning = false;
  let promptSaveTimer = null;
  let exprSaveTimer = null;
  let docsFilterTimer = null;
  let apiKeySaveTimer = null;
  let stateRefreshTimer = null;
  let docsDirty = true;
  let visibleDocsLimit = 40;
  let lastProjectOptionsSig = '';
  let lastStrategySig = '';
  let lastSavedItemsSig = '';
  let statusBannerTimer = null;
  const highlightRegexCache = new Map();

  // Rail Navigation
  function switchView(viewName) {
    const navMap = {
      dashboard: { btn: els.railNavDashboard, view: els.viewDashboard },
      tabOpener: { btn: els.railNavTabOpener, view: els.viewTabOpener },
      docs: { btn: els.railNavDocs, view: els.viewDocs },
      export: { btn: els.railNavExport, view: els.viewExport },
      settings: { btn: els.railNavSettings, view: els.viewSettings }
    };

    Object.keys(navMap).forEach(key => {
      const item = navMap[key];
      if (key === viewName) {
        item.btn.classList.add('active');
        item.view.classList.remove('hidden');
      } else {
        item.btn.classList.remove('active');
        item.view.classList.add('hidden');
      }
    });

    if (viewName === 'docs' && docsDirty) {
      docsDirty = false;
      renderSavedItems();
    }
  }

  els.railNavDashboard.addEventListener('click', () => switchView('dashboard'));
  if (els.railNavTabOpener) {
    els.railNavTabOpener.addEventListener('click', () => switchView('tabOpener'));
  }
  els.railNavDocs.addEventListener('click', () => switchView('docs'));
  els.railNavExport.addEventListener('click', () => switchView('export'));
  els.railNavSettings.addEventListener('click', () => switchView('settings'));

  // Tutorial Accordion
  let isTutorialOpen = true;
  els.tutorialToggle.addEventListener('click', () => {
    isTutorialOpen = !isTutorialOpen;
    els.tutorialBody.classList.toggle('hidden', !isTutorialOpen);
    els.tutorialIcon.textContent = isTutorialOpen ? 'Hide' : 'Show';
  });

  // Password Visibility Toggle
  els.btnToggleKeyVisibility.addEventListener('click', () => {
    const isPassword = els.geminiApiKeyInput.type === 'password';
    els.geminiApiKeyInput.type = isPassword ? 'text' : 'password';
    els.btnToggleKeyVisibility.textContent = isPassword ? 'Hide' : 'Show';
  });

  function showStatus(message, isError = false, timeoutMs = 5000) {
    clearTimeout(statusBannerTimer);
    els.scanStatusBanner.textContent = message;
    els.scanStatusBanner.classList.remove('hidden');
    els.scanStatusBanner.style.color = isError ? '#dc2626' : 'var(--text-main)';
    els.footerStatusPill.textContent = message.slice(0, 36);
    if (timeoutMs > 0) {
      statusBannerTimer = setTimeout(() => {
        if (els.scanStatusBanner.textContent === message) {
          els.scanStatusBanner.classList.add('hidden');
          els.footerStatusPill.textContent = isContinuousScanRunning ? 'Live Scanner Active' : 'Defrost Ready';
        }
      }, timeoutMs);
    }
  }

  function updateLiveMatchesCount(count) {
    if (!els.statLiveMatches) return;
    const safeCount = Number.isFinite(Number(count)) ? Math.max(0, Math.floor(Number(count))) : 0;
    els.statLiveMatches.textContent = String(safeCount);
  }

  function updateContinuousScanButton(isActive) {
    isContinuousScanRunning = Boolean(isActive);
    if (isContinuousScanRunning) {
      els.btnScanActive.classList.add('btn-scan-running');
      els.scanLiveDot.classList.remove('hidden');
      els.scanActiveLabel.textContent = 'Stop scan';
      els.footerStatusPill.textContent = 'Live scanner running...';
    } else {
      els.btnScanActive.classList.remove('btn-scan-running');
      els.scanLiveDot.classList.add('hidden');
      els.scanActiveLabel.textContent = 'Continuous scan';
      els.footerStatusPill.textContent = 'Defrost Ready';
    }
  }

  async function checkActiveTabStatus() {
    try {
      const res = await browser.runtime.sendMessage({ type: 'GET_ACTIVE_TAB_CONTINUOUS_STATUS' });
      if (res && res.ok) {
        updateContinuousScanButton(res.active);
        updateLiveMatchesCount(res.matchedCount || 0);
      } else {
        updateContinuousScanButton(false);
        updateLiveMatchesCount(0);
      }
    } catch (_) {
      updateContinuousScanButton(false);
      updateLiveMatchesCount(0);
    }
  }

  const ALL_TARGET_ELEMENT_DEFS = [
    { id: 'paragraphs', label: 'Paragraphs' },
    { id: 'quotes_comments', label: 'Quotes & Comments' },
    { id: 'lists', label: 'Lists' },
    { id: 'tables', label: 'Tables' },
    { id: 'visuals', label: 'Visuals' }
  ];

  function getActiveTargetElements() {
    if (activeProject && activeProject.aiStrategy && Array.isArray(activeProject.aiStrategy.targetElements) && activeProject.aiStrategy.targetElements.length > 0) {
      return activeProject.aiStrategy.targetElements;
    }
    return ['paragraphs', 'quotes_comments', 'lists', 'tables', 'visuals'];
  }

  function getActiveMinScore() {
    if (activeProject && activeProject.aiStrategy && typeof activeProject.aiStrategy.recommendedMinScore === 'number') {
      const val = activeProject.aiStrategy.recommendedMinScore;
      return val <= 1 ? Math.round(val * 100) : Math.round(val);
    }
    return 12;
  }

  function renderTargetElementsBar(strategy) {
    if (!els.scannerTargetElementsBar) return;
    els.scannerTargetElementsBar.textContent = '';
    if (!strategy) return;

    const activeTargets = new Set(
      Array.isArray(strategy.targetElements) && strategy.targetElements.length > 0
        ? strategy.targetElements
        : ['paragraphs', 'quotes_comments', 'lists', 'tables', 'visuals']
    );

    const label = document.createElement('span');
    label.className = 'scanner-targets-label';
    label.textContent = 'Targets:';
    els.scannerTargetElementsBar.appendChild(label);

    ALL_TARGET_ELEMENT_DEFS.forEach(def => {
      const chip = document.createElement('button');
      chip.type = 'button';
      const isSelected = activeTargets.has(def.id);
      chip.className = `target-el-chip${isSelected ? ' active' : ''}`;
      chip.textContent = def.label;
      chip.title = 'Click to toggle this DOM element category in the extraction scanner';
      chip.addEventListener('click', async () => {
        if (activeTargets.has(def.id)) {
          if (activeTargets.size > 1) activeTargets.delete(def.id);
        } else {
          activeTargets.add(def.id);
        }
        strategy.targetElements = Array.from(activeTargets);
        const includeVisuals = activeTargets.has('visuals');
        if (els.toggleIncludeVisuals) {
          els.toggleIncludeVisuals.checked = includeVisuals;
        }
        if (currentState) {
          if (!currentState.settings) currentState.settings = {};
          currentState.settings.includeLocalVisuals = includeVisuals;
        }
        lastStrategySig = '';
        renderTargetElementsBar(strategy);
        await window.StorageManager.updateSettings({ includeLocalVisuals: includeVisuals });
        if (activeProject) {
          await window.StorageManager.updateProject(activeProject.id, { aiStrategy: strategy });
        }
      });
      els.scannerTargetElementsBar.appendChild(chip);
    });

    if (typeof strategy.recommendedMinScore === 'number') {
      const rawScore = strategy.recommendedMinScore;
      const pctScore = rawScore <= 1 ? Math.round(rawScore * 100) : Math.round(rawScore);
      const scoreBadge = document.createElement('span');
      scoreBadge.className = 'scanner-minscore-pill';
      scoreBadge.textContent = `Min score ${pctScore}`;
      els.scannerTargetElementsBar.appendChild(scoreBadge);
    }
  }

  function autoResizeExpressionsInput() {
    if (!els.expressionsInput) return;
    els.expressionsInput.style.height = 'auto';
    const targetH = Math.min(200, Math.max(76, els.expressionsInput.scrollHeight));
    els.expressionsInput.style.height = `${targetH}px`;
  }

  function ensureActiveStrategy() {
    if (!activeProject) return null;
    if (!activeProject.aiStrategy || typeof activeProject.aiStrategy !== 'object') {
      activeProject.aiStrategy = {
        objective: 'Manual expressions',
        keyConcepts: [],
        primaryExpressions: [],
        exclusions: []
      };
    }
    if (!Array.isArray(activeProject.aiStrategy.keyConcepts)) activeProject.aiStrategy.keyConcepts = [];
    if (!Array.isArray(activeProject.aiStrategy.primaryExpressions)) activeProject.aiStrategy.primaryExpressions = [];
    if (!Array.isArray(activeProject.aiStrategy.exclusions)) activeProject.aiStrategy.exclusions = [];

    const rawExpr = els.expressionsInput ? els.expressionsInput.value.trim() : '';
    if (
      rawExpr &&
      activeProject.aiStrategy.primaryExpressions.length === 0 &&
      window.ExpressionEngine &&
      window.ExpressionEngine.splitExpressions
    ) {
      activeProject.aiStrategy.primaryExpressions = window.ExpressionEngine.splitExpressions(rawExpr);
      if (
        activeProject.aiStrategy.keyConcepts.length === 0 &&
        activeProject.aiStrategy.exclusions.length === 0 &&
        window.ExpressionEngine.extractTermsFromExpressions
      ) {
        const parsed = window.ExpressionEngine.extractTermsFromExpressions(rawExpr);
        activeProject.aiStrategy.keyConcepts = parsed.keywords || [];
        activeProject.aiStrategy.exclusions = parsed.exclusions || [];
      }
    }
    return activeProject.aiStrategy;
  }

  function removeTermFromExpressionLine(line, term) {
    const cleanTerm = String(term || '').trim();
    if (!cleanTerm) return line;
    const escaped = cleanTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const quotedRe = new RegExp(`"${escaped}"`, 'gi');
    const bareRe = new RegExp(`(^|\\s|\\()${escaped}(?=$|\\s|\\))`, 'gi');
    let updated = String(line || '').replace(quotedRe, '').replace(bareRe, '$1');
    // Clean dangling OR/AND operators and empty parens
    updated = updated
      .replace(/\(\s*(?:OR|AND)?\s*\)/gi, '')
      .replace(/(?:^|\s)(?:OR|AND)\s+(?:OR|AND)(?=\s|$)/gi, ' OR ')
      .replace(/^\s*(?:OR|AND)\s+/i, '')
      .replace(/\s+(?:OR|AND)\s*$/i, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    return updated;
  }

  async function syncStrategyFromPillsChange(strategy) {
    if (!strategy) return;
    const compiled = (window.ExpressionEngine && window.ExpressionEngine.compileStrategyExpressions)
      ? window.ExpressionEngine.compileStrategyExpressions(strategy)
      : (strategy.primaryExpressions || []).join('\n');

    strategy.compiledExpressions = compiled;
    if (els.expressionsInput) {
      els.expressionsInput.value = compiled;
      autoResizeExpressionsInput();
    }

    renderStrategyPreview(strategy);

    if (activeProject) {
      activeProject.aiStrategy = strategy;
      activeProject.expressions = compiled;
      await window.StorageManager.updateProject(activeProject.id, {
        aiStrategy: strategy,
        expressions: compiled
      });
    }
  }

  async function removeScannerKeyword(kw) {
    const strategy = ensureActiveStrategy();
    if (!strategy) return;
    const targetLower = String(kw || '').trim().toLowerCase();
    strategy.keyConcepts = (strategy.keyConcepts || []).filter(
      k => String(k || '').trim().toLowerCase() !== targetLower
    );
    strategy.primaryExpressions = (strategy.primaryExpressions || [])
      .map(line => removeTermFromExpressionLine(line, kw))
      .filter(line => line && !/^(-(?:"[^"]+"|\S+)\s*)+$/.test(line.trim()));
    await syncStrategyFromPillsChange(strategy);
  }

  async function removeScannerExclusion(ex) {
    const strategy = ensureActiveStrategy();
    if (!strategy) return;
    const targetLower = String(ex || '').trim().replace(/^-+/, '').toLowerCase();
    strategy.exclusions = (strategy.exclusions || []).filter(
      e => String(e || '').trim().replace(/^-+/, '').toLowerCase() !== targetLower
    );
    const escaped = targetLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const exclRe = new RegExp(`(?:^|\\s)-(?:"${escaped}"|${escaped})(?=\\s|$)`, 'gi');
    strategy.primaryExpressions = (strategy.primaryExpressions || [])
      .map(line => String(line || '').replace(exclRe, '').replace(/\s{2,}/g, ' ').trim())
      .filter(Boolean);
    await syncStrategyFromPillsChange(strategy);
  }

  async function addScannerKeywordOrExclusion(rawInput) {
    const clean = String(rawInput || '').trim();
    if (!clean) return;
    const strategy = ensureActiveStrategy();
    if (!strategy) return;

    if (clean.startsWith('-')) {
      const excl = clean.replace(/^-+/, '').trim();
      if (!excl) return;
      const exists = (strategy.exclusions || []).some(e => String(e || '').trim().toLowerCase() === excl.toLowerCase());
      if (!exists) {
        strategy.exclusions.push(excl);
      }
    } else {
      const exists = (strategy.keyConcepts || []).some(k => String(k || '').trim().toLowerCase() === clean.toLowerCase());
      if (!exists) {
        strategy.keyConcepts.push(clean);
      }
    }

    if (els.scannerKeywordAddInput) {
      els.scannerKeywordAddInput.value = '';
    }
    await syncStrategyFromPillsChange(strategy);
  }

  function renderScannerKeywords(strategy) {
    if (!els.scannerKeywordsList || !els.scannerKeywordsCount) return;
    els.scannerKeywordsList.textContent = '';

    let keywords = [];
    let exclusions = [];

    if (strategy && ((strategy.keyConcepts && strategy.keyConcepts.length) || (strategy.exclusions && strategy.exclusions.length))) {
      keywords = Array.from(new Set((strategy.keyConcepts || []).map(k => String(k || '').trim()).filter(Boolean)));
      exclusions = Array.from(new Set((strategy.exclusions || []).map(e => String(e || '').trim().replace(/^-+/, '')).filter(Boolean)));
    } else if (els.expressionsInput && els.expressionsInput.value.trim() && window.ExpressionEngine && window.ExpressionEngine.extractTermsFromExpressions) {
      const parsed = window.ExpressionEngine.extractTermsFromExpressions(els.expressionsInput.value);
      keywords = parsed.keywords;
      exclusions = parsed.exclusions;
    }

    keywords.forEach(kw => {
      const pill = document.createElement('span');
      pill.className = 'tag-pill removable';
      const label = document.createElement('span');
      label.textContent = kw;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tag-pill-remove';
      btn.title = `Remove "${kw}"`;
      btn.setAttribute('aria-label', `Remove ${kw}`);
      btn.textContent = '×';
      btn.addEventListener('click', () => removeScannerKeyword(kw));
      pill.appendChild(label);
      pill.appendChild(btn);
      els.scannerKeywordsList.appendChild(pill);
    });

    exclusions.forEach(ex => {
      const pill = document.createElement('span');
      pill.className = 'tag-pill exclusion removable';
      const label = document.createElement('span');
      label.textContent = `-${ex}`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tag-pill-remove';
      btn.title = `Remove exclusion "-${ex}"`;
      btn.setAttribute('aria-label', `Remove exclusion ${ex}`);
      btn.textContent = '×';
      btn.addEventListener('click', () => removeScannerExclusion(ex));
      pill.appendChild(label);
      pill.appendChild(btn);
      els.scannerKeywordsList.appendChild(pill);
    });

    els.scannerKeywordsCount.textContent = String(keywords.length + exclusions.length);
  }

  async function applyStrategyToScanner(strategy, promptText, persist = true) {
    if (!strategy) return;
    const formattedExpressions = (window.ExpressionEngine && window.ExpressionEngine.compileStrategyExpressions)
      ? window.ExpressionEngine.compileStrategyExpressions(strategy)
      : (strategy.compiledExpressions || (strategy.primaryExpressions || []).join('\n'));

    strategy.compiledExpressions = formattedExpressions;
    els.expressionsInput.value = formattedExpressions;
    autoResizeExpressionsInput();

    if (typeof strategy.enableVisualScan === 'boolean' && els.toggleIncludeVisuals) {
      els.toggleIncludeVisuals.checked = strategy.enableVisualScan;
    }

    renderStrategyPreview(strategy);

    if (persist && activeProject) {
      activeProject.aiPrompt = promptText;
      activeProject.aiStrategy = strategy;
      activeProject.expressions = formattedExpressions;
      await window.StorageManager.updateProject(activeProject.id, {
        aiPrompt: promptText,
        aiStrategy: strategy,
        expressions: formattedExpressions
      });
    }
  }

  function isInterpreterEnabled() {
    if (currentState && currentState.settings && typeof currentState.settings.interpreterEnabled === 'boolean') {
      return currentState.settings.interpreterEnabled;
    }
    return true;
  }

  function applyInterpreterEnabledUI(enabled) {
    const isOn = Boolean(enabled);
    if (els.interpreterCard) {
      els.interpreterCard.classList.toggle('interpreter-disabled', !isOn);
    }
    if (els.btnToggleInterpreter) {
      els.btnToggleInterpreter.classList.toggle('active', isOn);
      els.btnToggleInterpreter.setAttribute('aria-pressed', isOn ? 'true' : 'false');
    }
    if (els.interpreterToggleLabel) {
      els.interpreterToggleLabel.textContent = isOn ? 'Enabled' : 'Off';
    }
    if (els.geminiModelBadge) {
      els.geminiModelBadge.classList.toggle('hidden', !isOn);
    }
    if (els.interpreterBodyWrap) {
      els.interpreterBodyWrap.classList.toggle('hidden', !isOn);
    }
    if (els.interpreterDisabledBanner) {
      els.interpreterDisabledBanner.classList.toggle('hidden', isOn);
    }
    if (els.toggleSettingsInterpreter) {
      els.toggleSettingsInterpreter.checked = isOn;
    }
  }

  async function setInterpreterEnabled(enabled) {
    const isOn = Boolean(enabled);
    if (currentState) {
      if (!currentState.settings) currentState.settings = {};
      currentState.settings.interpreterEnabled = isOn;
    }
    applyInterpreterEnabledUI(isOn);
    await window.StorageManager.updateSettings({ interpreterEnabled: isOn });

    showStatus(
      isOn
        ? 'AI Interpreter enabled.'
        : 'AI Interpreter disabled. Manual Extraction and Scanner mode active.'
    );
  }

  function getStrategyRenderSig(strategy) {
    const rawExpr = els.expressionsInput ? els.expressionsInput.value : '';
    const topCount = getTopResultsCount();
    if (!strategy) {
      return `null::${topCount}::${rawExpr}`;
    }
    const hasExplicitTerms = (strategy.keyConcepts && strategy.keyConcepts.length) || (strategy.exclusions && strategy.exclusions.length);
    return JSON.stringify({
      o: strategy.objective || '',
      k: strategy.keyConcepts || [],
      e: strategy.exclusions || [],
      w: strategy.webQueries || [],
      t: strategy.targetElements || [],
      m: strategy.recommendedMinScore,
      top: topCount,
      expr: hasExplicitTerms ? '' : rawExpr
    });
  }

  function renderStrategyPreview(strategy) {
    const sig = getStrategyRenderSig(strategy);
    if (sig === lastStrategySig) return;
    lastStrategySig = sig;

    renderTargetElementsBar(strategy);
    renderScannerKeywords(strategy);
    if (!strategy) {
      els.geminiStrategyCard.classList.add('hidden');
      return;
    }

    els.geminiStrategyCard.classList.remove('hidden');
    els.geminiObjectiveText.textContent = `Objective: ${strategy.objective || 'Not specified'}`;

    // Key concepts
    els.geminiKeyConceptsList.textContent = '';
    (strategy.keyConcepts || []).forEach(kc => {
      const pill = document.createElement('span');
      pill.className = 'tag-pill';
      pill.textContent = kc;
      els.geminiKeyConceptsList.appendChild(pill);
    });

    // Exclusions
    if (strategy.exclusions && strategy.exclusions.length > 0) {
      els.geminiExclusionsWrap.classList.remove('hidden');
      els.geminiExclusionsList.textContent = '';
      strategy.exclusions.forEach(ex => {
        const pill = document.createElement('span');
        pill.className = 'tag-pill exclusion';
        pill.textContent = `-${ex}`;
        els.geminiExclusionsList.appendChild(pill);
      });
    } else {
      els.geminiExclusionsWrap.classList.add('hidden');
    }

    // Recommended public search queries
    els.geminiWebQueriesList.textContent = '';
    const topCount = getTopResultsCount();
    (strategy.webQueries || []).forEach(wq => {
      const row = document.createElement('div');
      row.className = 'query-chip-row';

      const qSpan = document.createElement('span');
      qSpan.className = 'query-text-span';
      qSpan.textContent = wq;

      const actions = document.createElement('div');
      actions.className = 'query-chip-actions';

      const searchBtn = document.createElement('button');
      searchBtn.type = 'button';
      searchBtn.className = 'query-action-btn';
      searchBtn.title = 'Open web search query in a new tab';
      searchBtn.textContent = 'Search';
      searchBtn.addEventListener('click', async () => {
        try {
          await browser.runtime.sendMessage({
            type: 'LAUNCH_GUIDED_SEARCH',
            query: wq,
            engine: 'duckduckgo'
          });
        } catch (err) {
          showStatus(`Search error: ${(err && err.message) || 'Unable to open tab'}`, true);
        }
      });

      const topBtn = document.createElement('button');
      topBtn.type = 'button';
      topBtn.className = 'query-action-btn primary query-top-n-btn';
      topBtn.title = `Open the top ${topCount} search results for this query`;
      topBtn.textContent = `Top ${topCount}`;
      topBtn.addEventListener('click', () => handleOpenTopResults({ query: wq, engine: 'duckduckgo' }));

      actions.appendChild(searchBtn);
      actions.appendChild(topBtn);
      row.appendChild(qSpan);
      row.appendChild(actions);
      els.geminiWebQueriesList.appendChild(row);
    });
  }

  function getHighlightRegex(validTerms) {
    const cacheKey = validTerms.join('\u0001');
    if (highlightRegexCache.has(cacheKey)) return highlightRegexCache.get(cacheKey);
    const escaped = validTerms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const regex = new RegExp(`(${escaped.join('|')})`, 'gi');
    if (highlightRegexCache.size >= 64) {
      highlightRegexCache.delete(highlightRegexCache.keys().next().value);
    }
    highlightRegexCache.set(cacheKey, regex);
    return regex;
  }

  function appendHighlightedText(container, text, terms) {
    container.textContent = '';
    const cleanText = String(text || '');
    const validTerms = Array.from(new Set((terms || []).map(t => String(t).trim()).filter(t => t.length >= 2)))
      .sort((a, b) => b.length - a.length)
      .slice(0, 10);

    if (validTerms.length === 0) {
      container.textContent = cleanText;
      return;
    }

    try {
      const regex = getHighlightRegex(validTerms);
      const parts = cleanText.split(regex);
      const frag = document.createDocumentFragment();
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (!part) continue;
        if (i % 2 === 1) {
          const mark = document.createElement('mark');
          mark.textContent = part;
          frag.appendChild(mark);
        } else {
          frag.appendChild(document.createTextNode(part));
        }
      }
      container.appendChild(frag);
    } catch (_) {
      container.textContent = cleanText;
    }
  }

  async function refreshUI(preserveInputs = false) {
    currentState = await window.StorageManager.loadState();
    activeProject = currentState.projects.find(p => p.id === currentState.activeProjectId) || currentState.projects[0];

    // Project Selector (skip DOM rebuild if project ids/names/counts unchanged)
    const sig = `${activeProject.id}::` + currentState.projects.map(p => `${p.id}:${p.name}:${(p.items || []).length}`).join('|');
    if (sig !== lastProjectOptionsSig) {
      lastProjectOptionsSig = sig;
      const frag = document.createDocumentFragment();
      for (const proj of currentState.projects) {
        const opt = document.createElement('option');
        opt.value = proj.id;
        opt.textContent = `${proj.name} (${(proj.items || []).length} extracts)`;
        if (proj.id === activeProject.id) opt.selected = true;
        frag.appendChild(opt);
      }
      els.projectSelect.textContent = '';
      els.projectSelect.appendChild(frag);
    }

    const stSettings = currentState.settings || {};
    const interpEnabled = stSettings.interpreterEnabled !== false;
    applyInterpreterEnabledUI(interpEnabled);

    if (!preserveInputs) {
      visibleDocsLimit = 40;
      els.aiPromptInput.value = activeProject.aiPrompt || '';
      els.expressionsInput.value = activeProject.expressions || '';
      autoResizeExpressionsInput();
    }

    renderStrategyPreview(activeProject.aiStrategy);

    // AI Settings (Cloud API vs Open AI Local Ollama)
    const creds = await window.StorageManager.getGeminiSettings();
    const aiProvider = creds.aiProvider === 'ollama' ? 'ollama' : 'cloud';
    const effectiveKey = creds.apiKey || currentState.geminiApiKey || '';
    const effectiveModel = creds.model || currentState.geminiModel || 'gemini-2.5-flash';
    currentState.geminiApiKey = effectiveKey;
    currentState.geminiModel = effectiveModel;

    applyProviderModeUI(aiProvider, creds.ollamaModel);

    if (document.activeElement !== els.geminiApiKeyInput) {
      els.geminiApiKeyInput.value = effectiveKey;
    }
    els.geminiModelSelect.value = effectiveModel;
    if (els.ollamaUrlInput && document.activeElement !== els.ollamaUrlInput) {
      els.ollamaUrlInput.value = creds.ollamaUrl || 'http://localhost:11434';
    }
    if (els.ollamaModelInput && document.activeElement !== els.ollamaModelInput) {
      els.ollamaModelInput.value = creds.ollamaModel || 'qwen2.5:latest';
    }
    if (els.ollamaVisionModelInput && document.activeElement !== els.ollamaVisionModelInput) {
      els.ollamaVisionModelInput.value = creds.ollamaVisionModel || 'qwen2.5vl:latest';
    }

    els.geminiModelBadge.textContent = aiProvider === 'ollama'
      ? `Ollama · ${creds.ollamaModel || 'qwen2.5:latest'}`
      : effectiveModel;

    if (els.missingKeyInlineNotice) {
      if (aiProvider === 'cloud' && !effectiveKey) {
        els.missingKeyInlineNotice.classList.remove('hidden');
      } else {
        els.missingKeyInlineNotice.classList.add('hidden');
      }
    }

    if (els.toggleIncludeVisuals) {
      els.toggleIncludeVisuals.checked = stSettings.includeLocalVisuals !== false;
    }
    if (els.toggleAutoAiOcr) {
      els.toggleAutoAiOcr.checked = Boolean(stSettings.autoAiOcr);
    }

    // KPI & Stats
    const items = activeProject.items || [];
    const uniqueDomains = new Set(items.map(i => (i.source && (i.source.canonicalUrl || i.source.url)) || '').filter(Boolean));
    els.statExtracts.textContent = String(items.length);
    els.statSources.textContent = String(uniqueDomains.size);

    if (els.viewDocs.classList.contains('hidden')) {
      docsDirty = true;
    } else {
      docsDirty = false;
      renderSavedItems();
    }
  }

  function renderSavedItems() {
    const items = (activeProject && activeProject.items) || [];
    const filterQuery = (els.filterSavedInput.value || '').trim().toLowerCase();
    const firstId = items[0] ? items[0].id : '';
    const lastId = items.length > 0 ? items[items.length - 1].id : '';
    const sig = `${activeProject ? activeProject.id : ''}::${items.length}::${firstId}::${lastId}::${filterQuery}::${visibleDocsLimit}`;
    if (sig === lastSavedItemsSig) return;
    lastSavedItemsSig = sig;

    els.savedItemsList.textContent = '';

    const filtered = filterQuery
      ? items.filter(item => {
          const hay = (
            (item.text || '') + '\n' +
            (item.heading || '') + '\n' +
            (item.note || '') + '\n' +
            (item.source ? ((item.source.title || '') + ' ' + (item.source.domain || '')) : '')
          ).toLowerCase();
          if (hay.includes(filterQuery)) return true;
          return (item.tags && item.tags.some(t => t.toLowerCase().includes(filterQuery))) ||
            (item.matchedExpressions && item.matchedExpressions.some(e => e.toLowerCase().includes(filterQuery))) ||
            (item.matchedTerms && item.matchedTerms.some(t => t.toLowerCase().includes(filterQuery)));
        })
      : items;

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.style.textAlign = 'center';
      empty.style.padding = '30px 14px';
      empty.style.color = 'var(--text-muted)';
      empty.style.fontSize = '12.5px';
      empty.textContent = items.length === 0
        ? 'No extracts saved yet. Formulate a research inquiry with AI and launch Continuous Scan.'
        : 'No extracts match the search filter.';
      els.savedItemsList.appendChild(empty);
      return;
    }

    const frag = document.createDocumentFragment();
    const visible = filtered.slice(0, visibleDocsLimit);

    visible.forEach(item => {
      const card = document.createElement('div');
      card.className = 'extract-card-frost';

      const top = document.createElement('div');
      top.className = 'extract-top-row';

      const scoreBadge = document.createElement('span');
      scoreBadge.className = 'score-badge';
      scoreBadge.textContent = `Score: ${item.score || 50}%`;

      top.appendChild(scoreBadge);

      const visualTypes = new Set(['image', 'svg', 'canvas', 'image-ocr', 'svg-ocr', 'canvas-ocr', 'pdf-ocr', 'video', 'audio', 'iframe']);
      if (item.blockType && visualTypes.has(item.blockType)) {
        const typePill = document.createElement('span');
        typePill.className = 'block-type-pill';
        typePill.textContent = item.blockType.toUpperCase();
        top.appendChild(typePill);
      }

      const heading = document.createElement('span');
      heading.className = 'extract-heading-text';
      heading.textContent = item.heading || (item.source && item.source.title) || 'Extract';

      const delBtn = document.createElement('button');
      delBtn.className = 'btn-frost btn-xs btn-danger-soft';
      delBtn.style.padding = '3px 8px';
      delBtn.textContent = 'Remove';
      delBtn.title = 'Remove this extract';
      delBtn.addEventListener('click', async () => {
        await window.StorageManager.deleteItem(activeProject.id, item.id);
        lastSavedItemsSig = '';
        browser.runtime.sendMessage({ type: 'REFRESH_BADGE' }).catch(() => {});
        await refreshUI(true);
      });

      top.appendChild(heading);
      top.appendChild(delBtn);

      const bodyText = document.createElement('div');
      bodyText.className = 'extract-body-text';
      appendHighlightedText(bodyText, item.text, item.matchedTerms);
      bodyText.addEventListener('click', () => bodyText.classList.toggle('expanded'));

      const footerMeta = document.createElement('div');
      footerMeta.className = 'extract-footer-meta';

      const src = item.source || {};
      const srcAnchor = document.createElement('a');
      srcAnchor.className = 'source-anchor';
      srcAnchor.href = src.canonicalUrl || src.url || '#';
      srcAnchor.target = '_blank';
      srcAnchor.rel = 'noopener noreferrer';
      srcAnchor.textContent = `Source: ${src.domain || 'web'}`;
      footerMeta.appendChild(srcAnchor);

      if (src.author) {
        const authSpan = document.createElement('span');
        authSpan.textContent = `Author: ${src.author}`;
        footerMeta.appendChild(authSpan);
      }

      if (item.media && item.media.url && /^https?:\/\//i.test(item.media.url) && item.media.url !== (src.url || '')) {
        const mediaAnchor = document.createElement('a');
        mediaAnchor.className = 'source-anchor';
        mediaAnchor.href = item.media.url;
        mediaAnchor.target = '_blank';
        mediaAnchor.rel = 'noopener noreferrer';
        mediaAnchor.textContent = 'Visual asset';
        footerMeta.appendChild(mediaAnchor);
      }

      card.appendChild(top);
      card.appendChild(bodyText);
      card.appendChild(footerMeta);
      frag.appendChild(card);
    });

    if (filtered.length > visibleDocsLimit) {
      const moreBtn = document.createElement('button');
      moreBtn.type = 'button';
      moreBtn.className = 'btn-frost btn-xs';
      moreBtn.style.alignSelf = 'center';
      moreBtn.style.marginTop = '6px';
      moreBtn.textContent = `Show more (${filtered.length - visibleDocsLimit} remaining)`;
      moreBtn.addEventListener('click', () => {
        visibleDocsLimit += 40;
        renderSavedItems();
      });
      frag.appendChild(moreBtn);
    }

    els.savedItemsList.appendChild(frag);
  }

  let isVerifyingKey = false;

  function applyProviderModeUI(mode, ollamaModelName) {
    const isOllama = mode === 'ollama';
    if (els.btnModeCloudApi) els.btnModeCloudApi.classList.toggle('active', !isOllama);
    if (els.btnModeLocalOllama) els.btnModeLocalOllama.classList.toggle('active', isOllama);
    if (els.cloudApiSettingsGroup) els.cloudApiSettingsGroup.classList.toggle('hidden', isOllama);
    if (els.ollamaSettingsGroup) els.ollamaSettingsGroup.classList.toggle('hidden', !isOllama);
    if (els.btnTestGeminiKey) {
      els.btnTestGeminiKey.textContent = isOllama ? 'Verify & Connect Ollama' : 'Verify & Save';
    }
    if (isOllama && els.missingKeyInlineNotice) {
      els.missingKeyInlineNotice.classList.add('hidden');
    }
    if (els.geminiModelBadge) {
      const m = ollamaModelName || (els.ollamaModelInput && els.ollamaModelInput.value.trim()) || 'qwen2.5:latest';
      if (isOllama) {
        els.geminiModelBadge.textContent = `Ollama · ${m}`;
      }
    }
  }

  function populateOllamaDatalists(models = [], visionModels = []) {
    if (els.ollamaModelsDatalist && Array.isArray(models) && models.length > 0) {
      els.ollamaModelsDatalist.textContent = '';
      models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m;
        els.ollamaModelsDatalist.appendChild(opt);
      });
    }
    if (els.ollamaVisionModelsDatalist && Array.isArray(visionModels) && visionModels.length > 0) {
      els.ollamaVisionModelsDatalist.textContent = '';
      visionModels.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m;
        els.ollamaVisionModelsDatalist.appendChild(opt);
      });
    }
  }

  async function resolveAndPersistActiveApiKey() {
    const creds = await window.StorageManager.getGeminiSettings();
    if (creds.aiProvider === 'ollama') {
      const ollamaUrl = (els.ollamaUrlInput && els.ollamaUrlInput.value.trim()) || creds.ollamaUrl || 'http://localhost:11434';
      const ollamaModel = (els.ollamaModelInput && els.ollamaModelInput.value.trim()) || creds.ollamaModel || 'qwen2.5:latest';
      const ollamaVisionModel = (els.ollamaVisionModelInput && els.ollamaVisionModelInput.value.trim()) || creds.ollamaVisionModel || 'qwen2.5vl:latest';
      await window.StorageManager.updateSettings({ aiProvider: 'ollama', ollamaUrl, ollamaModel, ollamaVisionModel });
      return {
        aiProvider: 'ollama',
        apiKey: '',
        model: ollamaModel,
        authConfig: { aiProvider: 'ollama', ollamaUrl, ollamaModel, ollamaVisionModel }
      };
    }

    const inlineVal = els.inlineApiKeyInput ? els.inlineApiKeyInput.value.trim() : '';
    const settingsVal = els.geminiApiKeyInput ? els.geminiApiKeyInput.value.trim() : '';
    const model = (els.geminiModelSelect && els.geminiModelSelect.value) || creds.model || 'gemini-2.5-flash';

    const rawCandidate = inlineVal || settingsVal || creds.apiKey || (currentState && currentState.geminiApiKey) || '';
    if (!rawCandidate) {
      return { aiProvider: 'cloud', apiKey: '', model, authConfig: '' };
    }

    const saved = await window.StorageManager.saveGeminiSettings({ apiKey: rawCandidate, model });
    if (currentState) {
      currentState.geminiApiKey = saved.geminiApiKey;
      currentState.geminiModel = saved.geminiModel;
    }
    if (els.geminiApiKeyInput && document.activeElement !== els.geminiApiKeyInput) {
      els.geminiApiKeyInput.value = saved.geminiApiKey;
    }
    if (els.inlineApiKeyInput && saved.geminiApiKey) {
      els.inlineApiKeyInput.value = '';
    }
    if (els.missingKeyInlineNotice && saved.geminiApiKey) {
      els.missingKeyInlineNotice.classList.add('hidden');
    }
    return {
      aiProvider: 'cloud',
      apiKey: saved.geminiApiKey,
      model: saved.geminiModel,
      authConfig: saved.geminiApiKey
    };
  }

  // AI PROMPT INTERPRETATION
  els.btnInterpretWithGemini.addEventListener('click', async () => {
    const prompt = els.aiPromptInput.value.trim();
    if (!prompt) {
      showStatus('Enter a research inquiry or text first.', true);
      els.aiPromptInput.focus();
      return;
    }

    const { aiProvider, apiKey, model, authConfig } = await resolveAndPersistActiveApiKey();

    if (aiProvider !== 'ollama' && !apiKey) {
      showStatus('Add an API key or switch to Local Ollama in Settings to interpret with AI.', true);
      if (els.missingKeyInlineNotice) {
        els.missingKeyInlineNotice.classList.remove('hidden');
      }
      if (els.inlineApiKeyInput) {
        els.inlineApiKeyInput.focus();
      }
      await refreshUI(true);
      return;
    }

    if (els.interpreterErrorBanner) {
      els.interpreterErrorBanner.classList.add('hidden');
      els.interpreterErrorBanner.textContent = '';
    }
    els.btnInterpretWithGemini.textContent = 'Analyzing...';
    els.btnInterpretWithGemini.disabled = true;
    showStatus(
      aiProvider === 'ollama'
        ? `Local Ollama (${model}) is generating domain keywords and web queries...`
        : 'AI is interpreting your inquiry into keywords, web queries, and DOM rules...',
      false,
      0
    );

    let res = null;
    try {
      res = await window.GeminiClient.interpretResearchPrompt(prompt, authConfig, model);
    } catch (err) {
      res = { ok: false, error: err.message };
    }

    els.btnInterpretWithGemini.textContent = 'Analyze with AI';
    els.btnInterpretWithGemini.disabled = false;

    if (!res || !res.ok) {
      const errMsg = (res && res.error) || 'Unknown error';
      if (els.interpreterErrorBanner) {
        els.interpreterErrorBanner.textContent = errMsg;
        els.interpreterErrorBanner.classList.remove('hidden');
      }
      if (activeProject && activeProject.aiStrategy && activeProject.aiStrategy.isLocalAutoPlan) {
        activeProject.aiStrategy = null;
        await window.StorageManager.updateProject(activeProject.id, { aiStrategy: null });
        renderStrategyPreview(null);
      }
      showStatus(`AI request failed: ${errMsg}`, true);
      await refreshUI(true);
      return;
    }

    const strat = res.strategy;

    if (aiProvider === 'ollama') {
      els.geminiModelBadge.textContent = `Ollama · ${res.usedModel || model}`;
    } else if (res.usedModel && res.usedModel !== model) {
      els.geminiModelBadge.textContent = res.usedModel;
    }

    await applyStrategyToScanner(strat, prompt, true);
    await refreshUI(true);
    const kwCount = (strat.keyConcepts || []).length;
    const qCount = (strat.webQueries || []).length;
    showStatus(`AI generated ${kwCount} keywords, ${qCount} web queries, and scanner rules.`);
  });

  // TEST & SAVE AI ENGINE (CLOUD API OR LOCAL OLLAMA)
  async function verifyAndSaveOllama() {
    const ollamaUrl = (els.ollamaUrlInput && els.ollamaUrlInput.value.trim()) || 'http://localhost:11434';
    const ollamaModel = (els.ollamaModelInput && els.ollamaModelInput.value.trim()) || 'qwen2.5:latest';
    const ollamaVisionModel = (els.ollamaVisionModelInput && els.ollamaVisionModelInput.value.trim()) || 'qwen2.5vl:latest';

    await window.StorageManager.updateSettings({
      aiProvider: 'ollama',
      ollamaUrl,
      ollamaModel,
      ollamaVisionModel
    });

    els.btnTestGeminiKey.textContent = 'Connecting...';
    els.btnTestGeminiKey.disabled = true;

    let res = null;
    try {
      res = await window.GeminiClient.testConnection({ aiProvider: 'ollama', ollamaUrl, ollamaModel });
    } catch (err) {
      res = { ok: false, error: err.message };
    }

    els.btnTestGeminiKey.textContent = 'Verify & Connect Ollama';
    els.btnTestGeminiKey.disabled = false;
    els.geminiTestFeedback.classList.remove('hidden');

    if (res && res.ok) {
      populateOllamaDatalists(res.availableModels, res.visionModels);
      const chosenTextModel = res.resolvedModel || ollamaModel;
      if (els.ollamaModelInput && chosenTextModel) {
        els.ollamaModelInput.value = chosenTextModel;
      }
      const chosenVisionModel = (res.visionModels && res.visionModels.length > 0 && !res.visionModels.includes(ollamaVisionModel))
        ? res.visionModels[0]
        : ollamaVisionModel;
      if (els.ollamaVisionModelInput && chosenVisionModel) {
        els.ollamaVisionModelInput.value = chosenVisionModel;
      }
      await window.StorageManager.updateSettings({
        aiProvider: 'ollama',
        ollamaUrl,
        ollamaModel: chosenTextModel,
        ollamaVisionModel: chosenVisionModel
      });
      els.geminiModelBadge.textContent = `Ollama · ${chosenTextModel}`;
      els.geminiTestFeedback.textContent = res.message || `Ollama connected (${chosenTextModel} ready).`;
      els.geminiTestFeedback.style.color = '#059669';
      showStatus(res.message || 'Local Ollama connected.');
      return true;
    } else {
      const errMsg = (res && res.error) || 'Unable to connect to local Ollama';
      els.geminiTestFeedback.textContent = `Ollama settings saved. Connection error: ${errMsg}`;
      els.geminiTestFeedback.style.color = '#dc2626';
      showStatus(`Ollama error: ${errMsg}`, true);
      return false;
    }
  }

  async function verifyAndSaveKey(rawKeyInput) {
    const creds = await window.StorageManager.getGeminiSettings();
    if (creds.aiProvider === 'ollama' && !rawKeyInput) {
      return verifyAndSaveOllama();
    }

    const rawKey = String(rawKeyInput || '').trim();
    const model = els.geminiModelSelect.value || 'gemini-2.5-flash';
    if (!rawKey) {
      els.geminiTestFeedback.textContent = 'Paste your AI API key first.';
      els.geminiTestFeedback.classList.remove('hidden');
      els.geminiTestFeedback.style.color = '#dc2626';
      showStatus('Paste your AI API key first.', true);
      return false;
    }

    await window.StorageManager.updateSettings({ aiProvider: 'cloud' });
    applyProviderModeUI('cloud');

    isVerifyingKey = true;
    clearTimeout(apiKeySaveTimer);

    // Persist immediately to local profile first
    const saved = await window.StorageManager.saveGeminiSettings({ apiKey: rawKey, model });
    if (currentState) {
      currentState.geminiApiKey = saved.geminiApiKey;
      currentState.geminiModel = saved.geminiModel;
    }
    els.geminiApiKeyInput.value = saved.geminiApiKey;
    els.geminiModelBadge.textContent = saved.geminiModel;
    if (els.missingKeyInlineNotice) {
      els.missingKeyInlineNotice.classList.add('hidden');
    }

    els.btnTestGeminiKey.textContent = 'Verifying...';
    els.btnTestGeminiKey.disabled = true;
    if (els.btnSaveInlineKey) {
      els.btnSaveInlineKey.textContent = 'Saving...';
      els.btnSaveInlineKey.disabled = true;
    }

    let res = null;
    try {
      res = await window.GeminiClient.testConnection(saved.geminiApiKey, saved.geminiModel);
    } catch (err) {
      res = { ok: false, error: err.message };
    }

    els.btnTestGeminiKey.textContent = 'Verify & Save';
    els.btnTestGeminiKey.disabled = false;
    if (els.btnSaveInlineKey) {
      els.btnSaveInlineKey.textContent = 'Save Key';
      els.btnSaveInlineKey.disabled = false;
    }
    isVerifyingKey = false;

    els.geminiTestFeedback.classList.remove('hidden');
    if (res && res.ok) {
      const activeModel = res.resolvedModel || saved.geminiModel;
      if (activeModel !== saved.geminiModel) {
        await window.StorageManager.saveGeminiSettings({ apiKey: saved.geminiApiKey, model: activeModel });
        els.geminiModelSelect.value = activeModel;
        els.geminiModelBadge.textContent = activeModel;
      }
      els.geminiTestFeedback.textContent = res.message || 'Key saved! AI API connection verified successfully.';
      els.geminiTestFeedback.style.color = '#059669';
      showStatus(res.message || 'AI API key verified and saved.');
      return true;
    } else {
      const errMsg = (res && res.error) || 'Connection test failed';
      els.geminiTestFeedback.textContent = `Key saved locally. Verification error: ${errMsg}`;
      els.geminiTestFeedback.style.color = '#dc2626';
      showStatus(`API key error: ${errMsg}`, true);
      return false;
    }
  }

  if (els.btnModeCloudApi) {
    els.btnModeCloudApi.addEventListener('click', async () => {
      await window.StorageManager.updateSettings({ aiProvider: 'cloud' });
      applyProviderModeUI('cloud');
      await refreshUI(true);
      showStatus('AI mode switched to Cloud API.');
    });
  }

  if (els.btnModeLocalOllama) {
    els.btnModeLocalOllama.addEventListener('click', async () => {
      const ollamaUrl = (els.ollamaUrlInput && els.ollamaUrlInput.value.trim()) || 'http://localhost:11434';
      const ollamaModel = (els.ollamaModelInput && els.ollamaModelInput.value.trim()) || 'qwen2.5:latest';
      const ollamaVisionModel = (els.ollamaVisionModelInput && els.ollamaVisionModelInput.value.trim()) || 'qwen2.5vl:latest';
      await window.StorageManager.updateSettings({ aiProvider: 'ollama', ollamaUrl, ollamaModel, ollamaVisionModel });
      applyProviderModeUI('ollama', ollamaModel);
      await refreshUI(true);
      showStatus('AI mode switched to Local Open AI (Ollama · $0).');
    });
  }

  if (els.btnDetectOllamaModels) {
    els.btnDetectOllamaModels.addEventListener('click', () => {
      verifyAndSaveOllama();
    });
  }

  function persistOllamaInputs() {
    const ollamaUrl = (els.ollamaUrlInput && els.ollamaUrlInput.value.trim()) || 'http://localhost:11434';
    const ollamaModel = (els.ollamaModelInput && els.ollamaModelInput.value.trim()) || 'qwen2.5:latest';
    const ollamaVisionModel = (els.ollamaVisionModelInput && els.ollamaVisionModelInput.value.trim()) || 'qwen2.5vl:latest';
    window.StorageManager.updateSettings({ ollamaUrl, ollamaModel, ollamaVisionModel });
    if (els.btnModeLocalOllama && els.btnModeLocalOllama.classList.contains('active') && els.geminiModelBadge) {
      els.geminiModelBadge.textContent = `Ollama · ${ollamaModel}`;
    }
  }

  if (els.ollamaUrlInput) els.ollamaUrlInput.addEventListener('change', persistOllamaInputs);
  if (els.ollamaModelInput) els.ollamaModelInput.addEventListener('change', persistOllamaInputs);
  if (els.ollamaVisionModelInput) els.ollamaVisionModelInput.addEventListener('change', persistOllamaInputs);

  els.btnTestGeminiKey.addEventListener('click', async () => {
    const creds = await window.StorageManager.getGeminiSettings();
    if (creds.aiProvider === 'ollama') {
      await verifyAndSaveOllama();
    } else {
      await verifyAndSaveKey(els.geminiApiKeyInput.value);
    }
  });

  if (els.btnSaveInlineKey) {
    els.btnSaveInlineKey.addEventListener('click', async () => {
      const val = els.inlineApiKeyInput ? els.inlineApiKeyInput.value.trim() : '';
      const ok = await verifyAndSaveKey(val);
      if (ok && els.inlineApiKeyInput) {
        els.inlineApiKeyInput.value = '';
      }
    });
  }

  if (els.inlineApiKeyInput) {
    els.inlineApiKeyInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (els.btnSaveInlineKey) els.btnSaveInlineKey.click();
      }
    });
  }

  // Auto-save on typing or pasting (debounced on input, immediate on change/blur)
  async function persistApiKeyInput() {
    if (isVerifyingKey) return;
    clearTimeout(apiKeySaveTimer);
    const val = els.geminiApiKeyInput.value.trim();
    const model = els.geminiModelSelect.value || 'gemini-2.5-flash';
    const saved = await window.StorageManager.saveGeminiSettings({ apiKey: val, model });
    if (currentState) {
      currentState.geminiApiKey = saved.geminiApiKey;
      currentState.geminiModel = saved.geminiModel;
    }
    els.geminiModelBadge.textContent = saved.geminiModel;
    if (els.missingKeyInlineNotice) {
      if (saved.geminiApiKey) {
        els.missingKeyInlineNotice.classList.add('hidden');
      } else {
        els.missingKeyInlineNotice.classList.remove('hidden');
      }
    }
    if (saved.geminiApiKey) {
      els.geminiTestFeedback.textContent = 'Key saved in local profile. Click "Verify & Save Key" to test.';
      els.geminiTestFeedback.classList.remove('hidden');
      els.geminiTestFeedback.style.color = '#059669';
    } else {
      els.geminiTestFeedback.classList.add('hidden');
    }
  }

  els.geminiApiKeyInput.addEventListener('input', () => {
    clearTimeout(apiKeySaveTimer);
    apiKeySaveTimer = setTimeout(persistApiKeyInput, 180);
  });
  els.geminiApiKeyInput.addEventListener('change', persistApiKeyInput);
  els.geminiApiKeyInput.addEventListener('blur', persistApiKeyInput);

  els.geminiModelSelect.addEventListener('change', async () => {
    const model = els.geminiModelSelect.value;
    const val = els.geminiApiKeyInput.value.trim();
    const patch = val ? { apiKey: val, model } : { model };
    const saved = await window.StorageManager.saveGeminiSettings(patch);
    if (currentState) {
      currentState.geminiModel = saved.geminiModel;
    }
    els.geminiModelBadge.textContent = saved.geminiModel;
  });

  if (els.btnToggleInterpreter) {
    els.btnToggleInterpreter.addEventListener('click', () => {
      setInterpreterEnabled(!isInterpreterEnabled());
    });
  }

  if (els.toggleSettingsInterpreter) {
    els.toggleSettingsInterpreter.addEventListener('change', () => {
      setInterpreterEnabled(els.toggleSettingsInterpreter.checked);
    });
  }

  if (els.btnQuickConfigKey) {
    els.btnQuickConfigKey.addEventListener('click', () => {
      switchView('settings');
      if (els.geminiApiKeyInput) {
        els.geminiApiKeyInput.focus();
      }
    });
  }

  // CONTINUOUS SCAN TOGGLE
  els.btnScanActive.addEventListener('click', async () => {
    clearTimeout(exprSaveTimer);
    let exprs = els.expressionsInput.value.trim();
    if (!exprs && !isContinuousScanRunning && isInterpreterEnabled() && els.aiPromptInput.value.trim()) {
      const localPlan = window.ExpressionEngine && window.ExpressionEngine.buildScrapingPlanFromQuestion
        ? window.ExpressionEngine.buildScrapingPlanFromQuestion(els.aiPromptInput.value.trim())
        : null;
      if (localPlan) {
        await applyStrategyToScanner(localPlan, els.aiPromptInput.value.trim(), true);
        exprs = els.expressionsInput.value.trim();
      }
    }
    if (!exprs && !isContinuousScanRunning) {
      showStatus(
        isInterpreterEnabled()
          ? 'Enter an inquiry in the Interpreter or a rule in the Scanner first.'
          : 'Enter at least one extraction rule in the Scanner first.',
        true
      );
      if (isInterpreterEnabled()) {
        els.aiPromptInput.focus();
      } else {
        els.expressionsInput.focus();
      }
      return;
    }

    if (activeProject && exprs) {
      activeProject.expressions = exprs;
      await window.StorageManager.updateProject(activeProject.id, { expressions: exprs });
    }

    els.btnScanActive.disabled = true;
    showStatus(isContinuousScanRunning ? 'Stopping scan...' : 'Starting continuous scanner...', false, 0);

    try {
      const res = await browser.runtime.sendMessage({
        type: 'TOGGLE_CONTINUOUS_SCAN_ACTIVE_TAB',
        expressions: exprs,
        highlight: true,
        minScore: getActiveMinScore(),
        targetElements: getActiveTargetElements(),
        includeVisuals: els.toggleIncludeVisuals ? els.toggleIncludeVisuals.checked : true,
        autoAiOcr: els.toggleAutoAiOcr ? els.toggleAutoAiOcr.checked : false,
        autoSave: true,
        projectId: activeProject ? activeProject.id : null
      });

      if (!res || !res.ok) {
        showStatus((res && res.error) || 'Unable to scan this page.', true);
        updateContinuousScanButton(false);
        return;
      }

      updateContinuousScanButton(res.active);
      if (res.active) {
        updateLiveMatchesCount(res.totalInitial || 0);
      }
      await refreshUI(true);

      if (res.active) {
        showStatus(`Continuous scan active. ${res.totalInitial || 0} initial blocks found.`);
      } else {
        showStatus('Continuous scan stopped for active tab.');
      }
    } catch (err) {
      showStatus((err && err.message) || 'Unable to scan this page.', true);
      updateContinuousScanButton(false);
    } finally {
      els.btnScanActive.disabled = false;
    }
  });

  const activeTabSourceFilters = new Set();

  function getActiveTabSourceFilters() {
    return Array.from(activeTabSourceFilters);
  }

  if (els.tabOpenerFiltersBar) {
    els.tabOpenerFiltersBar.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-source-filter]');
      if (!chip) return;
      const key = chip.getAttribute('data-source-filter');
      if (!key) return;
      if (activeTabSourceFilters.has(key)) {
        activeTabSourceFilters.delete(key);
        chip.classList.remove('active');
      } else {
        activeTabSourceFilters.add(key);
        chip.classList.add('active');
      }
    });
  }

  function getTopResultsCount() {
    const raw = els.topResultsCountInput ? Number(els.topResultsCountInput.value) : 5;
    if (!Number.isFinite(raw) || raw < 1) return 5;
    return Math.min(50, Math.floor(raw));
  }

  function updateQueryTopButtonsLabels() {
    const count = getTopResultsCount();
    lastStrategySig = '';
    document.querySelectorAll('.query-top-n-btn').forEach(btn => {
      btn.textContent = `Top ${count}`;
      btn.title = `Open the top ${count} search results for this query`;
    });
  }

  async function runScanAllOpenTabs() {
    clearTimeout(exprSaveTimer);
    let exprs = els.expressionsInput.value.trim();
    if (!exprs && isInterpreterEnabled() && els.aiPromptInput.value.trim()) {
      const localPlan = window.ExpressionEngine && window.ExpressionEngine.buildScrapingPlanFromQuestion
        ? window.ExpressionEngine.buildScrapingPlanFromQuestion(els.aiPromptInput.value.trim())
        : null;
      if (localPlan) {
        await applyStrategyToScanner(localPlan, els.aiPromptInput.value.trim(), true);
        exprs = els.expressionsInput.value.trim();
      }
    }
    if (!exprs) {
      showStatus('Enter an inquiry or expression before scanning open tabs.', true);
      return;
    }
    if (els.btnScanAllTabs) els.btnScanAllTabs.disabled = true;
    showStatus('Scanning all open tabs with rate limiting...', false, 0);
    try {
      const res = await browser.runtime.sendMessage({
        type: 'SCAN_ALL_OPEN_TABS',
        expressions: exprs,
        highlight: true,
        minScore: getActiveMinScore(),
        targetElements: getActiveTargetElements(),
        includeVisuals: els.toggleIncludeVisuals ? els.toggleIncludeVisuals.checked : true,
        autoSave: true,
        projectId: activeProject ? activeProject.id : null
      });
      await refreshUI(true);
      if (res && res.ok) {
        showStatus(`Scan complete: ${res.totalMatches} extracts found across ${res.scannedTabs} tabs.`);
      } else {
        showStatus((res && res.error) || 'Error scanning open tabs.', true);
      }
    } catch (err) {
      showStatus(`Error scanning open tabs: ${(err && err.message) || 'Unknown error'}`, true);
    } finally {
      if (els.btnScanAllTabs) els.btnScanAllTabs.disabled = false;
    }
  }

  async function handleOpenTopResults({ query = '', engine = 'duckduckgo' } = {}) {
    const effectiveQuery = String(
      query || (els.tabOpenerQueryInput ? els.tabOpenerQueryInput.value : '')
    ).trim();
    const count = getTopResultsCount();
    if (els.topResultsCountInput) {
      els.topResultsCountInput.value = String(count);
    }
    const autoScan = Boolean(els.toggleAutoScanTopResults && els.toggleAutoScanTopResults.checked);

    if (els.btnOpenTopResults) els.btnOpenTopResults.disabled = true;
    showStatus(
      effectiveQuery
        ? `Searching and opening top ${count} results...`
        : `Opening top ${count} results from active search tab...`,
      false,
      0
    );

    try {
      const res = await browser.runtime.sendMessage({
        type: 'OPEN_TOP_SEARCH_RESULTS',
        query: effectiveQuery,
        engine,
        count,
        sourceFilters: getActiveTabSourceFilters(),
        waitForLoad: autoScan
      });
      if (!res || !res.ok) {
        showStatus((res && res.error) || 'Could not extract search result links.', true);
        return;
      }
      if (els.tabOpenerResultsWrap && els.tabOpenerResultsList && Array.isArray(res.urls)) {
        els.tabOpenerResultsList.textContent = '';
        res.urls.forEach((u, idx) => {
          const item = document.createElement('div');
          item.className = 'tab-opener-url-item';
          item.title = u;
          item.textContent = `${idx + 1}) ${u}`;
          els.tabOpenerResultsList.appendChild(item);
        });
        els.tabOpenerResultsWrap.classList.toggle('hidden', res.urls.length === 0);
      }
      if (autoScan) {
        showStatus(`Opened ${res.openedCount} tabs. Scanning all open tabs...`, false, 0);
        await runScanAllOpenTabs();
      } else {
        showStatus(`Opened ${res.openedCount} search result tabs in background.`);
      }
    } catch (err) {
      showStatus(`Error opening search results: ${err.message}`, true);
    } finally {
      if (els.btnOpenTopResults) els.btnOpenTopResults.disabled = false;
    }
  }

  if (els.topResultsCountInput) {
    els.topResultsCountInput.addEventListener('input', updateQueryTopButtonsLabels);
    els.topResultsCountInput.addEventListener('change', () => {
      els.topResultsCountInput.value = String(getTopResultsCount());
      updateQueryTopButtonsLabels();
    });
    els.topResultsCountInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleOpenTopResults();
      }
    });
  }

  if (els.tabOpenerQueryInput) {
    els.tabOpenerQueryInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleOpenTopResults();
      }
    });
  }

  if (els.btnOpenTopResults) {
    els.btnOpenTopResults.addEventListener('click', () => handleOpenTopResults());
  }

  // Scan open tabs
  els.btnScanAllTabs.addEventListener('click', runScanAllOpenTabs);

  // Clip selection
  els.btnClipSelection.addEventListener('click', async () => {
    try {
      const res = await browser.runtime.sendMessage({
        type: 'CLIP_ACTIVE_SELECTION',
        projectId: activeProject ? activeProject.id : null
      });
      if (res && res.ok) {
        await refreshUI(true);
        showStatus('Selected text saved to dossier.');
      } else {
        showStatus((res && res.error) || 'Please select text on the webpage first.', true);
      }
    } catch (err) {
      showStatus((err && err.message) || 'Unable to clip selection from this page.', true);
    }
  });

  // Clear highlights
  els.btnClearHighlights.addEventListener('click', async () => {
    try {
      await browser.runtime.sendMessage({ type: 'CLEAR_ACTIVE_HIGHLIGHTS' });
      showStatus('Highlights cleared from webpage.');
    } catch (err) {
      showStatus((err && err.message) || 'Unable to clear highlights on this page.', true);
    }
  });

  // Visual / Graphics hybrid toggles & explicit AI OCR scan
  if (els.toggleIncludeVisuals) {
    els.toggleIncludeVisuals.addEventListener('change', async () => {
      const includeVisuals = els.toggleIncludeVisuals.checked;
      if (currentState) {
        if (!currentState.settings) currentState.settings = {};
        currentState.settings.includeLocalVisuals = includeVisuals;
      }
      await window.StorageManager.updateSettings({ includeLocalVisuals: includeVisuals });
      if (activeProject && activeProject.aiStrategy) {
        const targets = new Set(
          Array.isArray(activeProject.aiStrategy.targetElements) && activeProject.aiStrategy.targetElements.length > 0
            ? activeProject.aiStrategy.targetElements
            : ['paragraphs', 'quotes_comments', 'lists', 'tables', 'visuals']
        );
        if (includeVisuals) {
          targets.add('visuals');
        } else if (targets.size > 1) {
          targets.delete('visuals');
        }
        activeProject.aiStrategy.targetElements = Array.from(targets);
        lastStrategySig = '';
        renderTargetElementsBar(activeProject.aiStrategy);
        await window.StorageManager.updateProject(activeProject.id, { aiStrategy: activeProject.aiStrategy });
      }
      showStatus(includeVisuals ? 'Local captions & SVG text enabled.' : 'Local visual text disabled.');
    });
  }

  if (els.toggleAutoAiOcr) {
    els.toggleAutoAiOcr.addEventListener('change', async () => {
      await window.StorageManager.updateSettings({ autoAiOcr: els.toggleAutoAiOcr.checked });
      showStatus(els.toggleAutoAiOcr.checked ? 'Auto AI OCR enabled for scans.' : 'Auto AI OCR disabled (manual only).');
    });
  }

  if (els.btnScanVisualsAi) {
    els.btnScanVisualsAi.addEventListener('click', async () => {
      const { aiProvider, apiKey } = await resolveAndPersistActiveApiKey();
      if (aiProvider !== 'ollama' && !apiKey) {
        showStatus('Configure an AI API key or Local Ollama in Settings to use Visual OCR.', true);
        if (els.missingKeyInlineNotice) els.missingKeyInlineNotice.classList.remove('hidden');
        if (els.inlineApiKeyInput) els.inlineApiKeyInput.focus();
        return;
      }

      els.btnScanVisualsAi.disabled = true;
      els.btnScanVisualsAi.textContent = 'Scanning Visuals...';
      showStatus('Analyzing page visuals, charts & SVG with AI OCR...', false, 0);

      try {
        const res = await browser.runtime.sendMessage({
          type: 'SCAN_PAGE_VISUALS_AI',
          expressions: els.expressionsInput.value.trim(),
          projectId: activeProject ? activeProject.id : null,
          filterByExpressions: false,
          autoSave: true,
          highlight: true,
          maxItems: 5
        });

        await refreshUI(true);
        if (res && res.ok) {
          if (res.scannedCount === 0) {
            showStatus('No eligible images, charts, SVG or PDF found on active tab.');
          } else {
            showStatus(`Visual OCR complete: ${res.matchedCount} saved from ${res.scannedCount} scanned visuals.`);
          }
        } else {
          showStatus((res && res.error) || 'Visual OCR scan failed.', true);
        }
      } catch (err) {
        showStatus(`Visual OCR error: ${err.message}`, true);
      } finally {
        els.btnScanVisualsAi.disabled = false;
        els.btnScanVisualsAi.textContent = 'Scan Visuals & OCR (AI)';
      }
    });
  }

  // Project Management (Switch, Rename, Create, Delete)
  els.projectSelect.addEventListener('change', async () => {
    cancelInlineRename();
    lastStrategySig = '';
    lastSavedItemsSig = '';
    await window.StorageManager.setActiveProject(els.projectSelect.value);
    browser.runtime.sendMessage({ type: 'REFRESH_BADGE' }).catch(() => {});
    await refreshUI(false);
  });

  // Direct inline dossier rename on double-click
  let isRenaming = false;

  function startInlineRename() {
    if (!activeProject || isRenaming) return;
    isRenaming = true;
    els.newProjectPanel.classList.add('hidden');
    els.projectSelect.classList.add('hidden');
    els.projectRenameInline.classList.remove('hidden');
    els.projectRenameInline.value = activeProject.name || '';
    els.projectRenameInline.focus();
    els.projectRenameInline.select();
  }

  async function saveInlineRename() {
    if (!isRenaming || !activeProject) return;
    isRenaming = false;
    const newName = els.projectRenameInline.value.trim();
    els.projectRenameInline.classList.add('hidden');
    els.projectSelect.classList.remove('hidden');

    if (newName && newName !== activeProject.name) {
      await window.StorageManager.updateProject(activeProject.id, { name: newName });
      showStatus(`Dossier renamed to "${newName}".`);
      await refreshUI(true);
    }
  }

  function cancelInlineRename() {
    if (!isRenaming) return;
    isRenaming = false;
    els.projectRenameInline.classList.add('hidden');
    els.projectSelect.classList.remove('hidden');
  }

  let lastSelectClickTime = 0;
  els.projectSelect.addEventListener('mousedown', (e) => {
    const now = Date.now();
    if (now - lastSelectClickTime < 380) {
      e.preventDefault();
      e.stopPropagation();
      lastSelectClickTime = 0;
      startInlineRename();
      return;
    }
    lastSelectClickTime = now;
  });

  els.projectSelect.addEventListener('dblclick', (e) => {
    e.preventDefault();
    e.stopPropagation();
    startInlineRename();
  });

  if (els.projectSelectContainer) {
    els.projectSelectContainer.addEventListener('dblclick', (e) => {
      e.preventDefault();
      startInlineRename();
    });
  }

  els.projectRenameInline.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveInlineRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelInlineRename();
    }
  });

  els.projectRenameInline.addEventListener('blur', () => {
    if (isRenaming) {
      saveInlineRename();
    }
  });

  // Create new dossier
  els.btnNewProject.addEventListener('click', () => {
    cancelInlineRename();
    els.newProjectPanel.classList.toggle('hidden');
    if (!els.newProjectPanel.classList.contains('hidden')) {
      els.newProjectName.focus();
    }
  });

  els.btnCancelNewProject.addEventListener('click', () => {
    els.newProjectPanel.classList.add('hidden');
    els.newProjectName.value = '';
  });

  async function handleConfirmNewProject() {
    const name = els.newProjectName.value.trim();
    if (!name) return;
    await window.StorageManager.createProject({ name });
    els.newProjectName.value = '';
    els.newProjectPanel.classList.add('hidden');
    browser.runtime.sendMessage({ type: 'REFRESH_BADGE' }).catch(() => {});
    await refreshUI(false);
    showStatus(`Dossier "${name}" created.`);
  }

  els.btnConfirmNewProject.addEventListener('click', handleConfirmNewProject);
  els.newProjectName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleConfirmNewProject();
    } else if (e.key === 'Escape') {
      els.newProjectPanel.classList.add('hidden');
    }
  });

  // Delete current dossier
  els.btnDeleteProject.addEventListener('click', async () => {
    if (!activeProject) return;
    cancelInlineRename();
    lastStrategySig = '';
    lastSavedItemsSig = '';
    await window.StorageManager.deleteProject(activeProject.id);
    browser.runtime.sendMessage({ type: 'REFRESH_BADGE' }).catch(() => {});
    await refreshUI(false);
  });

  // Export
  async function exportFile(format) {
    if (!activeProject || !activeProject.items || activeProject.items.length === 0) {
      showStatus('No extracts to export in this dossier.', true);
      return;
    }
    const groupBy = els.groupBySelect.value || 'expression';
    try {
      const res = await window.Exporter.downloadProjectFile(activeProject, format, { groupBy });
      showStatus(`Dossier "${res.filename}" exported.`);
    } catch (err) {
      showStatus(`Export error: ${err.message}`, true);
    }
  }

  els.btnExportMd.addEventListener('click', () => exportFile('md'));
  els.btnExportJson.addEventListener('click', () => exportFile('json'));
  els.btnExportCsv.addEventListener('click', () => exportFile('csv'));

  els.btnClearItems.addEventListener('click', async () => {
    if (!activeProject) return;
    await window.StorageManager.clearProjectItems(activeProject.id);
    browser.runtime.sendMessage({ type: 'REFRESH_BADGE' }).catch(() => {});
    await refreshUI(true);
    showStatus('Dossier cleared.');
  });

  els.filterSavedInput.addEventListener('input', () => {
    clearTimeout(docsFilterTimer);
    docsFilterTimer = setTimeout(() => {
      visibleDocsLimit = 40;
      renderSavedItems();
    }, 140);
  });

  // Debounced input persistence for Interpreter inquiry (waits for Analyze with AI click for strategy generation)
  els.aiPromptInput.addEventListener('input', () => {
    clearTimeout(promptSaveTimer);
    promptSaveTimer = setTimeout(async () => {
      const promptVal = els.aiPromptInput.value.trim();
      if (activeProject) {
        activeProject.aiPrompt = promptVal;
        await window.StorageManager.updateProject(activeProject.id, { aiPrompt: promptVal });
      }
    }, 300);
  });

  if (els.btnAddScannerKeyword && els.scannerKeywordAddInput) {
    els.btnAddScannerKeyword.addEventListener('click', () => {
      addScannerKeywordOrExclusion(els.scannerKeywordAddInput.value);
    });
    els.scannerKeywordAddInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addScannerKeywordOrExclusion(els.scannerKeywordAddInput.value);
      }
    });
  }

  els.expressionsInput.addEventListener('input', () => {
    autoResizeExpressionsInput();
    clearTimeout(exprSaveTimer);
    exprSaveTimer = setTimeout(async () => {
      if (activeProject) {
        const rawExpr = els.expressionsInput.value;
        activeProject.expressions = rawExpr;
        let strategy = activeProject.aiStrategy;
        if (window.ExpressionEngine && window.ExpressionEngine.extractTermsFromExpressions) {
          const parsed = window.ExpressionEngine.extractTermsFromExpressions(rawExpr);
          strategy = ensureActiveStrategy();
          strategy.keyConcepts = parsed.keywords;
          strategy.exclusions = parsed.exclusions;
          strategy.primaryExpressions = window.ExpressionEngine.splitExpressions(rawExpr);
          strategy.compiledExpressions = rawExpr;
          renderStrategyPreview(strategy);
        }
        await window.StorageManager.updateProject(activeProject.id, {
          expressions: rawExpr,
          aiStrategy: strategy
        });
      }
    }, 400);
  });

  // Runtime updates (coalesce rapid bursts)
  if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.onMessage) {
    browser.runtime.onMessage.addListener((msg) => {
      if (!msg || !msg.type) return;
      if (msg.type === 'OCR_NOTIFICATION' && msg.message) {
        showStatus(msg.message, Boolean(msg.isError));
        return;
      }
      if (msg.type === 'STATE_UPDATED') {
        if (msg.reason === 'continuous_matches_added') {
          if (typeof msg.totalSoFar === 'number') {
            updateLiveMatchesCount(msg.totalSoFar);
          }
          showStatus('New extracts captured live from page.');
        } else if (msg.reason === 'visual_ocr_saved') {
          showStatus('Visual OCR extracts added to dossier.');
        }
        clearTimeout(stateRefreshTimer);
        stateRefreshTimer = setTimeout(() => refreshUI(true), 60);
      }
    });
  }

  if (typeof browser !== 'undefined' && browser.tabs) {
    if (browser.tabs.onActivated) {
      browser.tabs.onActivated.addListener(() => checkActiveTabStatus());
    }
    if (browser.tabs.onUpdated) {
      browser.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
        if (tab && tab.active && changeInfo && changeInfo.status === 'complete') {
          checkActiveTabStatus();
        }
      });
    }
  }

  if (typeof browser !== 'undefined' && browser.windows && browser.windows.onFocusChanged) {
    browser.windows.onFocusChanged.addListener((windowId) => {
      if (windowId !== browser.windows.WINDOW_ID_NONE) {
        checkActiveTabStatus();
      }
    });
  }

  // Init
  refreshUI(false);
  checkActiveTabStatus();
})();
