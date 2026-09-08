````md
# Fact Knowledge Layer

The **Fact Knowledge Layer** extracts factual claims from PDFs, keeps every fact grounded to its source page and verbatim evidence, and finds relationships between facts across documents.

Facts can be classified as:

- **Corroborates** — facts support each other
- **Contradicts** — facts genuinely disagree
- **Reconciled by context** — differences are explained by time, units, qualifiers, etc.
- **Unrelated** — facts are not meaningfully comparable

The complete pipeline runs during ingestion:

**extract → embed → canonicalize → match → judge**

This is not a RAG chatbot. The main UI is a fact and relationship browser.

## Demo Video

https://drive.google.com/file/d/1Y3jPCyBXYpRbTd3U2Rnqw421fA3hBqus/view

## Setup

### Requirements

- Node.js 18+
- Gemini API key

```bash
git clone https://github.com/tihsra/superAssignment.git
cd fact-knowledge-layer
npm install
````

Create a `.env` file and add:

```bash
cp .env.example .env
````

```env
GEMINI_API_KEY=your_api_key
```

Get a key from:

[https://aistudio.google.com/apikey](https://aistudio.google.com/apikey)

The project is designed around the Gemini AI Studio free-tier setup and does not require a credit card or GCP project.

Build and run:

```bash
npm run build
npm start
```

Open:

```text
http://localhost:3001
```

Upload a PDF and wait for it to reach `ready` status. Upload a second document with overlapping subject matter to explore relationships between facts.

### Development

For faster testing, set: {ideally use 2-3 if using free gemini API key} 

```env
DEV_MAX_PAGES=3
```

This limits ingestion to the first few pages.

## Troubleshooting

### `better-sqlite3` build errors

If `npm install` fails with errors such as:

```text
Could not locate the bindings file
```

or native compilation errors involving `v8::Object`, `GetPrototype`, or `PropertyCallbackInfo::This`, your Node.js version may be newer than the available `better-sqlite3` binaries.

Using a current LTS version such as Node 18, 20, or 22 is recommended:

```bash
nvm install 22
nvm use 22
```

If npm reports that install scripts are blocked:

```bash
npm install-scripts approve better-sqlite3
npm install
```

## Approach

### Why this is not RAG

Traditional RAG retrieves information when a user asks a question.

This project instead processes documents upfront and builds a structured fact store. The goal is to understand relationships between facts across the entire document corpus.

The pipeline is:

```text
PDF
 ↓
Page text extraction
 ↓
Page classification
 ↓
Fact extraction
 ↓
Embedding
 ↓
Metric canonicalization
 ↓
Candidate matching
 ↓
LLM judging
 ↓
Stored fact relationships
```

A Q&A layer could be added later, but it is outside the scope of this version.

### Fixed Fact Structure

Every extracted fact follows the same structure:

```text
entity
metric
value
unit
time_scope
qualifiers
evidence
```

The structure is defined in `src/types.ts`.

The actual entities and metrics are extracted dynamically from each document. There are no hardcoded company names, metric lists, or document-specific extraction branches.

### Page Classification

Pages are classified as:

```text
tabular | narrative | mixed
```

This is important because complex financial tables can lose their row, column, and period relationships when converted into plain text.

The tabular extraction prompt therefore asks the model to reconstruct the relevant column headers and periods before extracting facts.

To reduce Gemini API usage, obvious page types are identified using lightweight heuristics. Only ambiguous pages require an additional LLM classification call.

Implementation:

```text
src/ingestion/pageClassifier.ts
```

### Candidate Matching

Comparing every fact against every other fact would become expensive as the corpus grows.

Instead, `sqlite-vec` cosine KNN search is used to find plausible candidates for each fact.

Only these candidate pairs are sent to the LLM judge.

This reduces the number of expensive reasoning calls while still allowing facts from different documents to be compared.

### Metric Canonicalization

Different documents may use different names for similar metrics.

Metric canonicalization uses embedding similarity to group related metric names instead of relying on a hardcoded synonym dictionary.

The default threshold is:

```env
CANONICAL_SIMILARITY_THRESHOLD=0.90
```

The threshold is intentionally conservative.

For example:

```text
Total income = ₹8,594 Cr
Revenue from services = ₹8,142 Cr
```

These should not automatically be treated as contradictory because they can represent different concepts. Total income can include components that revenue from services does not.

The system therefore prefers leaving `metric_canonical` as `null` rather than incorrectly merging two different metrics.

### Incremental Canonicalization

Canonicalization is incremental.

When a new document is ingested, its metric vocabulary is compared against existing metric cluster representatives rather than the entire fact corpus.

The relevant tables are:

```text
metric_clusters
metric_cluster_members
```

If a new document connects an existing metric to a cluster, facts from earlier documents can also be updated with the resulting canonical label.

This avoids rebuilding the entire metric vocabulary every time a document is added.

### Gemini API Rate Limits

The Gemini free tier has request and quota limits, which can become noticeable during development and when processing large PDFs.

The project includes:

* Disk-based LLM response caching
* `DEV_MAX_PAGES` for limited development runs
* Exponential backoff for rate-limit errors

Caching is enabled by default:

```env
LLM_CACHE_ENABLED=true
```

This prevents repeated development runs against the same input from unnecessarily consuming API quota.

## Implementation Notes

### PDF Parser

The project initially used `pdf-parse`, but it failed on a valid modern PDF with a:

```text
bad XRef entry
```

error.

The implementation was therefore changed to use `pdfjs-dist` directly in:

```text
src/ingestion/pdfExtractor.ts
```

This provides a more current PDF parsing layer and better control over page-level extraction.

### Gemini SDK and Model Updates

The Gemini integration uses the newer:

```text
@google/genai
```

SDK.

The extraction and embedding models are configurable through `.env`, allowing model IDs to be updated without changing the rest of the pipeline.

The embedding request is configured for 768 dimensions to match the existing `sqlite-vec` schema.

If Google changes or retires a model, the model configuration can be updated independently of the application logic.

## Limitations

### PDF Parsing

PDFs are layout-oriented rather than structured-data documents. Complex layouts can therefore still cause extraction problems.

Possible issues include:

* Unusual reading order
* Multi-column pages
* Complex tables
* Repeated headers
* Headers becoming separated from their values
* Incorrect reconstruction of table structure

A future visual extraction step could improve handling of difficult documents.

### Charts and Images

Information that exists only inside charts or images may not be present in the PDF text layer.

The current pipeline therefore cannot reliably extract every number from visual-only content.

A future version could render these pages and use a multimodal model for visual extraction.

### Table Extraction

Complex multi-level tables can sometimes result in a value being associated with the wrong column or reporting period.

The tabular prompt attempts to reduce this problem by reconstructing the table structure first, but extraction is still model-based rather than fully deterministic.

### Gemini API Limits

Large PDFs can require many Gemini API calls and may hit free-tier limits.

Caching and development page limits reduce unnecessary calls, but they do not remove the underlying quota restrictions.

A production version would likely require higher API limits, batching, queueing, and additional caching.

### Semantic Matching

Embedding similarity can sometimes be broader than the actual meaning of a fact.

For example, unrelated facts from a financial document may still become candidate matches because they share financial terminology or context.

The LLM judge is responsible for filtering these cases and identifying them as unrelated, but the candidate-generation stage can still produce some noisy comparisons.

### Metric Canonicalization

Metric clustering depends on embedding quality, particularly for short metric names.

The `0.90` threshold is intentionally conservative and may need further tuning against a larger real-world corpus.

### Known Chart-Label Edge Case

The assignment documentation describes a chart extraction issue where a chart axis repeats `Q3 FY24` even though surrounding charts indicate a different period progression.

This type of issue is representative of the limitations of text-based PDF extraction and would be better handled by cross-chart validation or a visual extraction pass.

### No Free-text Q&A

The application does not currently provide a natural-language Q&A interface.

The focus of this version is the underlying fact and relationship layer. A Q&A interface could be built on top of the existing fact store later.

### No Production Authentication

Authentication, authorization, and multi-tenancy are not implemented. The application is intended as a local/demo implementation rather than a production SaaS deployment.

## API

```text
POST   /documents
       Upload a PDF using multipart field "file".
       Returns document_id immediately.
       Processing happens asynchronously.

GET    /documents
       List all documents.

GET    /documents/:id
       Get document status and metadata.

GET    /documents/:id/facts
       Get facts extracted from a document.

GET    /facts/:id
       Get a single fact with its evidence.

GET    /facts/:id/relationships
       Get relationships involving a fact.

GET    /relationships
       Browse all relationships.

       Optional filter:
       ?type=corroborates
       ?type=contradicts
       ?type=reconciled_by_context
       ?type=unrelated
```

## Repository Structure

```text
/src
  /ingestion       — PDF extraction and page classification
  /extraction      — fact extraction prompts
  /matching        — embeddings, matching, canonicalization
  /judging         — relationship judging
  /storage         — SQLite and sqlite-vec
  /api              — Express API
  /llm              — Gemini client, cache, retry logic
  /pipeline         — ingestion orchestration

/web                — frontend

/test               — automated tests

/scripts             — CLI and development utilities
```

```
```
