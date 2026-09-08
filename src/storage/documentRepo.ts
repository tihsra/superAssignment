import { getDb } from "./db";
import { Document, DocumentStatus } from "../types";

interface DocumentRow {
  id: string;
  filename: string;
  uploaded_at: string;
  page_count: number;
  status: DocumentStatus;
  error: string | null;
}

function rowToDocument(row: DocumentRow): Document {
  return { ...row };
}

export function createDocument(doc: Document): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO documents (id, filename, uploaded_at, page_count, status, error)
     VALUES (@id, @filename, @uploaded_at, @page_count, @status, @error)`
  ).run(doc);
}

export function getDocument(id: string): Document | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM documents WHERE id = ?`).get(id) as DocumentRow | undefined;
  return row ? rowToDocument(row) : null;
}

export function listDocuments(): Document[] {
  const db = getDb();
  const rows = db.prepare(`SELECT * FROM documents ORDER BY uploaded_at DESC`).all() as DocumentRow[];
  return rows.map(rowToDocument);
}

export function updateDocumentStatus(id: string, status: DocumentStatus, error: string | null = null): void {
  const db = getDb();
  db.prepare(`UPDATE documents SET status = ?, error = ? WHERE id = ?`).run(status, error, id);
}

export function updateDocumentPageCount(id: string, pageCount: number): void {
  const db = getDb();
  db.prepare(`UPDATE documents SET page_count = ? WHERE id = ?`).run(pageCount, id);
}
