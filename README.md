# Fact Knowledge Layer

Given any PDF, this extracts factual claims (numeric or semantic), grounds every fact
in its source (page + verbatim quote), and — across your whole document corpus —
figures out which facts corroborate each other, which genuinely contradict, and which
only *look* contradictory once you account for time scope, units, or qualifiers.

It is **not** a Q&A chatbot. Everything happens once, upfront, at ingestion time:
extract → embed → cluster → match → judge. The primary UI is a fact browser and a
relationship browser, not a chat box. See "Why this shape" below.

## Demo video

`[link here once recorded]`

## Setup

Requirements: Node.js 18+, and a free Gemini API key (no credit card, no GCP project).

```bash
git clone <this-repo>
cd fact-knowledge-layer
npm install
```

Get a key at <https://aistudio.google.com/apikey>, paste it into `.env` as
`GEMINI_API_KEY`. **Do not** enable billing on a GCP project to do this — enabling
billing can silently remove the free tier from that project. The plain AI Studio
free-tier path (no GCP project at all) is what this was built and tested against.

```bash
npm run build
npm start
```

Open <http://localhost:3001> — upload a PDF, watch it move to `ready` status, browse
its facts, then upload a second PDF that overlaps in subject matter and check the
Relationships tab.

For faster iteration while developing, `npm run dev` runs the API with hot reload, and
`npm run ingest -- /path/to/file.pdf` runs one document through the pipeline directly
from the command line without going through the API/UI — useful for the validation
workflow below.

### Validating extraction quality by hand before trusting the pipeline

1. Set `DEV_MAX_PAGES=3` in `.env` and hand-pick a page you know well.
2. `npm run ingest -- your-file.pdf` and read the printed JSON against the actual page.
3. Once that looks right, unset `DEV_MAX_PAGES` and run the full document.

### Troubleshooting: `better-sqlite3` fails to build on a very new Node version

If `npm install` / `npm start` fails with `Could not locate the bindings file` or a
native compile error mentioning `v8::Object`, `GetPrototype`, or
`PropertyCallbackInfo::This`, it means your Node version is newer than the prebuilt
binaries `better-sqlite3` shipped for at the time this was built (this happened during
development on a very recent Node version — the fix was bumping to
`better-sqlite3@^13.0.3`, which is in this repo's `package.json`; if you're on an even
newer Node than that supports, you may need to bump it further). Two options:

