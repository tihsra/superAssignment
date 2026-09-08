import { Fact } from "../types";
import { LLMClient } from "../llm/types";
import { config } from "../config";
import { extractPdfPages } from "../ingestion/pdfExtractor";
import { classifyPageShape } from "../ingestion/pageClassifier";
import { extractFactsFromPage } from "../extraction/extractFacts";
import { canonicalizeMetricsIncremental } from "../matching/canonicalize";
import { findCandidatesForFact } from "../matching/candidateMatch";
import { judgeAndStore } from "../judging/judgeRelationship";
import { insertFact, getFact } from "../storage/factRepo";
import { updateDocumentPageCount, updateDocumentStatus } from "../storage/documentRepo";

export interface IngestResult {
  factsExtracted: number;
  relationshipsFound: number;
  pagesFailed: number;
  failedPageNumbers: number[];
}

/**
 * Everything happens once, upfront, at ingestion — this is not a
 * retrieve-then-answer RAG loop (additional-context.md §1). A document is
 * processed exactly once here; the API layer only ever reads what this wrote.
 *
 * Per-page failures are isolated (see try/catch in the page loop below):
 * withBackoff already retries transient errors (429/503/etc, see retry.ts).
 * If a page still fails after exhausting retries, that page is skipped and
 * logged rather than aborting the whole document — so a single bad page
 * late in a 100-page PDF doesn't discard every fact already extracted from
 * the pages before it.
 */
export async function ingestDocument(
  documentId: string,
  pdfBuffer: Buffer,
  llm: LLMClient
): Promise<IngestResult> {
  try {
    const rawPages = await extractPdfPages(pdfBuffer);
    updateDocumentPageCount(documentId, rawPages.length);

    const pagesToProcess =
      config.devMaxPages !== undefined ? rawPages.slice(0, config.devMaxPages) : rawPages;
    if (config.devMaxPages !== undefined) {
      // eslint-disable-next-line no-console
      console.warn(
        `[ingest] DEV_MAX_PAGES=${config.devMaxPages} set — processing ${pagesToProcess.length}/${rawPages.length} pages only.`
      );
    }

    const newFacts: Fact[] = [];
    const failedPageNumbers: number[] = [];

    for (const page of pagesToProcess) {
      try {
        const shape = await classifyPageShape(page.text, llm);
        const facts = await extractFactsFromPage({
          documentId,
          pageNumber: page.page_number,
          pageText: page.text,
          shape,
          llm,
        });
        for (const fact of facts) {
          insertFact(fact);
          newFacts.push(fact);
        }
      } catch (pageErr) {
        // withBackoff already exhausted retries for transient errors before
        // this throws. Don't let one page take down the whole document —
        // log it, record it, and keep going.
        failedPageNumbers.push(page.page_number);
        // eslint-disable-next-line no-console
        console.error(
          `[ingest] page ${page.page_number} of document ${documentId} failed after retries, skipping: ${String(
            (pageErr as any)?.message ?? pageErr
          )}`
        );
      }
    }

    // Incremental canonicalization (additional-context.md §9): only this
    // document's new metric vocabulary gets embedded and compared against
    // existing cluster representatives — never a full-corpus rescan.
    await canonicalizeMetricsIncremental(llm, newFacts);

    // Blocking (embedding candidates) then judging, per §7.6/§7.7 — never
    // all-pairs. Only runs against OTHER documents; see candidateMatch.ts.
    let relationshipsFound = 0;
    for (const fact of newFacts) {
      const candidates = findCandidatesForFact(fact);
      for (const candidate of candidates) {
        const candidateFact = getFact(candidate.fact_id);
        if (!candidateFact) continue;
        const rel = await judgeAndStore(fact, candidateFact, llm);
        if (rel) relationshipsFound++;
      }
    }

    if (failedPageNumbers.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[ingest] document ${documentId} completed with ${failedPageNumbers.length} page(s) skipped after retries: ${failedPageNumbers.join(
          ", "
        )}`
      );
    }
    // Document still succeeded overall — don't write into the `error`
    // column here, since that column's contract (per documentRepo.ts) is
    // "this document failed", and downstream code likely filters on
    // `error IS NOT NULL` to find failed documents. A `ready` doc with a
    // few skipped pages is not that.
    updateDocumentStatus(documentId, "ready");

    return {
      factsExtracted: newFacts.length,
      relationshipsFound,
      pagesFailed: failedPageNumbers.length,
      failedPageNumbers,
    };
  } catch (err) {
    // Only truly document-level failures land here now: PDF parsing,
    // canonicalization, or judging — not a single page's extraction call.
    updateDocumentStatus(documentId, "failed", String((err as any)?.message ?? err));
    throw err;
  }
}