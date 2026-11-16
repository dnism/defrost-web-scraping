/**
 * LexiScrape File Exporter
 * Genera file strutturati e descrittivi (.md, .json, .csv) che organizzano
 * gli estratti per espressione/keyword, fonte/dominio, tag o rilevanza,
 * includendo bibliografia delle fonti e metadati di conformità legale.
 */
(function (root) {
  'use strict';

  function slugify(str) {
    return String(str || 'ricerca')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'ricerca';
  }

  function buildSourcesCatalog(items) {
    const map = new Map();
    for (const item of items) {
      const src = item.source || {};
      const key = src.canonicalUrl || src.url || 'sconosciuta';
      if (!map.has(key)) {
        map.set(key, {
          url: src.url || key,
          canonicalUrl: src.canonicalUrl || key,
          title: src.title || 'Senza titolo',
          domain: src.domain || 'locale',
          author: src.author || 'Non specificato',
          publishedDate: src.publishedDate || 'N/D',
          siteName: src.siteName || src.domain || '',
          license: src.license || 'Non specificata (uso citazione/ricerca)',
          schemaType: src.schemaType || '',
          extractCount: 0
        });
      }
      map.get(key).extractCount++;
    }
    return Array.from(map.values());
  }

  /**
   * Raggruppa gli estratti secondo la modalità scelta:
   * - 'expression': per espressione/keyword corrispondente
   * - 'domain': per sito/dominio di provenienza
   * - 'tag': per tag assegnato dall'utente
   * - 'score': lista unica ordinata per rilevanza decrescente
   */
  function groupItems(items, groupBy = 'expression') {
    const sorted = [...items].sort((a, b) => (b.score || 0) - (a.score || 0));
    const groups = new Map();

    if (groupBy === 'score' || groupBy === 'chronological') {
      const list = groupBy === 'chronological'
        ? [...items].sort((a, b) => String(b.extractedAt).localeCompare(String(a.extractedAt)))
        : sorted;
      groups.set(groupBy === 'chronological' ? 'Ordine Cronologico' : 'Tutti gli estratti per Rilevanza', list);
      return groups;
    }

    for (const item of sorted) {
      let keys = [];
      if (groupBy === 'expression') {
        keys = (item.matchedExpressions && item.matchedExpressions.length > 0)
          ? item.matchedExpressions
          : ['Selezione Manuale / Generica'];
      } else if (groupBy === 'domain') {
        keys = [(item.source && item.source.domain) || 'Fonte sconosciuta'];
      } else if (groupBy === 'tag') {
        keys = (item.tags && item.tags.length > 0) ? item.tags : ['Senza Tag'];
      } else {
        keys = ['Estratti'];
      }

      for (const k of keys) {
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(item);
      }
    }

    return groups;
  }

  /**
   * Evidenzia in grassetto Markdown i termini trovati all'interno del testo estratto
   */
  function highlightTermsMarkdown(text, terms) {
    if (!text || !Array.isArray(terms) || terms.length === 0) return text;
    const valid = Array.from(new Set(terms.map(t => t.trim()).filter(t => t.length >= 3)))
      .sort((a, b) => b.length - a.length)
      .slice(0, 12);
    if (valid.length === 0) return text;

    const escaped = valid.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    try {
      const re = new RegExp(`(${escaped.join('|')})`, 'gi');
      return text.replace(re, '**$1**');
    } catch (_) {
      return text;
    }
  }

  /**
   * Genera il documento Markdown (.md) completo di YAML frontmatter,
   * sommario, bibliografia delle fonti e sezioni organizzate.
   */
  function generateMarkdown(project, options = {}) {
    const groupBy = options.groupBy || 'expression';
    const items = Array.isArray(project.items) ? project.items : [];
    const sources = buildSourcesCatalog(items);
    const groups = groupItems(items, groupBy);
    const nowIso = new Date().toISOString();

    const domains = Array.from(new Set(sources.map(s => s.domain)));
    const exprList = (project.expressions || '')
      .split(/[\n;,]+/)
      .map(s => s.trim())
      .filter(Boolean);

    const lines = [];

    // 1. YAML Frontmatter
    lines.push('---');
    lines.push(`title: "${(project.name || 'Research Report').replace(/"/g, '\\"')}"`);
    lines.push(`project_id: "${project.id || ''}"`);
    lines.push(`exported_at: "${nowIso}"`);
    lines.push(`grouping_mode: "${groupBy}"`);
    lines.push(`total_extracts: ${items.length}`);
    lines.push(`unique_sources: ${sources.length}`);
    lines.push(`domains: [${domains.map(d => `"${d}"`).join(', ')}]`);
    lines.push(`expressions: [${exprList.map(e => `"${e.replace(/"/g, '\\"')}"`).join(', ')}]`);
    lines.push('legal_compliance: "Public web content extracted with source attribution and study license"');
    lines.push('---');
    lines.push('');

    // 2. Title & Description
    lines.push(`# ${project.name || 'Research Report'}`);
    lines.push('');
    if (project.description) {
      lines.push(`> ${project.description}`);
      lines.push('');
    }

    lines.push('## Dossier Summary');
    lines.push('');
    lines.push(`- **Generated at:** ${new Date(nowIso).toUTCString()}`);
    lines.push(`- **Configured expressions / keywords:** ${exprList.length > 0 ? exprList.map(e => `\`${e}\``).join(', ') : '_None (manual clip)_'}`);
    lines.push(`- **Total informational extracts:** ${items.length}`);
    lines.push(`- **Distinct web sources:** ${sources.length} (${domains.join(', ') || 'N/A'})`);
    lines.push(`- **File grouping mode:** \`${groupBy}\``);
    lines.push('');

    // 3. Table of Contents
    if (groups.size > 0) {
      lines.push('## Table of Contents');
      lines.push('');
      let secIdx = 1;
      for (const [groupName, groupItemsList] of groups.entries()) {
        lines.push(`${secIdx}. **${groupName}** _(${groupItemsList.length} extracts)_`);
        secIdx++;
      }
      lines.push('');
    }

    // 4. Organized Extracts
    lines.push('---');
    lines.push('');
    lines.push('## Organized Extracts');
    lines.push('');

    if (items.length === 0) {
      lines.push('_No extracts present in this dossier._');
      lines.push('');
    } else {
      let groupIndex = 1;
      for (const [groupName, groupItemsList] of groups.entries()) {
        lines.push(`### ${groupIndex}. ${groupName} (${groupItemsList.length})`);
        lines.push('');

        groupItemsList.forEach((item, idx) => {
          const src = item.source || {};
          const headingLabel = item.heading ? `${item.heading} — ` : '';
          lines.push(`#### ${groupIndex}.${idx + 1} ${headingLabel}[${src.title || src.domain || 'Source'}](${src.canonicalUrl || src.url || '#'})`);
          lines.push('');

          const highlightedText = highlightTermsMarkdown(item.text, item.matchedTerms);
          const quotedLines = highlightedText.split('\n').map(l => `> ${l}`).join('\n');
          lines.push(quotedLines);
          lines.push('');

          if (item.note) {
            lines.push(`- **Research Note:** ${item.note}`);
          }
          if (item.tags && item.tags.length > 0) {
            lines.push(`- **Tags:** ${item.tags.map(t => `\`#${t}\``).join(' ')}`);
          }
          if (item.matchedExpressions && item.matchedExpressions.length > 0) {
            lines.push(`- **Matched Expressions:** ${item.matchedExpressions.map(e => `\`${e}\``).join(', ')} _(Score: ${item.score || 0}/100)_`);
          }

          const metaParts = [
            `**Source:** [${src.domain || 'web'}](${src.canonicalUrl || src.url || '#'})`,
            item.blockType && item.blockType !== 'p' && item.blockType !== 'paragraph' ? `**Type:** \`${item.blockType}\`` : null,
            item.media && item.media.url && /^https?:\/\//i.test(item.media.url) ? `**Media Asset:** [Open](${item.media.url})` : null,
            src.author ? `**Author:** ${src.author}` : null,
            src.publishedDate ? `**Published:** ${src.publishedDate}` : null,
            `**License:** ${src.license || 'Unspecified'}`,
            `**Extracted on:** ${item.extractedAt ? new Date(item.extractedAt).toUTCString() : 'N/A'}`
          ].filter(Boolean);

          lines.push(`- ${metaParts.join(' | ')}`);
          lines.push('');
        });

        groupIndex++;
      }
    }

    // 5. Source Registry & Attribution Table
    lines.push('---');
    lines.push('');
    lines.push('## Source Registry & Legal Attribution');
    lines.push('');
    if (sources.length === 0) {
      lines.push('_No sources recorded._');
    } else {
      lines.push('| # | Page Title | Domain | Author | Published Date | Detected License | Extracts | Canonical URL |');
      lines.push('|---|---|---|---|---|---|---:|---|');
      sources.forEach((s, i) => {
        const cleanTitle = String(s.title || '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
        const cleanAuthor = String(s.author || 'N/A').replace(/\|/g, '\\|');
        const cleanLicense = String(s.license || 'N/A').replace(/\|/g, '\\|');
        lines.push(`| ${i + 1} | ${cleanTitle} | \`${s.domain}\` | ${cleanAuthor} | ${s.publishedDate || 'N/A'} | ${cleanLicense} | ${s.extractCount} | [Link](${s.canonicalUrl}) |`);
      });
    }
    lines.push('');
    lines.push('> _Generated with **Defrost** for research, study, and documentation in compliance with citation rights and public source licenses._');
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Genera il file JSON strutturato e auto-descrittivo (.json)
   */
  function generateJSON(project, options = {}) {
    const groupBy = options.groupBy || 'expression';
    const items = Array.isArray(project.items) ? project.items : [];
    const sources = buildSourcesCatalog(items);
    const groupsMap = groupItems(items, groupBy);

    const organizedGroups = {};
    for (const [k, list] of groupsMap.entries()) {
      organizedGroups[k] = list.map(i => i.id);
    }

    const payload = {
      $schema: 'https://researchtools.local/schemas/lexiscrape-dossier-v1.json',
      schemaVersion: '1.0.0',
      exportedAt: new Date().toISOString(),
      legalCompliance: {
        publicContentOnly: true,
        sourceAttributionIncluded: true,
        notice: 'Dati estratti da pagine pubbliche visibili con attribuzione completa della fonte e della licenza rilevata.'
      },
      project: {
        id: project.id,
        name: project.name,
        description: project.description || '',
        expressions: (project.expressions || '')
          .split(/[\n;,]+/)
          .map(s => s.trim())
          .filter(Boolean),
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        stats: {
          totalExtracts: items.length,
          uniqueSources: sources.length,
          groupingMode: groupBy
        }
      },
      sourcesCatalog: sources,
      groupedIndex: organizedGroups,
      items: items
    };

    return JSON.stringify(payload, null, 2);
  }

  /**
   * Genera il file CSV (.csv) con BOM UTF-8 per compatibilità immediata con Excel / LibreOffice / Google Sheets
   */
  function generateCSV(project) {
    const items = Array.isArray(project.items) ? project.items : [];
    const headers = [
      'Extract_ID',
      'Relevance_Score',
      'Matched_Expressions',
      'Matched_Terms',
      'Tags',
      'Heading_Section',
      'Block_Type',
      'Extracted_Text',
      'User_Note',
      'Source_Title',
      'Domain',
      'Canonical_URL',
      'Author',
      'Published_Date',
      'License',
      'Extracted_At',
      'Media_URL'
    ];

    const escapeCsvCell = (val) => {
      const str = String(val === null || val === undefined ? '' : val)
        .replace(/\r?\n/g, ' ')
        .trim();
      if (/[",;\n]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const rows = [headers.join(',')];
    for (const item of items) {
      const src = item.source || {};
      const row = [
        item.id,
        item.score || 0,
        (item.matchedExpressions || []).join(' | '),
        (item.matchedTerms || []).join(', '),
        (item.tags || []).join(', '),
        item.heading || '',
        item.blockType || 'paragraph',
        item.text || '',
        item.note || '',
        src.title || '',
        src.domain || '',
        src.canonicalUrl || src.url || '',
        src.author || '',
        src.publishedDate || '',
        src.license || '',
        item.extractedAt || '',
        (item.media && item.media.url) || ''
      ].map(escapeCsvCell);
      rows.push(row.join(','));
    }

    return '\uFEFF' + rows.join('\r\n');
  }

  /**
   * Avvia il download del file nel browser (Firefox WebExtension)
   */
  async function downloadProjectFile(project, format = 'md', options = {}) {
    let content = '';
    let mimeType = 'text/plain;charset=utf-8';
    let ext = 'txt';

    if (format === 'md' || format === 'markdown') {
      content = generateMarkdown(project, options);
      mimeType = 'text/markdown;charset=utf-8';
      ext = 'md';
    } else if (format === 'json') {
      content = generateJSON(project, options);
      mimeType = 'application/json;charset=utf-8';
      ext = 'json';
    } else if (format === 'csv') {
      content = generateCSV(project, options);
      mimeType = 'text/csv;charset=utf-8';
      ext = 'csv';
    } else {
      throw new Error(`Formato non supportato: ${format}`);
    }

    const dateStamp = new Date().toISOString().slice(0, 10);
    const filename = `lexiscrape-${slugify(project.name)}-${dateStamp}.${ext}`;

    if (typeof Blob !== 'undefined' && typeof URL !== 'undefined' && URL.createObjectURL) {
      const blob = new Blob([content], { type: mimeType });
      const blobUrl = URL.createObjectURL(blob);

      try {
        if (typeof browser !== 'undefined' && browser.downloads && browser.downloads.download) {
          await browser.downloads.download({
            url: blobUrl,
            filename,
            saveAs: Boolean(options.saveAs)
          });
        } else if (typeof document !== 'undefined') {
          const a = document.createElement('a');
          a.href = blobUrl;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          a.remove();
        }
      } finally {
        setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
      }
    }

    return { filename, content, mimeType };
  }

  const Exporter = {
    slugify,
    buildSourcesCatalog,
    groupItems,
    generateMarkdown,
    generateJSON,
    generateCSV,
    downloadProjectFile
  };

  root.Exporter = Exporter;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Exporter;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
