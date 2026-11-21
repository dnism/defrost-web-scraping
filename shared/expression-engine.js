/**
 * LexiScrape Expression Engine
 * Interpreta sia espressioni in linguaggio naturale (con rimozione stop-word,
 * stemming morfologico IT/EN e calcolo della prossimità semantica) sia query
 * strutturate con frasi esatte ("..."), operatori (AND, OR, NOT / -esclusione, +obbligatorio),
 * wildcard (*) ed espressioni regolari (/regex/flags).
 */
(function (root) {
  'use strict';

  const STOP_WORDS_IT_EN = new Set([
    // Italiano
    'il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'uno', 'una',
    'di', 'a', 'da', 'in', 'con', 'su', 'per', 'tra', 'fra',
    'del', 'dello', 'della', 'dei', 'degli', 'delle',
    'al', 'allo', 'alla', 'ai', 'agli', 'alle',
    'dal', 'dallo', 'dalla', 'dai', 'dagli', 'dalle',
    'nel', 'nello', 'nella', 'nei', 'negli', 'nelle',
    'col', 'coi', 'sul', 'sullo', 'sulla', 'sui', 'sugli', 'sulle',
    'e', 'ed', 'o', 'od', 'ma', 'però', 'anche', 'ancora', 'pure',
    'che', 'chi', 'cui', 'quale', 'quali', 'quanto', 'quanta', 'quanti', 'quante',
    'come', 'dove', 'quando', 'perché', 'perche', 'poiché', 'mentre',
    'questo', 'questa', 'questi', 'queste', 'quello', 'quella', 'quelli', 'quelle',
    'suo', 'sua', 'suoi', 'sue', 'loro', 'nostro', 'nostra', 'vostro', 'vostra',
    'essere', 'è', 'sono', 'stato', 'stata', 'stati', 'state', 'sia', 'siano',
    'avere', 'ha', 'hanno', 'avuto', 'più', 'piu', 'meno', 'molto', 'molti', 'molte',
    'tutto', 'tutti', 'tutte', 'ogni', 'alcuni', 'alcune', 'altro', 'altri', 'altre',
    'può', 'puo', 'possono', 'fare', 'fatto', 'solo', 'così', 'cosi', 'già', 'gia',
    // Inglese
    'the', 'a', 'an', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'from',
    'about', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
    'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
    'do', 'does', 'did', 'will', 'would', 'shall', 'should', 'can', 'could',
    'this', 'that', 'these', 'those', 'it', 'its', 'they', 'them', 'their',
    'what', 'which', 'who', 'whom', 'how', 'when', 'where', 'why',
    'and', 'or', 'not'
  ]);

  /**
   * Normalizza gli accenti mantenendo la lunghezza della stringa invariata
   */
  const NON_ASCII_RE = /[^\x00-\x7f]/;

  function normalizeDiacritics(str) {
    const s = String(str || '');
    if (!NON_ASCII_RE.test(s)) return s.toLowerCase();
    return s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  // Suffissi derivazionali e flessivi comuni IT/EN (ordinati dal più lungo)
  const STEM_SUFFIXES = [
    'izzazione', 'izzazioni', 'amento', 'amenti', 'imento', 'imenti',
    'azione', 'azioni', 'izione', 'izioni', 'uzione', 'uzioni',
    'atrice', 'atrici', 'atore', 'atori', 'mente',
    'abile', 'abili', 'ibile', 'ibili', 'evole', 'evoli',
    'iche', 'ichi', 'eschi', 'esche', 'ismi', 'ismo', 'ista', 'isti', 'iste',
    'ando', 'endo', 'ano', 'ono', 'ava', 'eva', 'iva', 'ato', 'ito', 'uto',
    'ata', 'ita', 'uta', 'ati', 'iti', 'uti', 'ate', 'ite', 'ute',
    'ing', 'tion', 'tions', 'ness', 'ment', 'ments', 'able', 'ible',
    'che', 'chi', 'cia', 'cie', 'gia', 'gie', 'ico', 'ica', 'ici',
    'ies', 'es', 'ed', 'er', 'ly',
    'a', 'e', 'i', 'o', 's'
  ];

  /**
   * Stemmer leggero morfologico per Italiano e Inglese.
   * Permette a "rinnovabili" di fare match con "rinnovabile",
   * "fotovoltaici" con "fotovoltaico/fotovoltaiche", "produzione" con "produzioni", ecc.
   */
  function stemToken(word) {
    const clean = normalizeDiacritics(word).replace(/[^a-z0-9]/g, '');
    if (clean.length <= 4) return clean;

    for (const suf of STEM_SUFFIXES) {
      if (clean.endsWith(suf) && clean.length - suf.length >= 4) {
        return clean.slice(0, clean.length - suf.length);
      }
    }
    return clean;
  }

  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Suddivide l'input dell'utente in una lista di clausole/espressioni distinte
   * (separate da a-capo o da punto e virgola, oppure virgola fuori da virgolette/regex).
   */
  function splitExpressions(rawInput) {
    if (!rawInput || typeof rawInput !== 'string') return [];
    const results = [];
    let current = '';
    let inQuotes = false;
    let inRegex = false;

    for (let i = 0; i < rawInput.length; i++) {
      const ch = rawInput[i];
      const prev = i > 0 ? rawInput[i - 1] : '';

      if (ch === '"' && prev !== '\\' && !inRegex) {
        inQuotes = !inQuotes;
        current += ch;
        continue;
      }
      if (ch === '/' && prev !== '\\' && !inQuotes) {
        // Verifica se è apertura/chiusura regex
        if (!inRegex && (current.trim() === '' || /[\s,;(\|]$/.test(current))) {
          inRegex = true;
          current += ch;
          continue;
        } else if (inRegex) {
          inRegex = false;
          current += ch;
          continue;
        }
      }

      if (ch === '\n' && inRegex) {
        inRegex = false;
      }

      if (!inQuotes && !inRegex && (ch === '\n' || ch === ';' || ch === ',')) {
        if (current.trim()) results.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim()) results.push(current.trim());
    return results;
  }

  /**
   * Analizza una singola espressione in una struttura eseguibile:
   * - regexes: espressioni regolari /.../flags
   * - phrases: frasi esatte "..."
   * - required: termini obbligatori (+termine o tutti i lati di AND)
   * - excluded: termini esclusi (-termine o NOT termine)
   * - orGroups: gruppi di alternative (A OR B)
   * - concepts: concetti chiave estratti dall'espressione naturale (con stem e regex morfologica)
   */
  function parseSingleExpression(exprText) {
    const raw = (exprText || '').trim();
    if (!raw) return null;

    const parsed = {
      raw,
      label: raw,
      regexes: [],
      phrases: [],
      required: [],
      excluded: [],
      orGroups: [],
      concepts: [],
      isPureRegex: false
    };

    let working = raw;

    // 1. Estrai Regex del tipo /pattern/flags
    const regexMatchAll = /^\/(.+)\/([gimsuy]*)$/.exec(working);
    if (regexMatchAll) {
      try {
        const flags = Array.from(new Set((regexMatchAll[2] + 'gi').split(''))).join('');
        parsed.regexes.push({
          source: regexMatchAll[1],
          flags,
          re: new RegExp(regexMatchAll[1], flags)
        });
        parsed.isPureRegex = true;
        return parsed;
      } catch (_) {
        // Se non è una regex valida, procedi come testo normale
      }
    }

    // Regex inline dentro un'espressione più ampia
    working = working.replace(/(?:^|\s)\/([^/\\]+(?:\\.[^/\\]*)*)\/([gimsuy]*)/g, (m, pat, fl) => {
      try {
        const flags = Array.from(new Set(((fl || '') + 'gi').split(''))).join('');
        parsed.regexes.push({ source: pat, flags, re: new RegExp(pat, flags) });
        return ' ';
      } catch (_) {
        return m;
      }
    });

    // 1b. Estrai esclusioni con -"frase" o NOT "frase" o -parola o NOT parola
    working = working.replace(/(?:^|\s)(?:NOT\s+|-)["«]([^"»]+)["»]/g, (_, phrase) => {
      const cleanPhrase = phrase.trim();
      if (cleanPhrase) parsed.excluded.push({ text: cleanPhrase, isPhrase: true });
      return ' ';
    });
    working = working.replace(/(?:^|\s)(?:NOT\s+|-)([a-zA-Z0-9àèéìòùÀÈÉÌÒÙ_*'-]{2,})/g, (_, word) => {
      parsed.excluded.push({ text: word.trim(), isPhrase: false });
      return ' ';
    });

    // Precompile exclusion matchers once (instead of on every block evaluation)
    parsed.excluded.forEach(ex => {
      ex.norm = normalizeDiacritics(ex.text);
      if (!ex.isPhrase) {
        const hasWildcard = ex.norm.includes('*');
        const pat = hasWildcard
          ? ex.norm.split('*').map(escapeRegex).join('[a-z0-9]*')
          : escapeRegex(ex.norm);
        const startB = /^[a-z0-9_*]/.test(ex.norm) ? '\\b' : '';
        const endB = /[a-z0-9_*]$/.test(ex.norm) ? '\\b' : '';
        ex.re = new RegExp(`${startB}${pat}${endB}`, 'i');
      }
    });

    // 2. Estrai gruppi OR tra parentesi es. (termA OR "synonym A") AND (termB OR termC)
    working = working.replace(/\(([^()]*(?:\bOR\b|\|)[^()]*)\)/gi, (_, innerGroup) => {
      const parts = innerGroup
        .split(/\s+(?:OR|\|)\s+/i)
        .map(p => p.trim().replace(/^["«]+|["»]+$/g, '').trim())
        .filter(p => p.length >= 2);
      if (parts.length > 1) {
        parsed.orGroups.push(parts.map(p => buildConceptMatcher(p)));
        return ' ';
      }
      return _;
    });

    // 2b. Gestisci espressioni OR a livello principale (es. "solare OR fotovoltaico" o '"frase 1" OR "frase 2"')
    if (/\bOR\b|\|/.test(working) && !/\bAND\b/.test(working)) {
      const parts = working
        .split(/\s+(?:OR|\|)\s+/i)
        .map(p => p.trim().replace(/^[("«]+|[)"»]+$/g, '').trim())
        .filter(p => p.length >= 2);
      if (parts.length > 1) {
        parsed.orGroups.push(parts.map(p => buildConceptMatcher(p)));
        working = '';
      }
    }

    // 3. Estrai frasi esatte tra virgolette ("..." o «...») rimanenti
    working = working.replace(/(?:([+-])?)["«]([^"»]+)["»]/g, (_, prefix, phrase) => {
      const cleanPhrase = phrase.trim();
      if (!cleanPhrase) return ' ';
      if (prefix === '-') {
        parsed.excluded.push({ text: cleanPhrase, isPhrase: true, norm: normalizeDiacritics(cleanPhrase) });
      } else {
        parsed.phrases.push({
          text: cleanPhrase,
          required: prefix === '+' || true
        });
      }
      return ' ';
    });

    // 4. Gestisci termini obbligatori espliciti con +parola
    working = working.replace(/(?:^|\s)\+([a-zA-Z0-9àèéìòùÀÈÉÌÒÙ_*'-]{2,})/g, (_, word) => {
      parsed.required.push(buildConceptMatcher(word.trim()));
      return ' ';
    });

    // 5. Fallback per eventuale OR residuo (anche mescolato ad AND: ogni clausola AND con OR diventa un orGroup)
    const hasExplicitAnd = /\bAND\b/.test(working);
    if (/\bOR\b|\|/.test(working)) {
      if (!hasExplicitAnd) {
        const parts = working
          .split(/\s+(?:OR|\|)\s+/i)
          .map(p => p.trim().replace(/[()]/g, '').trim())
          .filter(Boolean);
        if (parts.length > 1) {
          parsed.orGroups.push(parts.map(p => buildConceptMatcher(p)));
          working = '';
        }
      } else {
        const andClauses = working.split(/\s+\bAND\b\s+/);
        const remainingClauses = [];
        for (const clause of andClauses) {
          if (/\bOR\b|\|/.test(clause)) {
            const parts = clause
              .split(/\s+(?:OR|\|)\s+/i)
              .map(p => p.trim().replace(/[()]/g, '').trim())
              .filter(Boolean);
            if (parts.length > 1) {
              parsed.orGroups.push(parts.map(p => buildConceptMatcher(p)));
              continue;
            }
          }
          remainingClauses.push(clause);
        }
        working = remainingClauses.join(' ');
      }
    }

    // 6. Rimuovi operatori booleani espliciti residui (AND, OR, NOT)
    working = working.replace(/\b(?:AND|OR|NOT)\b/g, ' ');

    // 6b. Se è una riga breve senza operatori né wildcard (es. "mary lucier", "dawn burn paris", 2-3 parole),
    // trattala come frase esatta/adiacente unita invece di spezzarla in parole indipendenti.
    const cleanShortLine = working.replace(/\s+/g, ' ').trim();
    const shortWords = cleanShortLine ? cleanShortLine.split(' ').filter(Boolean) : [];
    const isPlainMultiWordPhrase = (
      parsed.regexes.length === 0 &&
      parsed.phrases.length === 0 &&
      parsed.required.length === 0 &&
      parsed.orGroups.length === 0 &&
      !hasExplicitAnd &&
      !cleanShortLine.includes('*') &&
      !/\b(?:and|or|not)\b/i.test(cleanShortLine) &&
      shortWords.length >= 2 &&
      shortWords.length <= 3
    );

    if (isPlainMultiWordPhrase) {
      const adjRe = buildAdjacentPhraseRegex(cleanShortLine);
      parsed.phrases.push({
        text: cleanShortLine,
        norm: normalizeDiacritics(cleanShortLine),
        required: true,
        re: adjRe
      });
      parsed.normRaw = normalizeDiacritics(raw).replace(/\s+/g, ' ').trim();
      return parsed;
    }

    // 7. Estrai i token dell'espressione naturale rimanente
    const rawTokens = working
      .replace(/[^\p{L}\p{N}_*'-]+/gu, ' ')
      .split(/\s+/)
      .map(t => t.replace(/^['-]+|['-]+$/g, ''))
      .filter(Boolean);

    // Separa eventuali prefissi elisi italiani tipo "l'energia", "dell'acqua", "sull'ambiente"
    const expandedTokens = [];
    for (const tok of rawTokens) {
      const elisionParts = tok.split("'");
      if (elisionParts.length > 1 && elisionParts[0].length <= 4) {
        expandedTokens.push(elisionParts.slice(1).join("'"));
      } else {
        expandedTokens.push(tok);
      }
    }

    // Filtra le stop-word solo se ci sono altre parole significative nell'espressione
    const significantTokens = expandedTokens.filter(t => {
      const norm = normalizeDiacritics(t);
      return norm.length >= 2 && !STOP_WORDS_IT_EN.has(norm);
    });

    const chosenTokens = significantTokens.length > 0 ? significantTokens : expandedTokens.filter(t => t.length >= 2);

    const seenStems = new Set();
    for (const tok of chosenTokens) {
      const matcher = buildConceptMatcher(tok);
      if (hasExplicitAnd) {
        parsed.required.push(matcher);
      } else if (!seenStems.has(matcher.stem)) {
        seenStems.add(matcher.stem);
        parsed.concepts.push(matcher);
      }
    }

    // Precompute normalized forms used during evaluation
    parsed.phrases.forEach(ph => { ph.norm = normalizeDiacritics(ph.text); });
    parsed.normRaw = normalizeDiacritics(raw).replace(/\s+/g, ' ').trim();

    return parsed;
  }

  function buildAdjacentPhraseRegex(phrase) {
    const norm = normalizeDiacritics(phrase);
    const rawWords = norm.split(/\s+/).filter(Boolean);
    if (rawWords.length < 2) return null;
    const words = rawWords.map(escapeRegex);
    const startBound = /^[a-z0-9_]/.test(rawWords[0]) ? '\\b' : '';
    const endBound = /[a-z0-9_]$/.test(rawWords[rawWords.length - 1]) ? '\\b' : '';
    return new RegExp(`${startBound}${words.join('[\\s,;-]+')}${endBound}`, 'gi');
  }

  /**
   * Costruisce un matcher per singolo concetto/parola (supporta wildcard * e radice morfologica)
   */
  function buildConceptMatcher(token) {
    const clean = token.trim();
    const norm = normalizeDiacritics(clean);
    const hasWildcard = clean.includes('*');

    if (hasWildcard) {
      const pattern = norm.split('*').map(escapeRegex).join('[a-z0-9]*');
      return {
        token: clean,
        norm,
        stem: norm.replace(/\*/g, ''),
        normRegex: new RegExp(`\\b${pattern}\\b`, 'gi')
      };
    }

    if (/\s/.test(norm)) {
      const words = norm.split(/\s+/).filter(Boolean).map(escapeRegex);
      return {
        token: clean,
        norm,
        stem: norm,
        normRegex: new RegExp(`\\b${words.join('\\s+')}\\b`, 'gi')
      };
    }

    const stem = stemToken(clean);
    // Se lo stem è abbastanza lungo (>= 4 caratteri), accetta qualsiasi suffisso fino a 6 lettere
    // così che "rinnovabili" (stem: rinnovabil) trovi "rinnovabile", "rinnovabili", ecc.
    const pattern = stem.length >= 4 && stem !== norm
      ? `\\b${escapeRegex(stem)}[a-z0-9]{0,6}\\b`
      : `\\b${escapeRegex(norm)}\\b`;

    return {
      token: clean,
      norm,
      stem,
      normRegex: new RegExp(pattern, 'gi')
    };
  }

  /**
   * Valuta un blocco di testo (e opzionalmente il suo titolo/heading contestuale)
   * rispetto a una singola espressione parsata.
   * Restituisce { matched: boolean, score: number, matchedTerms: string[], highlights: string[] }
   */
  function buildTextContext(blockText, headingText) {
    const fullText = headingText ? `${headingText}\n${blockText}` : blockText;
    const normFull = normalizeDiacritics(fullText);
    // normalizeDiacritics preserves length, so heading/body are slices of normFull
    const headLen = headingText ? headingText.length : 0;
    if (normFull.length !== fullText.length) {
      return {
        fullText,
        normFull,
        normHeading: normalizeDiacritics(headingText || ''),
        normBody: normalizeDiacritics(blockText)
      };
    }
    return {
      fullText,
      normFull,
      normHeading: headingText ? normFull.slice(0, headLen) : '',
      normBody: headingText ? normFull.slice(headLen + 1) : normFull
    };
  }

  function evaluateBlockAgainstExpression(blockText, headingText, parsedExpr, ctx) {
    if (!parsedExpr || !blockText) {
      return { matched: false, score: 0, matchedTerms: [], highlights: [] };
    }

    const { fullText, normFull, normHeading, normBody } = ctx || buildTextContext(blockText, headingText);

    // 1. Verifica esclusioni (-parola o NOT parola)
    for (const ex of parsedExpr.excluded) {
      const normEx = ex.norm || normalizeDiacritics(ex.text);
      if (ex.isPhrase) {
        if (normFull.includes(normEx)) {
          return { matched: false, score: 0, matchedTerms: [], highlights: [] };
        }
      } else {
        const re = ex.re || new RegExp(`\\b${escapeRegex(normEx)}\\b`, 'i');
        if (re.test(normFull)) {
          return { matched: false, score: 0, matchedTerms: [], highlights: [] };
        }
      }
    }

    let score = 0;
    const matchedTerms = new Set();
    const highlightSpans = new Set();

    // 2. Verifica Regex esplicite
    for (const rxObj of parsedExpr.regexes) {
      rxObj.re.lastIndex = 0;
      const matches = fullText.match(rxObj.re);
      if (!matches || matches.length === 0) {
        return { matched: false, score: 0, matchedTerms: [], highlights: [] };
      }
      score += 25 + Math.min(matches.length * 5, 25);
      matches.slice(0, 8).forEach(m => {
        const trimmed = m.trim();
        if (trimmed) {
          matchedTerms.add(trimmed);
          highlightSpans.add(trimmed);
        }
      });
    }

    // 3. Verifica Frasi Esatte ("..." o frasi brevi unite come "mary lucier")
    for (const ph of parsedExpr.phrases) {
      const normPh = ph.norm || normalizeDiacritics(ph.text);
      let isFound = false;
      let matchedSpan = ph.text;
      if (ph.re) {
        const found = collectOriginalMatches(fullText, normFull, ph.re);
        if (found.length > 0) {
          isFound = true;
          matchedSpan = found[0];
        }
      } else {
        isFound = normFull.indexOf(normPh) !== -1;
      }

      if (!isFound) {
        if (ph.required) {
          return { matched: false, score: 0, matchedTerms: [], highlights: [] };
        }
      } else {
        score += 30;
        if (ph.re ? (ph.re.lastIndex = 0, ph.re.test(normHeading)) : normHeading.includes(normPh)) {
          score += 15;
        }
        matchedTerms.add(ph.text);
        highlightSpans.add(matchedSpan);
      }
    }

    // 4. Verifica Termini Obbligatori (+parola o AND)
    for (const req of parsedExpr.required) {
      req.normRegex.lastIndex = 0;
      const found = collectOriginalMatches(fullText, normFull, req.normRegex);
      if (found.length === 0) {
        return { matched: false, score: 0, matchedTerms: [], highlights: [] };
      }
      score += 18 + Math.min(found.length * 3, 12);
      matchedTerms.add(req.token);
      found.forEach(w => highlightSpans.add(w));
    }

    // 5. Verifica Gruppi OR
    for (const group of parsedExpr.orGroups) {
      let groupMatched = false;
      for (const alt of group) {
        alt.normRegex.lastIndex = 0;
        const found = collectOriginalMatches(fullText, normFull, alt.normRegex);
        if (found.length > 0) {
          groupMatched = true;
          score += 15 + Math.min(found.length * 3, 10);
          matchedTerms.add(alt.token);
          found.forEach(w => highlightSpans.add(w));
        }
      }
      if (!groupMatched) {
        return { matched: false, score: 0, matchedTerms: [], highlights: [] };
      }
    }

    // 6. Valutazione Concetti dell'Espressione Naturale
    if (parsedExpr.concepts.length > 0) {
      let matchedConceptCount = 0;
      const positions = [];

      for (const concept of parsedExpr.concepts) {
        concept.normRegex.lastIndex = 0;
        const found = collectOriginalMatches(fullText, normFull, concept.normRegex, positions);
        if (found.length > 0) {
          matchedConceptCount++;
          matchedTerms.add(concept.token);
          found.forEach(w => highlightSpans.add(w));

          // Punteggio base + bonus se appare nel titolo della sezione
          score += 12 + Math.min(found.length * 2, 10);
          concept.normRegex.lastIndex = 0;
          if (concept.normRegex.test(normHeading)) {
            score += 10;
          }
        }
      }

      const totalConcepts = parsedExpr.concepts.length;
      const coverage = matchedConceptCount / totalConcepts;

      // Soglia adattiva intelligente per espressioni naturali:
      // - 1 concetto: deve esserci (100%)
      // - 2 concetti: entrambi presenti (o 1 nel titolo + 1 nel corpo, quindi >= 1 se uno è molto specifico >= 6 char? Meglio: se 2 concetti, almeno 1 se l'espressione ha già frasi/required, altrimenti entrambi oppure 1 se la parola è lunga >= 7 caratteri e ripete, ma per precisione richiediamo >= 2 su 2 oppure >= 60% per >= 3 concetti)
      let minRequiredConcepts;
      if (totalConcepts === 1) {
        minRequiredConcepts = 1;
      } else if (totalConcepts === 2) {
        minRequiredConcepts = 2;
      } else if (totalConcepts <= 4) {
        minRequiredConcepts = Math.ceil(totalConcepts * 0.65); // 2 su 3, 3 su 4
      } else {
        minRequiredConcepts = Math.max(2, Math.ceil(totalConcepts * 0.55)); // es. 3 su 5, 4 su 7
      }

      if (matchedConceptCount < minRequiredConcepts) {
        return { matched: false, score: 0, matchedTerms: [], highlights: [] };
      }

      // Bonus per copertura completa (100% dei concetti dell'espressione trovati)
      if (coverage === 1 && totalConcepts > 1) {
        score += 20;
      }

      // Bonus per frase intera quasi contigua o alta prossimità tra i concetti nel testo
      if (positions.length >= 2) {
        positions.sort((a, b) => a - b);
        let minSpan = Infinity;
        for (let i = 0; i < positions.length - 1; i++) {
          const dist = positions[i + 1] - positions[i];
          if (dist > 0 && dist < minSpan) minSpan = dist;
        }
        if (minSpan <= 40) score += 15;
        else if (minSpan <= 100) score += 8;
      }

      // Bonus se la stringa normalizzata intera dell'espressione appare letteralmente
      const normRawExpr = parsedExpr.normRaw || normalizeDiacritics(parsedExpr.raw).replace(/\s+/g, ' ').trim();
      if (normRawExpr.length >= 4 && normBody.includes(normRawExpr)) {
        score += 25;
      }
    }

    const hasAnyMatch =
      matchedTerms.size > 0 ||
      parsedExpr.regexes.length > 0 ||
      parsedExpr.phrases.length > 0 ||
      parsedExpr.required.length > 0 ||
      parsedExpr.orGroups.length > 0;

    if (!hasAnyMatch || score <= 0) {
      return { matched: false, score: 0, matchedTerms: [], highlights: [] };
    }

    return {
      matched: true,
      score: Math.min(100, Math.round(score)),
      matchedTerms: Array.from(matchedTerms),
      highlights: Array.from(highlightSpans)
    };
  }

  /**
   * Trova le occorrenze nella stringa normalizzata e restituisce le sottostringhe originali
   * corrispondenti (dato che normalizeDiacritics conserva gli indici carattere 1:1).
   */
  function collectOriginalMatches(originalText, normalizedText, normRegex, positionsOut) {
    const results = new Set();
    const canSliceOriginal = originalText.length === normalizedText.length;
    let match;
    normRegex.lastIndex = 0;
    let safety = 0;
    while ((match = normRegex.exec(normalizedText)) !== null && safety++ < 50) {
      const idx = match.index;
      const len = match[0].length;
      if (positionsOut) positionsOut.push(idx);
      const origSlice = (canSliceOriginal ? originalText.slice(idx, idx + len) : match[0]).trim();
      if (origSlice) results.add(origSlice);
      if (len === 0) normRegex.lastIndex++;
    }
    return Array.from(results);
  }

  // Cache of compiled expression sets: the same input is parsed once, not once per block
  const parsedCache = new Map();
  const PARSED_CACHE_LIMIT = 32;

  function getParsedList(rawExpressionsInput) {
    const key = Array.isArray(rawExpressionsInput)
      ? rawExpressionsInput.join('\u0001')
      : String(rawExpressionsInput || '');
    const hit = parsedCache.get(key);
    if (hit) return hit;

    const exprStrings = Array.isArray(rawExpressionsInput)
      ? rawExpressionsInput
      : splitExpressions(rawExpressionsInput);
    const rawParsed = exprStrings.map(parseSingleExpression).filter(Boolean);

    // Collect standalone exclusion-only lines (e.g. "-1975" on its own line) as global exclusions
    const globalExclusions = [];
    const positiveList = [];
    for (const p of rawParsed) {
      const hasPositive = (
        p.regexes.length > 0 ||
        p.phrases.length > 0 ||
        p.required.length > 0 ||
        p.orGroups.length > 0 ||
        p.concepts.length > 0
      );
      if (!hasPositive && p.excluded.length > 0) {
        globalExclusions.push(...p.excluded);
      } else if (hasPositive) {
        positiveList.push(p);
      }
    }

    if (globalExclusions.length > 0) {
      for (const p of positiveList) {
        const seenNorms = new Set(p.excluded.map(ex => `${ex.isPhrase ? 'P' : 'W'}:${ex.norm}`));
        for (const gx of globalExclusions) {
          const k = `${gx.isPhrase ? 'P' : 'W'}:${gx.norm}`;
          if (!seenNorms.has(k)) {
            seenNorms.add(k);
            p.excluded.push(gx);
          }
        }
      }
    }

    const parsedList = positiveList;

    if (parsedCache.size >= PARSED_CACHE_LIMIT) {
      parsedCache.delete(parsedCache.keys().next().value);
    }
    parsedCache.set(key, parsedList);
    return parsedList;
  }

  /**
   * Valuta un blocco rispetto a un input che può contenere una o più espressioni.
   */
  function evaluateBlock(blockText, headingText, rawExpressionsInput) {
    const parsedList = getParsedList(rawExpressionsInput);
    if (parsedList.length === 0 || !blockText) {
      return {
        matched: false,
        score: 0,
        matchedExpressions: [],
        matchedTerms: [],
        highlights: []
      };
    }

    // Normalize the block text once, shared by all expressions
    const ctx = buildTextContext(blockText, headingText);

    let totalScore = 0;
    const matchedExpressions = [];
    const allMatchedTerms = new Set();
    const allHighlights = new Set();

    for (const parsed of parsedList) {
      const res = evaluateBlockAgainstExpression(blockText, headingText, parsed, ctx);
      if (res.matched) {
        matchedExpressions.push(parsed.label);
        totalScore = Math.max(totalScore, res.score) + Math.min(15, (matchedExpressions.length - 1) * 8);
        res.matchedTerms.forEach(t => allMatchedTerms.add(t));
        res.highlights.forEach(h => allHighlights.add(h));
      }
    }

    if (matchedExpressions.length === 0) {
      return {
        matched: false,
        score: 0,
        matchedExpressions: [],
        matchedTerms: [],
        highlights: []
      };
    }

    return {
      matched: true,
      score: Math.min(100, totalScore),
      matchedExpressions,
      matchedTerms: Array.from(allMatchedTerms),
      highlights: Array.from(allHighlights)
    };
  }

  const QUESTION_FRAMING_WORDS = new Set([
    // EN framing
    'thought', 'thoughts', 'people', 'person', 'user', 'users', 'think', 'thinking',
    'opinion', 'opinions', 'view', 'views', 'feeling', 'feelings', 'idea', 'ideas',
    'tell', 'find', 'search', 'looking', 'look', 'know', 'understand', 'analyze',
    'analysis', 'research', 'study', 'information', 'info', 'details', 'overview',
    // IT framing
    'pensiero', 'pensieri', 'pensano', 'pensa', 'persone', 'gente', 'utenti', 'utente',
    'opinione', 'opinioni', 'parere', 'pareri', 'cosa', 'qual', 'quali', 'come',
    'cerco', 'cercare', 'trova', 'trovare', 'capire', 'vorrei', 'sapere', 'informazioni',
    'riguardo', 'circa', 'merito', 'analisi', 'studio', 'ricerca', 'approfondimento'
  ]);

  const DOMAIN_SYNONYM_MAP = {
    ehr: ['"EHR"', '"EMR"', '"electronic health record"', '"cartella clinica elettronica"'],
    emr: ['"EMR"', '"EHR"', '"electronic medical record"'],
    ai: ['"AI"', '"artificial intelligence"', '"intelligenza artificiale"', '"LLM"'],
    llm: ['"LLM"', '"large language model"', '"modello linguistico"'],
    rinnovabili: ['rinnovabili', 'fotovoltaico', 'eolico', 'solare'],
    energia: ['energia', 'elettricità', 'impianti', 'produzione'],
    costo: ['costo', 'prezzo', 'bolletta', 'tariffe', 'spesa'],
    cost: ['cost', 'price', 'pricing', 'expense', 'budget'],
    tools: ['tools', 'software', 'platform', 'system', 'solution'],
    tool: ['tool', 'software', 'platform', 'system'],
    strumenti: ['strumenti', 'software', 'piattaforma', 'sistema']
  };

  function compileStrategyExpressions(strategy) {
    if (!strategy || typeof strategy !== 'object') return '';
    const lines = [];
    const seen = new Set();
    const pushLine = (line) => {
      const clean = String(line || '').trim();
      if (!clean) return;
      const key = clean.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      lines.push(clean);
    };

    (strategy.primaryExpressions || []).forEach(pushLine);

    // Pack AI-expanded keyConcepts not yet covered in primaryExpressions into flat OR-clusters
    // so every semantic keyword generated by the AI actively boosts DOM scanner recall.
    const joinedPrimary = lines.join(' ').toLowerCase();
    const extraKeywords = (strategy.keyConcepts || [])
      .map(k => String(k || '').trim())
      .filter(k => k.length >= 2 && !joinedPrimary.includes(k.toLowerCase()));

    const exclusions = Array.isArray(strategy.exclusions)
      ? strategy.exclusions.map(e => String(e || '').trim().replace(/^-+/, '')).filter(Boolean)
      : [];
    const exclSuffix = exclusions.length > 0
      ? ' ' + exclusions.map(e => (/\s/.test(e) ? `-"${e}"` : `-${e}`)).join(' ')
      : '';

    for (let i = 0; i < extraKeywords.length; i += 4) {
      const chunk = extraKeywords.slice(i, i + 4).map(k => (/\s/.test(k) ? `"${k}"` : k));
      if (chunk.length >= 2) {
        pushLine(`${chunk.join(' OR ')}${exclSuffix}`.trim());
      } else if (chunk.length === 1) {
        pushLine(`${chunk[0]}${exclSuffix}`.trim());
      }
    }

    (strategy.regexPatterns || []).forEach(pushLine);

    if (exclusions.length > 0 && lines.length > 0) {
      const hasExclAlready = lines.some(l => /(?:^|\s)-[a-z0-9"]/i.test(l));
      if (!hasExclAlready) {
        lines[0] = `${lines[0]}${exclSuffix}`.trim();
      }
    }

    return lines.join('\n');
  }

  /**
   * Extracts deduped positive keywords/phrases and negative exclusions (-term)
   * from an expressions textarea string so scanner pills stay in sync with manual edits.
   */
  function extractTermsFromExpressions(text) {
    const keywords = [];
    const exclusions = [];
    const regexes = [];
    const seenKw = new Set();
    const seenExcl = new Set();
    const seenRx = new Set();

    const addKw = (val) => {
      const clean = String(val || '').trim();
      if (clean.length < 2) return;
      const upper = clean.toUpperCase();
      if (upper === 'AND' || upper === 'OR' || upper === 'NOT') return;
      const key = clean.toLowerCase();
      if (seenKw.has(key)) return;
      seenKw.add(key);
      keywords.push(clean);
    };

    const addExcl = (val) => {
      const clean = String(val || '').trim().replace(/^-+/, '');
      if (!clean) return;
      const key = clean.toLowerCase();
      if (seenExcl.has(key)) return;
      seenExcl.add(key);
      exclusions.push(clean);
    };

    const addRx = (val) => {
      const clean = String(val || '').trim();
      if (!clean) return;
      const key = clean.toLowerCase();
      if (seenRx.has(key)) return;
      seenRx.add(key);
      regexes.push(clean);
    };

    const rawLines = splitExpressions(String(text || ''));
    for (const line of rawLines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Extract pure or inline regexes (/pattern/flags) first
      let withoutRegex = trimmed.replace(/(?:^|\s)(\/(?:[^/\\]|\\.)+\/[gimsuy]*)/g, (m, rxToken) => {
        addRx(rxToken.trim());
        return ' ';
      }).trim();

      if (!withoutRegex) continue;

      // Extract any exclusions (-"phrase", NOT "phrase", -word, or NOT word) in left-to-right order
      let remainder = withoutRegex
        .replace(/(?:^|\s)(?:NOT\s+|-)(?:["«]([^"»]+)["»]|([^\s()]+))/g, (_, phr, tok) => {
          addExcl(phr !== undefined ? phr : tok);
          return ' ';
        })
        .trim();

      if (!remainder) continue;

      const hasBooleanOrQuotes = /(?:\b(?:AND|OR|NOT)\b|\||[()"])/.test(remainder);
      if (!hasBooleanOrQuotes) {
        // Plain single or multi-word line (e.g. "solar power"): keep whole phrase together
        addKw(remainder.replace(/^\++/, '').trim());
        continue;
      }

      // Boolean/quoted line: extract individual quoted phrases and operand tokens
      const tokenRegex = /\+"([^"]+)"|"([^"]+)"|([^\s()]+)/g;
      let match;
      while ((match = tokenRegex.exec(remainder)) !== null) {
        if (match[1] !== undefined) {
          addKw(match[1]);
        } else if (match[2] !== undefined) {
          addKw(match[2]);
        } else if (match[3] !== undefined) {
          addKw(match[3].replace(/^[()+]+|[()]+$/g, ''));
        }
      }
    }

    return { keywords, exclusions, regexes };
  }

  /**
   * Automatically builds a complete, ready-to-scrape extraction plan
   * (expressions, boolean rules, regexes, exclusions, target DOM elements, and search queries)
   * directly from the user's natural language question in the Interpreter.
   */
  function buildScrapingPlanFromQuestion(questionText) {
    const raw = String(questionText || '').replace(/\s+/g, ' ').trim();
    if (!raw) return null;

    const isItalian = /\b(il|lo|la|gli|le|del|della|dei|degli|delle|nel|nella|sul|sulla|che|cosa|come|perché|più|italia|opinioni|persone|costo|impatto|energia)\b/i.test(raw);

    // Detect intents from question wording
    const isOpinionIntent = /\b(thought|thoughts|opinion|opinions|people|user|users|review|reviews|feedback|experience|pros|cons|burnout|complaint|reddit|forum|pensano|opinioni|persone|utenti|recensioni|commenti|esperienze|vantaggi|svantaggi|problemi|pareri)\b/i.test(raw);
    const isMetricIntent = /\b(cost|costs|price|pricing|market|growth|rate|statistics|data|percent|impact|revenue|roi|budget|costo|costi|prezzo|prezzi|mercato|crescita|dati|statistiche|percentuale|impatto|bolletta|miliardi|milioni)\b/i.test(raw);
    const isVisualIntent = /\b(chart|charts|graph|diagram|figure|table|image|infographic|grafico|grafici|tabella|tabelle|figura|immagine|schema)\b/i.test(raw);

    // Extract raw words preserving case for acronyms
    const rawWords = raw.match(/[A-Za-zÀ-ÖØ-öø-ÿ0-9_-]{2,}/g) || [];
    const subjectTokens = [];
    const allMeaningfulTokens = [];
    const seenLower = new Set();

    for (const w of rawWords) {
      const low = normalizeDiacritics(w);
      if (STOP_WORDS_IT_EN.has(low)) continue;
      if (!seenLower.has(low)) {
        seenLower.add(low);
        allMeaningfulTokens.push(w);
        if (!QUESTION_FRAMING_WORDS.has(low)) {
          subjectTokens.push(w);
        }
      }
    }

    const coreTokens = subjectTokens.length > 0 ? subjectTokens : allMeaningfulTokens;
    if (coreTokens.length === 0) return null;

    const keyConcepts = [...coreTokens.slice(0, 6)];
    if (isOpinionIntent) {
      keyConcepts.push(isItalian ? 'opinioni & esperienze' : 'user feedback & usability');
    }
    if (isMetricIntent) {
      keyConcepts.push(isItalian ? 'dati & costi' : 'metrics & pricing');
    }

    const exclusions = isItalian
      ? ['cookie', 'login', 'abbonati', 'pubblicita']
      : ['cookie', 'login', 'subscribe', 'advertisement'];

    const primaryExpressions = [];
    const regexPatterns = [];

    // 1. Core natural-language expression
    const corePhrase = coreTokens.join(' ');
    primaryExpressions.push(corePhrase);

    // 2. Expanded synonym / boolean expression
    const orGroups = [];
    for (const tok of coreTokens.slice(0, 3)) {
      const low = normalizeDiacritics(tok);
      if (DOMAIN_SYNONYM_MAP[low]) {
        orGroups.push(`(${DOMAIN_SYNONYM_MAP[low].join(' OR ')})`);
      } else if (tok.length >= 3) {
        orGroups.push(tok);
      }
    }

    if (isOpinionIntent) {
      const opinionTerms = isItalian
        ? '(opinioni OR esperienza OR recensioni OR problemi OR vantaggi OR usabilità OR commenti)'
        : '(opinion OR experience OR usability OR workflow OR review OR feedback OR pros OR cons)';
      const subjPart = orGroups.length > 0 ? orGroups.slice(0, 2).join(' AND ') : coreTokens[0];
      primaryExpressions.push(`${subjPart} AND ${opinionTerms} -${exclusions.slice(0, 3).join(' -')}`);
    } else if (isMetricIntent) {
      const metricTerms = isItalian
        ? '(costo OR prezzo OR impatto OR crescita OR dati OR mercato OR riduzione)'
        : '(cost OR price OR impact OR growth OR data OR market OR rate)';
      const subjPart = orGroups.length > 0 ? orGroups.slice(0, 2).join(' AND ') : coreTokens[0];
      primaryExpressions.push(`${subjPart} AND ${metricTerms} -${exclusions.slice(0, 3).join(' -')}`);
    } else if (orGroups.length > 0) {
      primaryExpressions.push(`${orGroups.join(' AND ')} -${exclusions.slice(0, 3).join(' -')}`);
    }

    // 3. Exact phrase or multi-term proximity rule if 2+ subject tokens exist
    if (coreTokens.length >= 2) {
      const exactPair = `"${coreTokens.slice(0, 2).join(' ')}"`;
      const extra = coreTokens.slice(2, 5).join(' ');
      primaryExpressions.push(extra ? `${exactPair} ${extra}` : `${exactPair} OR ${coreTokens.join(' AND ')}`);
    }

    // 4. Regex rule for quantitative data or core acronyms/terms
    if (isMetricIntent) {
      regexPatterns.push('/\\b\\d+(?:[.,]\\d+)?\\s*(?:%|€|\\$|EUR|USD|MW|GW|kWh|MWh|mln|mld|billion|million)\\b/i');
    } else {
      const regexAlternates = [];
      for (const tok of coreTokens.slice(0, 4)) {
        const cleanTok = escapeRegex(tok);
        if (cleanTok.length >= 2) regexAlternates.push(cleanTok);
      }
      if (isOpinionIntent) {
        regexAlternates.push(...(isItalian ? ['recension[ei]', 'esperienz[ae]', 'usabilit[aà]'] : ['usability', 'workflow', 'burnout', 'review']));
      }
      if (regexAlternates.length > 0) {
        regexPatterns.push(`/\\b(${regexAlternates.join('|')})\\b/i`);
      }
    }

    // 5. Target DOM elements selection
    const targetElements = ['paragraphs', 'lists', 'visuals'];
    if (isOpinionIntent) {
      targetElements.splice(1, 0, 'quotes_comments');
    } else {
      targetElements.push('quotes_comments');
    }
    if (isMetricIntent || isVisualIntent) {
      targetElements.splice(1, 0, 'tables');
    } else {
      targetElements.push('tables');
    }

    // 6. Recommended web queries
    const webQueries = [
      raw,
      isOpinionIntent
        ? `${corePhrase} ${isItalian ? 'opinioni esperienze forum recensioni' : 'user reviews experiences forum discussion'}`
        : `${corePhrase} ${isItalian ? 'dati studio report analisi' : 'research study report analysis'}`,
      `${corePhrase} ${isItalian ? 'statistiche approfondimento' : 'pros cons benchmark'}`
    ];

    const strategy = {
      objective: isItalian
        ? `Estrazione automatica su: ${raw}`
        : `Automated extraction plan for: ${raw}`,
      keyConcepts: Array.from(new Set(keyConcepts)),
      primaryExpressions,
      regexPatterns,
      exclusions,
      targetElements: Array.from(new Set(targetElements)),
      recommendedMinScore: isOpinionIntent ? 12 : 15,
      enableVisualScan: true,
      webQueries,
      advice: isOpinionIntent
        ? 'Scanning paragraphs, blockquotes, user comments, and review lists.'
        : 'Scanning paragraphs, data tables, bullet lists, and figure captions.',
      isLocalAutoPlan: true
    };

    strategy.compiledExpressions = compileStrategyExpressions(strategy);
    return strategy;
  }

  /**
   * Translates a /pattern/flags regex string into a concise human-readable label
   * so Synced tags show what the regex represents instead of raw syntax.
   */
  function describeRegex(rxString) {
    const raw = String(rxString || '').trim();
    const m = raw.match(/^\/(.+)\/([gimsuy]*)$/);
    if (!m) return raw;

    let body = m[1].trim();
    const core = body.replace(/^\\b|\\b$/g, '').trim();

    // 1. Year ranges: \b202[0-6]\b or \b20(2[0-6])\b or \b(19|20)\d{2}\b
    const yearRangeMatch = core.match(/^(\d{2,3})\[(\d)-(\d)\]$/);
    if (yearRangeMatch) {
      const prefix = yearRangeMatch[1];
      return `Years ${prefix}${yearRangeMatch[2]}–${prefix}${yearRangeMatch[3]}`;
    }
    const yearGroupMatch = core.match(/^(\d{2})\((\d)\[(\d)-(\d)\]\)$/);
    if (yearGroupMatch) {
      const prefix = `${yearGroupMatch[1]}${yearGroupMatch[2]}`;
      return `Years ${prefix}${yearGroupMatch[3]}–${prefix}${yearGroupMatch[4]}`;
    }
    if (/^(?:\(\\d\{4\}\)|\\d\{4\}|\(19\|20\)\\d\{2\})$/.test(core)) {
      return '4-digit years';
    }

    // 2. Percentages: \d+...%
    if (/\\d/.test(core) && /%/.test(core)) {
      return 'Percentages (%)';
    }

    // 3. Currency amounts (require escaped \$ or currency codes/symbols, not end-of-line $ anchor)
    if (/\\d/.test(core) && /(?:€|\\\$|\[[^\]]*\$[^\]]*\]|\b(?:EUR|USD|GBP)\b)/i.test(core)) {
      return 'Currency amounts';
    }

    // 4. Numbers + explicit units group: \b\d+(?:[.,]\d+)?\s*(MW|GW|kWh)\b
    const unitMatch = core.match(/\\d\+.*\(([^()]+)\)$/);
    if (unitMatch && /\|/.test(unitMatch[1]) && !unitMatch[1].startsWith('?:')) {
      const units = unitMatch[1].split('|').map(u => u.trim()).filter(Boolean);
      if (units.length > 0) return `Numbers (${units.join(' / ')})`;
    }

    // 5. Word prefix with alternative suffixes: telemedic(ina|ine|al)
    const suffixVariantMatch = core.match(/^([a-zA-Z0-9àèéìòùÀÈÉÌÒÙ_-]+)\(([^()]+)\)$/);
    if (suffixVariantMatch && /\|/.test(suffixVariantMatch[2])) {
      const prefix = suffixVariantMatch[1];
      const alts = suffixVariantMatch[2].split('|').map(s => `${prefix}${s.trim()}`).filter(Boolean);
      if (alts.length > 0 && alts.length <= 5) return alts.join(' / ');
    }

    // 6. Clean top-level alternation: (ISO\s*\d+|HL7\s*FHIR|GDPR) or (?:...)
    const unwrapped = core.replace(/^\((?:\?:)?(.+)\)$/, '$1');
    if (/\|/.test(unwrapped) && !/\([^)]*\|/.test(unwrapped)) {
      const parts = unwrapped
        .split('|')
        .map(p => p.replace(/\\b/g, '').replace(/\\s[*+?]?/g, ' ').replace(/\\d\+/g, '#').replace(/\\d\*/g, '#').trim())
        .filter(Boolean);
      if (parts.length > 1 && parts.length <= 5) {
        return parts.join(' / ');
      }
    }

    // 7. Pure digits
    if (/^(?:\\d\+|\[0-9\]\+)$/.test(core)) {
      return 'Numbers';
    }

    // 8. Generic humanizer fallback
    const humanized = core
      .replace(/\\b/g, '')
      .replace(/\\s[*+?]?/g, ' ')
      .replace(/\\d\+/g, '<num>')
      .replace(/\\d\{(\d+)\}/g, '<$1 digits>')
      .replace(/\\w\+/g, '<word>')
      .replace(/\s{2,}/g, ' ')
      .trim();

    return humanized ? `Pattern: ${humanized}` : `Regex: ${raw}`;
  }

  const ExpressionEngine = {
    splitExpressions,
    parseSingleExpression,
    evaluateBlockAgainstExpression,
    evaluateBlock,
    stemToken,
    normalizeDiacritics,
    compileStrategyExpressions,
    extractTermsFromExpressions,
    describeRegex,
    buildScrapingPlanFromQuestion
  };

  root.ExpressionEngine = ExpressionEngine;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ExpressionEngine;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