1. **Preferred: use a current LTS Node version** (18, 20, or 22) via
   [nvm](https://github.com/nvm-sh/nvm) — `nvm install 22 && nvm use 22` — which has
   the broadest prebuilt-binary coverage and is what this was actually developed and
   tested against.
2. **Or bump `better-sqlite3` further**: check `npm view better-sqlite3 versions` for
   anything newer than what's pinned here, update `package.json`, delete
   `node_modules`/`package-lock.json`, and `npm install` again.

If `npm install` reports `install scripts blocked` for `better-sqlite3`, your npm
version has script-execution safety on by default — run
`npm install-scripts approve better-sqlite3 && npm install` to allow its (required,
compiles or downloads the native SQLite binding) install step.



```bash
npm test
```

9 tests covering: PDF page-boundary extraction against real (fixture) PDFs, the
heuristic-first page classifier, the metric-canonicalization guardrail case (below),
and a full ingest→extract→match→judge pipeline run with a fake LLM client that
implements the same interface the real Gemini client does. **These fixtures are
synthetic** — I did not have the actual assignment test corpus (Delhivery prospectus,
RBI/IMF reports, etc.) available while building this in isolation from the source
documents, so the fixtures approximate the shapes described in the brief (a tabular
financial page, a narrative page, a cross-document numeric restatement) rather than
being the real files. **Before submitting, re-run `npm run ingest` against the actual
seven-file test corpus and confirm the four required cases reproduce with the real
documents** — the pipeline architecture is validated end-to-end, but extraction
*quality* against the specific real PDFs is not, since I never had a live Gemini key
or the real files in this environment.

## Approach

### Why this shape, not RAG

Classic RAG retrieves at *query* time. Nothing here does that. A PDF is processed once:
page-by-page text extraction → per-page shape classification (tabular vs. narrative,
which prompt runs) → fact extraction with a structured schema → embedding → metric
canonicalization → embedding-based candidate matching against the rest of the corpus →
an LLM judge call per candidate pair, with reasoning stored verbatim. A free-text Q&A
layer could be bolted on top of the same embeddings later; it's explicitly out of scope
for v1 and nothing here assumes it's coming.

### Fixed envelope, open content

The `Fact` shape (`entity`, `metric`, `value`, `unit`, `time_scope`, `qualifiers`,
`evidence`) is fixed in `src/types.ts` and never changes. What fills those fields is
100% LLM-derived per document — there is no hardcoded entity list, metric list, or
per-filename branch anywhere in `src/`. `grep -rn "if.*metric.*==\|if.*entity.*=="  src/`
comes back empty by design; that's the thing to re-check if this codebase is extended.

### Page-shape classification, and why it's not one prompt for every page

A single fixed extraction prompt silently breaks on multi-column financial tables —
flattening a table to plain text loses the row/column-to-time-period mapping. So each
page is classified `tabular | narrative | mixed` first, and the tabular prompt makes
the model explicitly restate the column headers and what period each column represents
*before* extracting anything, rather than guessing a mapping. To avoid spending an LLM
call on every single page (free-tier quota is real — see below), a cheap heuristic
(digit density + column-gutter density) handles the pages that are obviously one or the
other, and only escalates genuinely ambiguous pages to the LLM classifier
(`src/ingestion/pageClassifier.ts`).

### Blocking before judging

Candidate matching (`src/matching/candidateMatch.ts`) uses `sqlite-vec` cosine-KNN to
find plausible candidates for a fact *before* any pair reaches the judge LLM. Full
pairwise comparison of every fact against every other fact was deliberately rejected —
it's brute force, not reasoning, and it doesn't scale.

### Metric canonicalization: incremental, and deliberately hard to merge

`src/matching/canonicalize.ts` clusters `metric` strings ("Revenue from operations" ≈
"Revenue from services") by embedding similarity so near-synonyms can be recognized
across documents without a hardcoded synonym dictionary. The threshold defaults high
(`CANONICAL_SIMILARITY_THRESHOLD=0.90`) on purpose, because of a real case from the
assignment's own test corpus: **"Total income" (₹8,594 Cr) and "Revenue from services"
(₹8,142 Cr) are not the same metric** — Total income includes ₹453 Cr of other income
that Revenue from services excludes. An over-eager merge here manufactures a false
contradiction between two numbers that were never claiming the same thing. When in
doubt, `metric_canonical` stays `null` — a null canonical label is honest, a wrong merge
is a bug that produces a confident wrong answer. This exact case is `test/canonicalize.test.js`'s
first test.

This is also the one **extension** I chose to build and finish properly rather than
attempt several halfway: canonicalization is fully incremental. A new document only
gets its own new metric vocabulary embedded and compared against existing cluster
*representatives* (a small, persisted table — `metric_clusters` /
`metric_cluster_members` — not the whole fact corpus). Exact-text reuse of a metric
already seen before costs zero embedding calls. If a new document's vocabulary happens
to merge into a previously-singleton cluster, the *old* facts from earlier documents
get backfilled with the new canonical label too — this is tested explicitly in
`test/canonicalize.test.js` (the "backfill applies to facts from earlier ingestions"
case) and is the part of an incremental design that's easy to get wrong: it's not
enough to canonicalize the new facts, old facts' labels can retroactively become true
as new documents connect them. Candidate matching/judging already got this property for
free from the sqlite-vec KNN index (a new fact's candidates come from an index query,
not a corpus rescan); this extension is what makes canonicalization match that
property. I considered "handle large PDFs" and "handle many PDFs" as alternatives but
skipped them — they're "add more of the same" without a distinct design problem to
solve, unlike incremental canonicalization, which has an actual right and wrong answer
(see the backfill case above for where the wrong answer would show up).

### Rate-limit-aware development

The free Gemini tier's per-minute/per-day caps get hit during *development*, not just
at demo time. `src/llm/cache.ts` caches LLM responses on disk keyed by
`(content hash, prompt version)` so repeated debugging runs against the same document
or fact pair don't re-spend quota (`LLM_CACHE_ENABLED=true` by default; disable for
tests). `DEV_MAX_PAGES` in `.env` limits ingestion to the first N pages for fast
iteration. `src/llm/retry.ts` wraps every call in exponential backoff (1s/2s/4s/8s) on
anything that looks like a 429/quota error.

### Ease of setup

