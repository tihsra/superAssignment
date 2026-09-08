/**
 * Usage: npm run ingest -- /path/to/file.pdf
 *
 * Bypasses the HTTP API entirely so you can run the guide's §9 validation
 * plan directly: point this at a hand-picked page range (via DEV_MAX_PAGES
 * in .env) and inspect the printed JSON against what you know is on the
 * page, before any storage/matching code is in the loop.
 */
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { createDocument, updateDocumentStatus } from "../src/storage/documentRepo";
import { getFactsByDocument } from "../src/storage/factRepo";
import { listRelationships } from "../src/storage/relationshipRepo";
import { ingestDocument } from "../src/pipeline/ingestPipeline";
import { getLLMClient } from "../src/llm/geminiClient";
import { Document } from "../src/types";

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: npm run ingest -- /path/to/file.pdf");
    process.exit(1);
  }
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    console.error(`File not found: ${resolved}`);
    process.exit(1);
  }

  const documentId = uuidv4();
  const doc: Document = {
    id: documentId,
    filename: path.basename(resolved),
    uploaded_at: new Date().toISOString(),
    page_count: 0,
    status: "processing",
    error: null,
  };
  createDocument(doc);

  console.log(`Ingesting ${doc.filename} (document_id=${documentId})...`);
  let result;
  try {
    const llm = getLLMClient();
    result = await ingestDocument(documentId, fs.readFileSync(resolved), llm);
  } catch (err) {
    // Same reasoning as the API route: a failure before ingestDocument's own
    // try/catch starts (e.g. a missing API key) would otherwise leave this
    // document stuck showing "processing" if inspected via the UI/API later.
    updateDocumentStatus(documentId, "failed", String((err as any)?.message ?? err));
    throw err;
  }
  console.log(`\nDone: ${result.factsExtracted} facts extracted, ${result.relationshipsFound} relationships found.\n`);

  console.log("--- Facts ---");
  console.log(JSON.stringify(getFactsByDocument(documentId), null, 2));

  console.log("\n--- Relationships touching this document ---");
  const allRels = listRelationships();
  const factIds = new Set(getFactsByDocument(documentId).map((f) => f.id));
  const relevant = allRels.filter((r) => factIds.has(r.fact_a_id) || factIds.has(r.fact_b_id));
  console.log(JSON.stringify(relevant, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
