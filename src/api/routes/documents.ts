import { Router } from "express";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import { uploadPdf } from "../middleware/upload";
import { createDocument, getDocument, listDocuments, updateDocumentStatus } from "../../storage/documentRepo";
import { getFactsByDocument } from "../../storage/factRepo";
import { ingestDocument } from "../../pipeline/ingestPipeline";
import { getLLMClient } from "../../llm/geminiClient";
import { Document } from "../../types";

export const documentsRouter = Router();

// POST /documents — upload a PDF, returns document_id immediately, pipeline runs async.
documentsRouter.post("/", uploadPdf.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded. Send multipart/form-data with a 'file' field." });
    return;
  }

  const documentId = uuidv4();
  const doc: Document = {
    id: documentId,
    filename: req.file.originalname,
    uploaded_at: new Date().toISOString(),
    page_count: 0,
    status: "processing",
    error: null,
  };
  createDocument(doc);

  res.status(202).json({ document_id: documentId, status: "processing" });

  // Fire-and-forget: the pipeline is async per the assignment's "kicks off
  // async pipeline" requirement (guide §7.8). Errors are caught and written
  // to the document row (status="failed", error=<message>) rather than
  // crashing the process or being silently swallowed.
  (async () => {
    try {
      const buffer = fs.readFileSync(req.file!.path);
      const llm = getLLMClient();
      const result = await ingestDocument(documentId, buffer, llm);
      // eslint-disable-next-line no-console
      console.log(
        `[ingest] document ${documentId} done: ${result.factsExtracted} facts, ${result.relationshipsFound} relationships`
      );
    } catch (err) {
      // Covers failures BEFORE ingestDocument's own try/catch even starts
      // (e.g. getLLMClient() throwing on a missing API key, or the upload
      // file failing to read) — ingestDocument only marks the document
      // "failed" for errors that occur once it's actually running, so
      // without this the document would otherwise sit stuck in
      // "processing" forever. Safe to also cover errors that already came
      // through ingestDocument's own catch; this just re-writes the same
      // status/error a second time.
      const message = String((err as any)?.message ?? err);
      updateDocumentStatus(documentId, "failed", message);
      // eslint-disable-next-line no-console
      console.error(`[ingest] document ${documentId} failed:`, err);
    }
  })();
});

// GET /documents — list all documents (used by the frontend's document picker).
documentsRouter.get("/", (_req, res) => {
  res.json(listDocuments());
});

// GET /documents/:id — status + metadata.
documentsRouter.get("/:id", (req, res) => {
  const doc = getDocument(req.params.id);
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  res.json(doc);
});

// GET /documents/:id/facts — facts extracted from this document.
documentsRouter.get("/:id/facts", (req, res) => {
  const doc = getDocument(req.params.id);
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  res.json(getFactsByDocument(req.params.id));
});