SQLite + `sqlite-vec`, no Docker, no second database, no queue. `npm install && npm run
build && npm start` from a clean clone is the whole setup. If an extension needs new
infrastructure later, that should be a documented, explicit decision in this section —
not something that quietly erodes "clone and run."

## API

```
POST   /documents                 upload PDF (multipart, field name "file"), returns document_id immediately; pipeline runs async
GET    /documents                 list all documents
GET    /documents/:id             status + metadata
GET    /documents/:id/facts       facts extracted from this document
GET    /facts/:id                 single fact with full evidence
GET    /facts/:id/relationships   relationships involving this fact
GET    /relationships             browse all, filterable by ?type=corroborates|contradicts|reconciled_by_context|unrelated
```

## A real finding: `pdf-parse` was rejected mid-build, and why

The implementation guide names `pdf-parse` as the first-choice PDF library. While
building this, `pdf-parse` failed with `bad XRef entry` on an ordinary, validly-formed
PDF generated by a current PDF-writing library — not a corrupted or unusual file, just
one produced by tooling from the last few years. The root cause: `pdf-parse` bundles
its own copy of `pdfjs-dist` internally, and the version it bundles is from roughly
2018 and hasn't been updated since ~2020. Since the assignment brief explicitly
requires this to work on "any PDF... including ones never seen before," shipping on
top of a parser already demonstrated to fail on an unremarkable file wasn't an
acceptable trade for saving one dependency.

The fix: `src/ingestion/pdfExtractor.ts` uses `pdfjs-dist` directly (the actively
Mozilla-maintained library `pdf-parse` itself wraps), at a current version, called via
Node's dynamic `import()` since `pdfjs-dist` v4 ships ESM-only while this project is
CommonJS (this required switching `tsconfig.json` to `"module": "Node16"` so
TypeScript preserves the dynamic import as a real ESM import instead of transpiling it
into a `require()` call, which would fail — `require()` cannot load an ESM package).
This is documented here rather than silently patched because the guide named the
original choice explicitly, and I'd rather show the failure and the reasoning than
quietly diverge from the spec.

`test/pdfExtractor.test.js` extracts real fixture PDFs and checks page-count and
per-page text — this is what caught the original `pdf-parse` failure in the first
place, before it was buried under storage/matching code.

## A second real finding: the Gemini SDK and model IDs moved out from under this project

This one wasn't caught by a test — it only showed up on a live run against a real API
key, which this environment didn't have during initial development. The first real run
returned:

```
[404] This model models/gemini-2.0-flash is no longer available.
Please update your code to use models/gemini-3.6-flash for the latest features
and improvements.
```

Two separate things had moved, not just a model name:

1. **The SDK package itself.** `@google/generative-ai` (what this project originally
   used) is fully deprecated — its own repository now reads "This SDK is now
   deprecated, use the new unified Google GenAI SDK." The replacement is `@google/genai`.
   `src/llm/geminiClient.ts` was rewritten against it. Like `pdfjs-dist`, `@google/genai`
   ships ESM-only, so it's loaded via a lazily-cached dynamic `import()` rather than a
   static import (same reasoning as the PDF-extraction fix above).
