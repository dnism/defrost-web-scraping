/**
 * Defrost Quick Popup Controller (English Edition)
 */
(function () {
  'use strict';

  const els = {
    btnOpenSidebar: document.getElementById('btnOpenSidebar'),
    popupProjectSelect: document.getElementById('popupProjectSelect'),
    popupAiPrompt: document.getElementById('popupAiPrompt'),
    btnPopupGemini: document.getElementById('btnPopupGemini'),
    btnPopupScanActive: document.getElementById('btnPopupScanActive'),
    popupScanLabel: document.getElementById('popupScanLabel'),
    btnPopupClip: document.getElementById('btnPopupClip'),
    popupStatus: document.getElementById('popupStatus'),
    popupCount: document.getElementById('popupCount'),
    btnPopupMd: document.getElementById('btnPopupMd'),
    btnPopupJson: document.getElementById('btnPopupJson'),
    btnPopupCsv: document.getElementById('btnPopupCsv')
  };

  let activeProject = null;
  let isContinuousActive = false;
  let loadedPromptText = '';

  function showStatus(msg, isError = false) {
    els.popupStatus.textContent = msg;
    els.popupStatus.classList.remove('hidden');
    els.popupStatus.classList.toggle('is-error', Boolean(isError));
  }

  function updatePopupButton(active) {
    isContinuousActive = Boolean(active);
    els.btnPopupScanActive.classList.toggle('btn-scan-running', isContinuousActive);
    els.popupScanLabel.textContent = isContinuousActive ? 'Stop scan' : 'Continuous scan';
  }

  async function initPopup(preservePrompt = false) {
    const state = await window.StorageManager.loadState();
    activeProject = state.projects.find(p => p.id === state.activeProjectId) || state.projects[0];

    els.popupProjectSelect.textContent = '';
    const frag = document.createDocumentFragment();
    for (const proj of state.projects) {
      const opt = document.createElement('option');
      opt.value = proj.id;
      opt.textContent = `${proj.name} (${(proj.items || []).length})`;
      if (proj.id === activeProject.id) opt.selected = true;
      frag.appendChild(opt);
    }
    els.popupProjectSelect.appendChild(frag);

    if (!preservePrompt) {
      loadedPromptText = (activeProject.aiPrompt || activeProject.expressions || '').trim();
      els.popupAiPrompt.value = activeProject.aiPrompt || activeProject.expressions || '';
    }
    els.popupCount.textContent = String((activeProject.items || []).length);

    try {
      const statusRes = await browser.runtime.sendMessage({ type: 'GET_ACTIVE_TAB_CONTINUOUS_STATUS' });
      if (statusRes && statusRes.ok) {
        updatePopupButton(statusRes.active);
      }
    } catch (_) {}
  }

  els.popupProjectSelect.addEventListener('change', async () => {
    await window.StorageManager.setActiveProject(els.popupProjectSelect.value);
    browser.runtime.sendMessage({ type: 'REFRESH_BADGE' }).catch(() => {});
    await initPopup();
  });

  els.btnOpenSidebar.addEventListener('click', async () => {
    try {
      if (browser.sidebarAction && browser.sidebarAction.open) {
        await browser.sidebarAction.open();
        window.close();
      } else {
        showStatus('Open View > Sidebar > Defrost');
      }
    } catch (_) {
      showStatus('Open View > Sidebar > Defrost');
    }
  });

  // Fast AI prompt interpretation (Cloud API or Local Ollama)
  els.btnPopupGemini.addEventListener('click', async () => {
    const prompt = els.popupAiPrompt.value.trim();
    if (!prompt) {
      showStatus('Enter a research inquiry first.', true);
      return;
    }
    const creds = await window.StorageManager.getGeminiSettings();
    const isOllama = creds.aiProvider === 'ollama';
    if (!isOllama && !creds.apiKey) {
      showStatus('API key missing. Open Defrost sidebar to configure.', true);
      return;
    }

    els.btnPopupGemini.textContent = 'Analyzing...';
    els.btnPopupGemini.disabled = true;

    let res = null;
    try {
      const authArg = isOllama ? creds : creds.apiKey;
      const modelArg = isOllama ? creds.ollamaModel : (creds.model || 'gemini-2.5-flash');
      res = await window.GeminiClient.interpretResearchPrompt(
        prompt,
        authArg,
        modelArg
      );
    } catch (err) {
      res = { ok: false, error: err && err.message ? err.message : 'AI interpretation error.' };
    } finally {
      els.btnPopupGemini.textContent = 'Analyze with AI';
      els.btnPopupGemini.disabled = false;
    }

    if (res && res.ok && res.strategy) {
      const exprs = res.strategy.compiledExpressions || (res.strategy.primaryExpressions || []).join('\n');
      if (activeProject) {
        activeProject.aiPrompt = prompt;
        activeProject.aiStrategy = res.strategy;
        activeProject.expressions = exprs;
        loadedPromptText = prompt;
        await window.StorageManager.updateProject(activeProject.id, {
          aiPrompt: prompt,
          aiStrategy: res.strategy,
          expressions: exprs
        });
      }
      showStatus(`AI generated ${(res.strategy.keyConcepts || []).length} keywords. Click Continuous scan.`);
    } else {
      showStatus((res && res.error) || 'AI interpretation error.', true);
    }
  });

  // Toggle Continuous Scan
  els.btnPopupScanActive.addEventListener('click', async () => {
    const inputVal = els.popupAiPrompt.value.trim();
    const userEditedPrompt = inputVal !== loadedPromptText;
    const exprs = (userEditedPrompt && inputVal)
      ? inputVal
      : ((activeProject && activeProject.expressions) ? activeProject.expressions : inputVal);

    if (!exprs && !isContinuousActive) {
      showStatus('Enter an inquiry or rule first.', true);
      return;
    }

    if (activeProject && userEditedPrompt && inputVal) {
      activeProject.expressions = inputVal;
      loadedPromptText = inputVal;
      await window.StorageManager.updateProject(activeProject.id, { expressions: inputVal });
    }

    els.btnPopupScanActive.disabled = true;
    try {
      const res = await browser.runtime.sendMessage({
        type: 'TOGGLE_CONTINUOUS_SCAN_ACTIVE_TAB',
        expressions: exprs,
        highlight: true,
        autoSave: true,
        projectId: activeProject ? activeProject.id : null
      });

      await initPopup(true);
      if (res && res.ok) {
        updatePopupButton(res.active);
        showStatus(res.active ? 'Continuous scan active on page.' : 'Scanner stopped.');
      } else {
        showStatus((res && res.error) || 'Error activating scan.', true);
      }
    } catch (err) {
      showStatus((err && err.message) || 'Error activating scan.', true);
    } finally {
      els.btnPopupScanActive.disabled = false;
    }
  });

  els.btnPopupClip.addEventListener('click', async () => {
    try {
      const res = await browser.runtime.sendMessage({
        type: 'CLIP_ACTIVE_SELECTION',
        projectId: activeProject ? activeProject.id : null
      });
      await initPopup(true);
      if (res && res.ok) {
        showStatus('Selected text clipped to dossier.');
      } else {
        showStatus((res && res.error) || 'Select text on the webpage first.', true);
      }
    } catch (err) {
      showStatus((err && err.message) || 'Select text on the webpage first.', true);
    }
  });

  async function quickExport(format) {
    await initPopup(true);
    if (!activeProject || !activeProject.items || activeProject.items.length === 0) {
      showStatus('No extracts to export.', true);
      return;
    }
    try {
      const res = await window.Exporter.downloadProjectFile(activeProject, format, { groupBy: 'expression' });
      showStatus(`Exported: ${res.filename}`);
    } catch (err) {
      showStatus(`Export error: ${(err && err.message) || 'Failed to export'}`, true);
    }
  }

  els.btnPopupMd.addEventListener('click', () => quickExport('md'));
  els.btnPopupJson.addEventListener('click', () => quickExport('json'));
  els.btnPopupCsv.addEventListener('click', () => quickExport('csv'));

  if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.onMessage) {
    browser.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === 'STATE_UPDATED') {
        initPopup(true);
      }
    });
  }

  initPopup();
})();
