import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ExpressionEngine = require('../shared/expression-engine.js');
const StorageManager = require('../shared/storage.js');
const Exporter = require('../shared/exporter.js');
const GeminiClient = require('../shared/gemini.js');

async function runTests() {
  console.log('1. Verifica GeminiClient (validazione parametri e modello)...');
  assert.equal(GeminiClient.DEFAULT_MODEL, 'gemini-2.5-flash');
  assert.equal(GeminiClient.normalizeModelName('gemini-3.8-flash'), 'gemini-2.5-flash', 'Deve migrare automaticamente gemini-3.8-flash a gemini-2.5-flash');
  assert.equal(GeminiClient.normalizeModelName('gemini-3.8-pro'), 'gemini-2.5-pro');
  assert.equal(GeminiClient.normalizeModelName('gemini-1.5-flash'), 'gemini-2.0-flash');
  const testNoKey = await GeminiClient.testConnection('');
  assert.equal(testNoKey.ok, false);

  // Test salvataggio e sanificazione automatica chiave API (es. con virgolette, export da .env, Bearer, e migrazione modello)
  await StorageManager.saveGeminiSettings({ apiKey: '  "AIzaSyDemoKey123456"  ', model: 'gemini-3.8-flash' });
  const settings = await StorageManager.getGeminiSettings();
  assert.equal(settings.apiKey, 'AIzaSyDemoKey123456', 'Deve sanificare la chiave rimuovendo spazi e virgolette');
  assert.equal(settings.model, 'gemini-2.5-flash', 'Deve normalizzare il modello salvato');

  // Cambiare solo il modello non deve mai sovrascrivere la chiave salvata
  await StorageManager.saveGeminiSettings({ model: 'gemini-2.0-flash' });
  const settingsAfterModelChange = await StorageManager.getGeminiSettings();
  assert.equal(settingsAfterModelChange.apiKey, 'AIzaSyDemoKey123456', 'Il cambio modello deve preservare la chiave esistente');
  assert.equal(settingsAfterModelChange.model, 'gemini-2.0-flash');

  await StorageManager.saveGeminiSettings({ apiKey: 'export GEMINI_API_KEY=\u200B"AIzaSyEnvKey789"\n' });
  const settingsEnv = await StorageManager.getGeminiSettings();
  assert.equal(settingsEnv.apiKey, 'AIzaSyEnvKey789', 'Deve estrarre la chiave pulita se incollata in formato .env con caratteri invisibili');

  const visualNoKey = await GeminiClient.analyzeVisualMedia({ base64Data: 'AAAA', mimeType: 'image/png' }, '');
  assert.equal(visualNoKey.ok, false, 'analyzeVisualMedia deve rifiutare API key vuota');
  const visualEmpty = await GeminiClient.analyzeVisualMedia({ base64Data: '', mimeType: 'image/png' }, 'AIzaSyTestKey');
  assert.equal(visualEmpty.ok, false, 'analyzeVisualMedia deve rifiutare payload vuoto');

  // Test switching between Cloud API and Local Open AI (Ollama)
  assert.equal(GeminiClient.normalizeOllamaUrl('127.0.0.1:11434/'), 'http://127.0.0.1:11434');
  await StorageManager.updateSettings({
    aiProvider: 'ollama',
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: 'qwen2.5:3b',
    ollamaVisionModel: 'qwen2.5vl:3b'
  });
  const ollamaCreds = await StorageManager.getGeminiSettings();
  assert.equal(ollamaCreds.aiProvider, 'ollama');
  assert.equal(ollamaCreds.ollamaModel, 'qwen2.5:3b');
  assert.equal(ollamaCreds.ollamaVisionModel, 'qwen2.5vl:3b');

  // Mock fetch to verify Ollama model discovery & local chat interpretation without real server
  const origFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      if (String(url).endsWith('/api/tags')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ models: [{ name: 'qwen2.5:3b' }, { name: 'qwen2.5vl:3b' }] })
        };
      }
      if (String(url).endsWith('/api/chat')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            message: {
              content: JSON.stringify({
                objective: 'Analyze EHR user feedback',
                keyConcepts: ['EHR', 'usability', 'clinicians'],
                primaryExpressions: ['"EHR" (usability OR feedback)', 'EHR tools experience'],
                regexPatterns: ['/\\b(ehr|emr)\\b/i'],
                exclusions: ['sponsored', 'login'],
                targetElements: ['paragraphs', 'quotes_comments'],
                recommendedMinScore: 14,
                webQueries: ['ehr tools reddit reviews']
              })
            }
          })
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    };
    const ollamaConn = await GeminiClient.testConnection(ollamaCreds);
    assert.equal(ollamaConn.ok, true, 'Ollama testConnection deve rilevare i modelli locali');
    assert.deepEqual(ollamaConn.visionModels, ['qwen2.5vl:3b']);

    const ollamaInterp = await GeminiClient.interpretResearchPrompt('thoughts of people on ehr tools', ollamaCreds);
    assert.equal(ollamaInterp.ok, true, 'Ollama interpretResearchPrompt deve restituire strategia valida');
    assert.ok(ollamaInterp.strategy.compiledExpressions.includes('-sponsored'));

    // Verifica parsing di gruppi OR tra parentesi, frasi OR e impacchettamento keyConcepts
    const boolEval = ExpressionEngine.evaluateBlock(
      'Il Fascicolo Sanitario Elettronico integra standard HL7 FHIR negli ospedali italiani.',
      'Sanità digitale',
      '("Fascicolo Sanitario Elettronico" OR "Cartella Clinica Elettronica") AND (HL7 OR interoperability) -cookie'
    );
    assert.equal(boolEval.matched, true, 'Deve valutare correttamente gruppi OR tra parentesi e frasi multiple');

    const packedExpr = ExpressionEngine.compileStrategyExpressions({
      primaryExpressions: ['"Cartella Clinica Elettronica" Italia'],
      keyConcepts: ['Fascicolo Sanitario Elettronico', 'HL7 FHIR', 'AGENAS', 'sanità digitale', 'SIO'],
      exclusions: ['cookie', 'login'],
      regexPatterns: []
    });
    assert.ok(packedExpr.includes('"Fascicolo Sanitario Elettronico" OR "HL7 FHIR"'), 'compileStrategyExpressions deve includere le keyword AI non presenti in primaryExpressions');

    // Verifica assenza di tagli con >16 keyword e >4 esclusioni
    const twentyKeywords = Array.from({ length: 20 }, (_, i) => `Keyword${i + 1}`);
    const sixExclusions = ['cookie', 'privacy', 'login', 'newsletter', 'lavora con noi', 'banner'];
    const fullExpr = ExpressionEngine.compileStrategyExpressions({
      primaryExpressions: ['FSE'],
      keyConcepts: twentyKeywords,
      exclusions: sixExclusions,
      regexPatterns: []
    });
    assert.ok(fullExpr.includes('Keyword20'), 'Non deve tagliare oltre 16 keyword');
    assert.ok(fullExpr.includes('-"lavora con noi"') && fullExpr.includes('-banner'), 'Non deve tagliare oltre 4 esclusioni');

    const extracted = ExpressionEngine.extractTermsFromExpressions(
      '("FSE" OR "HL7 FHIR") AND AGID -cookie -"lavora con noi"'
    );
    assert.deepEqual(extracted.keywords, ['FSE', 'HL7 FHIR', 'AGID']);
    assert.deepEqual(extracted.exclusions, ['cookie', 'lavora con noi']);
  } finally {
    globalThis.fetch = origFetch;
    await StorageManager.updateSettings({ aiProvider: 'cloud' });
  }

  console.log('   ✓ GeminiClient, Cloud API e Open AI (Ollama) OK');

  console.log('2. Verifica ExpressionEngine con espressione naturale in italiano...');
  const sampleParagraph =
    "Nel corso del 2025, la crescita dell'energia rinnovabile in Italia ha avuto un forte impatto sulla riduzione del costo della bolletta elettrica per famiglie e imprese, grazie ai nuovi impianti fotovoltaici.";
  const sampleHeading = 'Analisi del mercato elettrico nazionale';

  // L'utente scrive un'espressione naturale con plurali/preposizioni diverse dal testo esatto
  const naturalExpr = "impatto delle energie rinnovabili sul costo dell'elettricità in Italia";
  const resNatural = ExpressionEngine.evaluateBlock(sampleParagraph, sampleHeading, naturalExpr);

  assert.equal(resNatural.matched, true, 'Deve fare match con un\'espressione naturale pertinente');
  assert.ok(resNatural.score >= 50, `Il punteggio (${resNatural.score}) deve essere alto`);
  console.log('   ✓ Match espressione naturale OK — Score:', resNatural.score, 'Termini:', resNatural.matchedTerms);

  console.log('2. Verifica operatori booleani, frasi esatte, esclusioni e Regex...');
  // Test esclusione (-fossile)
  const resExcluded = ExpressionEngine.evaluateBlock(
    'I pannelli fotovoltaici riducono l\'uso di combustibile fossile.',
    'Transizione',
    '"pannelli fotovoltaici" -fossile'
  );
  assert.equal(resExcluded.matched, false, 'Deve escludere il blocco se contiene il termine preceduto da -');

  // Test Regex su grandezze energetiche
  const resRegex = ExpressionEngine.evaluateBlock(
    'Il nuovo parco solare produce fino a 450 MW di potenza di picco.',
    'Dati tecnici',
    '/\\b\\d+\\s*(MW|GW|kWh)\\b/i'
  );
  assert.equal(resRegex.matched, true, 'Deve fare match con una Regex valida');
  assert.ok(resRegex.matchedTerms.includes('450 MW'));
  console.log('   ✓ Operatori e Regex OK');

  console.log('3. Verifica StorageManager (creazione progetto e deduplicazione)...');
  const proj = await StorageManager.createProject({
    name: 'Dossier Rinnovabili 2026',
    description: 'Studio sull\'energia solare ed eolica in Europa',
    expressions: `${naturalExpr}\n/\\b\\d+\\s*(MW|GW)\\b/i`
  });

  const item1 = {
    text: sampleParagraph,
    heading: sampleHeading,
    blockType: 'p',
    score: resNatural.score,
    matchedExpressions: [naturalExpr],
    matchedTerms: resNatural.matchedTerms,
    tags: ['italia', 'costi'],
    note: 'Dato chiave sul risparmio in bolletta',
    source: {
      url: 'https://esempio-energia.it/report-2026#sez1',
      canonicalUrl: 'https://esempio-energia.it/report-2026',
      domain: 'esempio-energia.it',
      title: 'Report Energia Rinnovabile 2026',
      author: 'Marco Rossi',
      publishedDate: '2026-03-15',
      license: 'Creative Commons CC BY 4.0'
    }
  };

  const add1 = await StorageManager.addExtractedItems([item1], proj.id);
  assert.equal(add1.addedCount, 1);

  // Reinserimento dello stesso estratto con una nuova espressione: deve deduplicare e unire i metadati
  const item1Duplicate = {
    ...item1,
    matchedExpressions: ['impianti fotovoltaici'],
    tags: ['fotovoltaico']
  };
  const add2 = await StorageManager.addExtractedItems([item1Duplicate], proj.id);
  assert.equal(add2.addedCount, 0, 'Non deve duplicare lo stesso paragrafo dalla stessa fonte');
  assert.equal(add2.updatedCount, 1, 'Deve aggiornare l\'estratto esistente unendo espressioni e tag');
  assert.equal(add2.project.items[0].tags.length, 3);

  // Verifica salvataggio impostazioni ibride, metadati media e toggle AI Interpreter
  const updatedSettings = await StorageManager.updateSettings({
    includeLocalVisuals: true,
    autoAiOcr: true,
    interpreterEnabled: false
  });
  assert.equal(updatedSettings.includeLocalVisuals, true);
  assert.equal(updatedSettings.autoAiOcr, true);
  assert.equal(updatedSettings.interpreterEnabled, false, 'Deve permettere di disattivare AI Interpreter');
  const reenabledSettings = await StorageManager.updateSettings({ interpreterEnabled: true });
  assert.equal(reenabledSettings.interpreterEnabled, true, 'Deve permettere di riattivare AI Interpreter');

  const visualItem = {
    text: 'Grafico crescita solare +28% nel 2025 in Italia',
    heading: 'Grafico capacità fotovoltaica',
    blockType: 'image-ocr',
    score: 88,
    matchedExpressions: ['AI Visual OCR'],
    matchedTerms: ['solare', 'Italia'],
    tags: ['image-ocr'],
    media: {
      kind: 'image',
      url: 'https://esempio-energia.it/charts/solare-2026.png',
      width: 800,
      height: 450,
      ocr: true
    },
    source: item1.source
  };
  const addVisual = await StorageManager.addExtractedItems([visualItem], proj.id);
  assert.equal(addVisual.addedCount, 1);
  assert.equal(addVisual.project.items[0].media.url, 'https://esempio-energia.it/charts/solare-2026.png');
  console.log('   ✓ Storage, impostazioni visual e deduplicazione OK');

  console.log('4. Verifica Exporter (.md, .json, .csv)...');
  const md = Exporter.generateMarkdown(addVisual.project, { groupBy: 'expression' });
  assert.ok(md.includes('title: "Dossier Rinnovabili 2026"'), 'Il Markdown deve avere il frontmatter YAML');
  assert.ok(md.includes('Creative Commons CC BY 4.0'), 'Il Markdown deve riportare la licenza della fonte');
  assert.ok(md.includes('https://esempio-energia.it/charts/solare-2026.png'), 'Il Markdown deve includere il link media dell\'estratto visivo');
  assert.ok(md.includes('## Source Registry & Legal Attribution'), 'Il Markdown deve avere la tabella bibliografica');

  const jsonStr = Exporter.generateJSON(addVisual.project, { groupBy: 'domain' });
  const parsedJson = JSON.parse(jsonStr);
  assert.equal(parsedJson.project.stats.totalExtracts, 2);
  assert.equal(parsedJson.legalCompliance.publicContentOnly, true);

  const csvStr = Exporter.generateCSV(addVisual.project);
  assert.ok(csvStr.startsWith('\uFEFFExtract_ID,Relevance_Score'));
  assert.ok(csvStr.includes('Media_URL'));
  assert.ok(csvStr.includes('esempio-energia.it/charts/solare-2026.png'));
  console.log('   ✓ Generazione file .md, .json e .csv OK');

  console.log('5. Verifica generazione automatica piano di scraping da domanda Interpreter...');
  const autoPlan = ExpressionEngine.buildScrapingPlanFromQuestion('thoughts of people on ehr tools');
  assert.ok(autoPlan, 'Il piano di scraping deve essere generato');
  assert.ok(autoPlan.primaryExpressions.length >= 2, 'Deve generare espressioni primarie');
  assert.ok(autoPlan.regexPatterns.length >= 1, 'Deve generare pattern regex dedicati');
  assert.ok(autoPlan.exclusions.length >= 2, 'Deve generare esclusioni anti-rumore');
  assert.ok(autoPlan.targetElements.includes('quotes_comments'), 'Domande su opinioni devono attivare quotes_comments');
  assert.ok(autoPlan.webQueries.length >= 2, 'Deve generare query di ricerca web');
  assert.ok(autoPlan.compiledExpressions.includes('-'), 'Le espressioni compilate devono includere esclusioni -term');

  const sampleEhrReview = 'Clinicians report that modern EHR tools have improved charting speed, though usability feedback remains mixed in hospital workflows.';
  const ehrEval = ExpressionEngine.evaluateBlock(
    sampleEhrReview,
    'User Feedback on EHR Systems',
    autoPlan.compiledExpressions
  );
  assert.ok(ehrEval.matched, 'Le regole auto-generate dalla domanda devono catturare blocchi pertinenti su EHR tools');
  console.log('   ✓ Auto-popolazione Extraction & Scanner da domanda Interpreter OK');

  console.log('6. Verifica regressioni e ottimizzazioni (ExpressionEngine, GeminiClient, StorageManager, Exporter)...');

  // 6a. ExpressionEngine: pipe-OR tra parentesi, AND+OR misti, stop-word booleane minuscole, Unicode NFD
  const pipeOrRes = ExpressionEngine.evaluateBlock(
    'La piattaforma adotta lo standard FHIR negli ospedali.',
    'Interoperabilità',
    '(HL7 | FHIR) AND ospedali'
  );
  assert.equal(pipeOrRes.matched, true, 'Deve supportare (A | B) con pipe OR tra parentesi');

  const mixedAndOrMatch = ExpressionEngine.evaluateBlock(
    'Clinicians shared mixed feedback on the new EHR.',
    'Report',
    'EHR AND usability OR feedback'
  );
  assert.equal(mixedAndOrMatch.matched, true, 'EHR AND usability OR feedback deve fare match con EHR + feedback');

  const mixedAndOrMiss = ExpressionEngine.evaluateBlock(
    'The usability of this calendar app is great.',
    'Report',
    'EHR AND usability OR feedback'
  );
  assert.equal(mixedAndOrMiss.matched, false, 'EHR AND usability OR feedback non deve fare match senza EHR');

  const lowercaseBoolStop = ExpressionEngine.evaluateBlock(
    'Solar power capacity grew rapidly in 2025.',
    'Energy',
    'solar and power'
  );
  assert.equal(lowercaseBoolStop.matched, true, 'and/or/not minuscoli non devono diventare concetti obbligatori');
  assert.ok(!lowercaseBoolStop.matchedTerms.includes('and'));

  const nfdText = 'Il caffe\u0300 e\u0300 ottimo per la ricerca.';
  const nfdRes = ExpressionEngine.evaluateBlock(nfdText, 'Test', 'caffe');
  assert.equal(nfdRes.matched, true, 'collectOriginalMatches deve gestire testo NFD senza errori di lunghezza');
  assert.ok(nfdRes.matchedTerms.length >= 1, 'Deve restituire almeno un termine trovato su testo NFD');

  // 6a-bis. Keyword multi-parola unite (es. "mary lucier"), virgole ed esclusioni globali su riga separata (-1975)
  const unsplitTags = ExpressionEngine.extractTermsFromExpressions(
    'mary lucier\ndawn burn paris, technique\n-1975\n1977'
  );
  assert.deepEqual(
    unsplitTags.keywords,
    ['mary lucier', 'dawn burn paris', 'technique', '1977'],
    'Righe semplici multi-parola e separate da virgola devono restare intere nei Synced tags'
  );
  assert.deepEqual(unsplitTags.exclusions, ['1975']);

  const separatedWordsRes = ExpressionEngine.evaluateBlock(
    'Mary went to Paris and later Lucier exhibited a video.',
    'Bio',
    'mary lucier'
  );
  assert.equal(separatedWordsRes.matched, false, '"mary lucier" su una riga non deve fare match con "Mary" e "Lucier" separati');

  const adjacentPhraseRes = ExpressionEngine.evaluateBlock(
    'Video art installation by Mary Lucier shown in 1977.',
    'Exhibition',
    'mary lucier\n-1975'
  );
  assert.equal(adjacentPhraseRes.matched, true, '"mary lucier" deve fare match quando adiacente senza 1975');

  const globalExclRes = ExpressionEngine.evaluateBlock(
    'Early installation by Mary Lucier presented in 1975.',
    'Archive',
    'mary lucier\n-1975'
  );
  assert.equal(globalExclRes.matched, false, 'Esclusione su riga separata (-1975) deve escludere il blocco globalmente');

  const regexTags = ExpressionEngine.extractTermsFromExpressions(
    'solar power\n/\\b202[0-6]\\b/\n/\\b\\d+%\\b/i solar -ads'
  );
  assert.deepEqual(regexTags.regexes, ['/\\b202[0-6]\\b/', '/\\b\\d+%\\b/i']);
  assert.deepEqual(regexTags.keywords, ['solar power', 'solar']);
  assert.deepEqual(regexTags.exclusions, ['ads']);
  assert.equal(ExpressionEngine.describeRegex('/\\b202[0-6]\\b/'), 'Years 2020–2026');
  assert.equal(ExpressionEngine.describeRegex('/\\b\\d+%\\b/i'), 'Percentages (%)');
  assert.equal(
    ExpressionEngine.describeRegex('/\\btelemedic(ina|ine|al)\\b/i'),
    'telemedicina / telemedicine / telemedical'
  );

  // 6b. GeminiClient: Anthropic visual routing + cache key middle slice + fenced/truncated JSON
  const origFetchReg = globalThis.fetch;
  try {
    const requestedUrls = [];
    let anthropicCallCount = 0;
    globalThis.fetch = async (url, init) => {
      requestedUrls.push(String(url));
      if (String(url).includes('api.anthropic.com/v1/messages')) {
        anthropicCallCount++;
        const body = JSON.parse(init.body);
        const userMsg = body.messages[0].content;
        const hasImage = Array.isArray(userMsg) && userMsg.some(c => c.type === 'image');
        if (hasImage) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              content: [{
                text: JSON.stringify({
                  relevant: true,
                  relevanceScore: 80 + anthropicCallCount,
                  summary: `Visual #${anthropicCallCount}`,
                  extractedText: 'Chart data',
                  keyEntities: ['Solar']
                })
              }]
            })
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            content: [{
              text: 'Here is the plan:\n```json\n{"objective":"Solar trends","keyConcepts":["solar","grid"],"primaryExpressions":["solar grid"],"regexPatterns":[],"exclusions":["login"],"targetElements":["paragraphs"],"recommendedMinScore":12,"webQueries":["solar grid"]}\n```\nHope this helps!'
            }]
          })
        };
      }
      throw new Error(`Unexpected URL in regression test: ${url}`);
    };

    const anthropicCreds = {
      aiProvider: 'anthropic',
      apiKey: 'sk-ant-test-key',
      model: 'claude-sonnet-4-20250514'
    };

    const imgA = 'A'.repeat(200) + 'MIDDLE_ONE' + 'Z'.repeat(200);
    const imgB = 'A'.repeat(200) + 'MIDDLE_TWO' + 'Z'.repeat(200);
    const visA = await GeminiClient.analyzeVisualMedia({ base64Data: imgA, mimeType: 'image/png', alt: 'chart1' }, anthropicCreds);
    const visB = await GeminiClient.analyzeVisualMedia({ base64Data: imgB, mimeType: 'image/png', alt: 'chart2' }, anthropicCreds);
    assert.equal(visA.ok, true, 'Anthropic analyzeVisualMedia deve funzionare');
    assert.equal(visB.ok, true, 'Anthropic analyzeVisualMedia deve distinguere immagini con stessa lunghezza e stesso header/trailer');
    assert.equal(anthropicCallCount, 2, 'La cache visiva non deve collidere quando cambia solo la parte centrale');
    assert.ok(requestedUrls.every(u => u.includes('api.anthropic.com')), 'Il provider anthropic non deve chiamare OpenAI');

    const fencedInterp = await GeminiClient.interpretResearchPrompt('solar grid trends prose', anthropicCreds);
    assert.equal(fencedInterp.ok, true, 'parseGeminiJson deve estrarre JSON fenced circondato da prosa');
    assert.equal(fencedInterp.strategy.objective, 'Solar trends');
  } finally {
    globalThis.fetch = origFetchReg;
  }

  // 6c. StorageManager: updateItem recomputes fingerprint + batch addExtractedItems order
  const latestState = await StorageManager.loadState();
  const activeProj = latestState.projects.find(p => p.id === proj.id);
  const firstItem = activeProj.items[0];
  const oldFingerprint = firstItem.fingerprint;
  const updatedItem = await StorageManager.updateItem(proj.id, firstItem.id, {
    text: 'Testo completamente aggiornato per verificare il nuovo fingerprint.'
  });
  assert.notEqual(updatedItem.fingerprint, oldFingerprint, 'updateItem deve ricalcolare il fingerprint quando cambia patch.text');

  // 6d. Exporter: null project, undefined item.text/extractedAt, lone \r in CSV
  const nullMd = Exporter.generateMarkdown(null);
  assert.ok(typeof nullMd === 'string' && nullMd.length > 0, 'generateMarkdown(null) non deve crashare');
  assert.doesNotThrow(() => Exporter.generateJSON(null), 'generateJSON(null) non deve crashare');
  assert.doesNotThrow(() => Exporter.generateCSV(null), 'generateCSV(null) non deve crashare');

  const edgeProj = {
    name: 'Edge Export',
    items: [
      { id: '1', text: undefined, matchedTerms: [null, 'test'], score: 10, source: { domain: 'example.com' } },
      { id: '2', text: 'Line1\rLine2', matchedTerms: ['Line1'], score: 20, extractedAt: '2026-01-01T00:00:00Z', source: { domain: 'example.com' } }
    ]
  };
  const edgeMd = Exporter.generateMarkdown(edgeProj, { groupBy: 'chronological' });
  assert.ok(edgeMd.includes('Edge Export'), 'generateMarkdown deve gestire item.text undefined ed extractedAt mancante');
  const edgeCsv = Exporter.generateCSV(edgeProj);
  assert.ok(!edgeCsv.includes('Line1\rLine2') && edgeCsv.includes('Line1 Line2'), 'generateCSV deve normalizzare \\r isolati');

  // 6e. Nuove regressioni (v0.3.1): splitExpressions unclosed '/', wildcard -term*, non-word phrase bounds, NOT/guillemets, describeRegex, Gemini non-retryable/thinking/repair, Storage null guards, Exporter YAML/date/title
  const unclosedSlashSplit = ExpressionEngine.splitExpressions('AI / ML\nsolar power');
  assert.deepEqual(unclosedSlashSplit, ['AI / ML', 'solar power'], 'Un / isolato su una riga non deve inglobare le righe successive');

  const wildcardExclHit = ExpressionEngine.evaluateBlock('Solar grid deployment grew.', 'Energy', 'solar -test*');
  const wildcardExclDrop = ExpressionEngine.evaluateBlock('Solar grid testing failed.', 'Energy', 'solar -test*');
  assert.equal(wildcardExclHit.matched, true, 'Wildcard exclusion -test* non deve escludere blocchi senza match');
  assert.equal(wildcardExclDrop.matched, false, 'Wildcard exclusion -test* deve escludere "testing"');

  const currencyPhraseMatch = ExpressionEngine.evaluateBlock('Funding reached $100 billion in 2025.', 'Finance', '$100 billion');
  assert.equal(currencyPhraseMatch.matched, true, 'Frasi con caratteri non-word iniziali ($100 billion) devono fare match');

  const notTerms = ExpressionEngine.extractTermsFromExpressions('solar NOT "paid ads" NOT spam -«click bait»');
  assert.deepEqual(notTerms.exclusions, ['paid ads', 'spam', 'click bait'], 'extractTermsFromExpressions deve estrarre NOT "phrase", NOT word e -«...»');
  assert.deepEqual(notTerms.keywords, ['solar']);

  assert.notEqual(ExpressionEngine.describeRegex('/^\\d+$/'), 'Currency amounts', '/^\\d+$/ non deve essere classificato come Currency amounts');
  assert.equal(ExpressionEngine.describeRegex('/\\b\\d+\\b/'), 'Numbers');
  assert.equal(ExpressionEngine.describeRegex('/\\b\\d+(?:[.,]\\d+)?\\s*(MW|GW|kWh)\\b/'), 'Numbers (MW / GW / kWh)');
  assert.equal(ExpressionEngine.describeRegex('/(?:ISO\\s*\\d+|HL7\\s*FHIR)/'), 'ISO # / HL7 FHIR');

  // GeminiClient: non-retryable 400 stops fallback, multi-part/thinking text joined
  const origFetchV31 = globalThis.fetch;
  try {
    let googleCalls = 0;
    globalThis.fetch = async (url) => {
      if (String(url).includes('generativelanguage.googleapis.com')) {
        googleCalls++;
        return {
          ok: false,
          status: 400,
          json: async () => ({ error: { message: 'Invalid API key' } })
        };
      }
      if (String(url).includes('api.anthropic.com/v1/messages')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            content: [
              { type: 'thinking', thinking: 'internal reasoning' },
              { type: 'text', text: '{"objective":"Grid",' },
              { type: 'text', text: '"keyConcepts":["grid"],"primaryExpressions":["grid"],"regexPatterns":[],"exclusions":[],"targetElements":["paragraphs"],"recommendedMinScore":10,"webQueries":["grid"]}' }
            ]
          })
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    };
    const badKeyRes = await GeminiClient.interpretResearchPrompt('solar', {
      aiProvider: 'gemini',
      apiKey: 'AIzaBadKey',
      model: 'gemini-2.5-flash'
    });
    assert.equal(badKeyRes.ok, false);
    assert.equal(googleCalls, 1, 'Errore 400 non-retryable non deve ritentare su tutti i modelli fallback');

    const thinkingRes = await GeminiClient.interpretResearchPrompt('grid', {
      aiProvider: 'anthropic',
      apiKey: 'sk-ant-test',
      model: 'claude-sonnet-4-20250514'
    });
    assert.equal(thinkingRes.ok, true, 'callAnthropicProvider deve unire i blocchi text saltando thinking');
    assert.equal(thinkingRes.strategy.objective, 'Grid');
  } finally {
    globalThis.fetch = origFetchV31;
  }

  // StorageManager: null guards
  const nullProj = await StorageManager.createProject({ name: 'Null Guard Proj', description: null, expressions: null });
  assert.equal(nullProj.description, '');
  assert.equal(nullProj.expressions, '');
  const nullAdd = await StorageManager.addExtractedItems(null, nullProj.id);
  assert.equal(nullAdd.addedCount, 0);
  const nullTagsUpdate = await StorageManager.updateItem(proj.id, firstItem.id, { tags: null });
  assert.ok(Array.isArray(nullTagsUpdate.tags), 'updateItem deve gestire patch.tags: null senza crashare');

  // Exporter: YAML backslash escaping, comma inside regex, invalid extractedAt, bracket/newline in link title
  const yamlEdgeProj = {
    id: 'yaml-edge',
    name: 'YAML Edge',
    expressions: '/\\d{1,3}/, solar',
    items: [
      {
        id: 'y1',
        text: 'Sample solar 123',
        matchedTerms: ['solar'],
        score: 50,
        extractedAt: 'not-a-valid-date',
        source: { title: 'Report [2026]\nDraft', url: 'https://example.com/r', canonicalUrl: 'https://example.com/r', domain: 'example.com' }
      }
    ]
  };
  const yamlEdgeMd = Exporter.generateMarkdown(yamlEdgeProj);
  assert.ok(yamlEdgeMd.includes('expressions: ["/\\\\d{1,3}/", "solar"]'), 'YAML frontmatter deve fare escape di \\ e non spezzare /\\d{1,3}/ sulla virgola');
  assert.ok(yamlEdgeMd.includes('[Report \\[2026\\] Draft](https://example.com/r)'), 'Titolo link Markdown deve fare escape di [ ] e newline');
  assert.ok(yamlEdgeMd.includes('N/A'), 'extractedAt non valido deve produrre N/A invece di Invalid Date');

  console.log('   ✓ Regressioni ExpressionEngine, GeminiClient, StorageManager, Exporter OK');
  console.log('\nTUTTI I TEST COMPLETATI CON SUCCESSO!');
}

runTests().catch(err => {
  console.error('Test fallito:', err);
  process.exit(1);
});