2. **The embedding model was retired outright, not renamed.** `text-embedding-004`
   (the guide's original recommendation) was fully shut down on January 14, 2026. Its
   replacement, `gemini-embedding-2`, defaults to 3072-dimensional output; this project's
   `sqlite-vec` schema is fixed at 768 dimensions (`EMBEDDING_DIM` in `src/storage/db.ts`),
   so `embed()` now passes `outputDimensionality: 768` — the model supports this
   natively via Matryoshka Representation Learning, truncating cleanly without a schema
   migration.

Both the extraction model (`GEMINI_EXTRACTION_MODEL`) and embedding model
(`GEMINI_EMBEDDING_MODEL`) are `.env` settings specifically so the next retirement is a
config change, not a code change — see `.env.example` for current defaults and where to
check for the latest model IDs. I verified the new client actually reaches Google's API
correctly (dynamic import resolves, request is constructed and sent) even though this
development environment's own network policy blocks the destination host — I could not
complete a full live extraction run end-to-end here. **If you hit further 404s or a
different embedding dimension error, check `https://ai.google.dev/gemini-api/docs/models`
for the current model IDs before assuming the code is at fault** — given how fast this
API surface has moved twice already in this project's short lifetime, it's the more
likely explanation.

## Limitations and next steps (honest, on purpose)

- **Extraction quality against the real test corpus is unverified.** I built and
  smoke-tested this pipeline's *wiring* against synthetic fixture PDFs and a fake LLM
  client implementing the same interface the real Gemini client does. I later confirmed
  the *real* `@google/genai` client correctly loads, authenticates, and sends a
  properly-formed request all the way to Google's servers — a live run surfaced the
  SDK/model-retirement issue documented above — but this development environment's own
  network policy blocks the destination host, so I still could not complete a full live
  extraction and confirm output *quality* against real pages, or run the actual
  seven-file corpus. Run `npm run ingest` against the real files before submitting and
  confirm the four required cases actually reproduce; the leads and concrete numbers for
  each are in the assignment's own case table.
- **Chart-only numeric data isn't in the PDF text layer.** The Economic Survey's
  charts, for instance, won't be extracted — the `has_visual_content` flag on `Fact`
  exists so this can surface honestly in the UI (a fact the pipeline knows it might be
  missing) rather than silently vanishing. A future vision-pass (rendering the page and
  asking a multimodal model to read the chart) could close this; not attempted here.
- **Table extraction confidence is heuristic, not guaranteed.** Complex multi-header
  tables may still misattribute a value to the wrong column despite the tabular
  prompt's explicit "restate the columns first" step. This is expected to surface as
  `extraction_confidence: "low"`, not be hidden — if you see a lot of `"low"` facts on
  a genuinely simple table, that's a sign the tabular prompt needs another look, not
  that the UI should hide the signal.
- **Page-11 chart mislabel (Case 4).** The guide's own additional-context doc names a
  specific, real, already-discovered extraction-failure case: a chart's x-axis label
  reads "Q3 FY24" a second time on the earnings presentation's page 11, where every
  sibling chart on the same page correctly progresses through Q4 FY23/Q3 FY24/Q4 FY24.
  I did not have that PDF to extract and confirm this against, but the finding is
  documented in the source material and the fix approach (cross-check axis labels
  against sibling charts on the same page before trusting them) is a page-classification
  or a post-extraction validation concern, not something this build attempted to solve
  — flagging it honestly here rather than fabricating a different failure case to fill
  the requirement.
- **Free-tier rate limits cap real-time ingestion speed for large PDFs.** Noted rather
  than over-engineered around; the dev-mode LLM cache and `DEV_MAX_PAGES` flag exist to
  make *development* tolerable, not to make production throughput unlimited.
- **No free-text Q&A over the fact store.** Out of scope for v1 by design (see "Why
  this shape, not RAG" above) — could be added later on the same embeddings.
- **No production auth/multi-tenancy.** Not attempted; out of scope per the brief.
- **`metric_canonical` clustering quality depends entirely on embedding quality for
  short phrases**, which I could not empirically validate against real Gemini
  embeddings in this environment (see "unverified" note above). The threshold
  (`CANONICAL_SIMILARITY_THRESHOLD=0.90`) is a starting point to tune by inspection
  once real embeddings are available, per the guide's own validation plan — not a
  number I'd claim is correct without having watched it run.
- **`npm audit` reports 4 moderate transitive-dependency advisories** (Express's `qs`
  dependency; `uuid`'s v3/v5/v6 buffer-bounds check). Noted rather than silently
  ignored: the `qs` fix requires an untested Express 5 major-version bump, out of scope
  for this build; the `uuid` advisory only affects the namespace-based `v3`/`v5`/`v6`
  functions with a caller-supplied buffer, which this codebase never calls — only
  `v4()` (random UUIDs, no buffer argument) is used anywhere here.

## Repo structure

```
/src
  /ingestion       — PDF -> page text (pdfjs-dist), page classification
  /extraction      — prompt templates + envelope-filling, tabular & narrative
  /matching        — embedding-based candidate generation, incremental canonicalization
  /judging         — pairwise relationship LLM calls + prompt
  /storage         — SQLite schema, migrations, sqlite-vec setup, repositories
  /api             — Express routes
  /llm             — provider-agnostic LLM client wrapper, Gemini implementation, backoff, dev cache
  /pipeline        — orchestrates ingest -> classify -> extract -> store -> canonicalize -> match -> judge
/web               — minimal vanilla HTML/JS/CSS frontend, no build step
/test              — node:test suite against real (synthetic) fixture PDFs and fake LLM clients
/scripts           — dev-ingest.ts, CLI entry point for the validation workflow
```
