<p align="center">
  <img src="icons/icon.svg" alt="Defrost logo" width="72" height="72" />
</p>

# Defrost — web research & scraping

**Defrost** is a Firefox WebExtension (Manifest V3) built to extract, filter, and organize web information starting from natural language research prompts. It combines an AI-powered strategy interpreter (**Google Gemini** or local **Ollama**) with a real-time continuous DOM & visual scanner, interactive keyword/exclusion management, and structured exports (`.md`, `.json`, `.csv`).

---

## Key features

### 1) AI interpreter (cloud & local) (`shared/gemini.js`)
- **Dual provider support:** works with **Google Gemini** (cloud API) or a local **Ollama** instance (configurable endpoint).
- **Automated research strategy:** turns natural language prompts into structured objectives, semantic keywords, exclusions (`-NOT`), boolean/regex detection expressions, target DOM elements (`Paragraphs`, `Quotes & Comments`, `Lists`, `Tables`, `Visuals`), and guided web search queries.

### 2) Smart expression & scoring engine (`shared/expression-engine.js`)
- **Natural language & morphological stemming:** supports Italian and English stemming, diacritic normalization, concept coverage, term proximity, and section heading boosts.
- **Advanced operators:**
  - `"exact phrase"` for exact phrase matching
  - `A OR B` / `A AND B` / `(A OR B) AND C` for boolean grouping
  - `-term` / `-"multi word"` / `NOT term` for exclusions
  - `+term` for mandatory terms
  - `prefix*` for wildcards
  - `/pattern/i` for regular expressions

### 3) Extraction & continuous scanner (`content/extractor.js`, `sidebar/sidebar.js`)
- **Continuous live scanning:** captures relevant extracts in real time as you browse and scroll on the active tab, or scans across all open tabs.
- **Interactive keywords & exclusions:** view all active keywords and `-NOT` exclusions as removable pills, add new ones inline (`+ Add keyword or -exclusion`), and keep them bidirectionally synced with the active detection expressions editor.
- **Visual & media extraction:** extracts image alt text, figure captions, SVG chart labels, and supports optional **Auto AI OCR** for page charts and images.
- **Semantic noise filtering & metadata:** strips navigation, footers, cookie banners, and ads, while associating each extract with its section heading (`h1`–`h6`), canonical URL, author, publication date, OpenGraph/Schema.org metadata, and detected license.

### 4) Research dossier & structured exports (`shared/storage.js`, `shared/exporter.js`)
- **Multi-project dossiers:** organizes extracts by project with automatic deduplication, tags, and notes in `browser.storage.local`.
- **Export formats:**
  - **Markdown (`.md`)** — YAML frontmatter, summary stats, grouped extracts, and source bibliography.
  - **JSON (`.json`)** — self-describing schema with source catalog and extract records.
  - **CSV (`.csv`)** — UTF-8 with BOM for direct import into Excel, LibreOffice Calc, and Google Sheets.

---

## Loading the extension in Firefox

- **1)** Open **Mozilla Firefox** and navigate to:
  ```
  about:debugging#/runtime/this-firefox
  ```
- **2)** Click **"Load Temporary Add-on..."**.
- **3)** Select [`manifest.json`](manifest.json) from the repository root (or [`dist/defrost-firefox.xpi`](dist/defrost-firefox.xpi)).
- **4)** Open the **Defrost** sidebar from the toolbar icon or via `View > Sidebar`.

---

## Development, testing & packaging

- **Run unit tests:**
  ```bash
  node tests/test-engine.mjs
  ```
- **Build `.xpi` / `.zip` packages (Windows PowerShell):**
  ```powershell
  powershell -ExecutionPolicy Bypass -File scripts/pack-xpi.ps1
  ```

---

## Project structure

- [`manifest.json`](manifest.json) — Firefox Manifest V3 extension configuration.
- [`shared/expression-engine.js`](shared/expression-engine.js) — natural language parser, IT/EN stemmer, boolean/regex evaluator, and strategy compiler.
- [`shared/gemini.js`](shared/gemini.js) — AI client supporting Google Gemini API and local Ollama.
- [`shared/storage.js`](shared/storage.js) — project, extract deduplication, and settings persistence (`browser.storage.local`).
- [`shared/exporter.js`](shared/exporter.js) — structured dossier exporters for `.md`, `.json`, and `.csv`.
- [`content/extractor.js`](content/extractor.js) & [`content/extractor.css`](content/extractor.css) — DOM semantic extractor, metadata collector, and in-page highlighter.
- [`background/background.js`](background/background.js) — multi-tab scan coordinator, guided search launcher, and context menu integration.
- [`sidebar/sidebar.html`](sidebar/sidebar.html), [`sidebar/sidebar.css`](sidebar/sidebar.css), [`sidebar/sidebar.js`](sidebar/sidebar.js) — main Firefox sidebar UI.
- [`popup/popup.html`](popup/popup.html), [`popup/popup.css`](popup/popup.css), [`popup/popup.js`](popup/popup.js) — toolbar quick popup.
- [`scripts/pack-xpi.ps1`](scripts/pack-xpi.ps1) — packaging script for `.xpi` and `.zip` distribution builds.
- [`tests/test-engine.mjs`](tests/test-engine.mjs) — automated test suite for expression engine, AI client, storage, and exporters.
