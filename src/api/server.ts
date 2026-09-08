import express from "express";
import cors from "cors";
import path from "path";
import { config } from "../config";
import { getDb } from "../storage/db";
import { documentsRouter } from "./routes/documents";
import { factsRouter } from "./routes/facts";
import { relationshipsRouter } from "./routes/relationships";

// Initialize the DB (and sqlite-vec) eagerly so a schema/extension problem
// surfaces at startup, not on the first request.
getDb();

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use("/documents", documentsRouter);
app.use("/facts", factsRouter);
app.use("/relationships", relationshipsRouter);

// Minimal server-rendered-ish frontend: static files, no build step required.
app.use("/", express.static(path.join(__dirname, "..", "..", "web")));

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Internal server error" });
});

app.listen(config.port, () => {
  console.log(`Fact Knowledge Layer API listening on http://localhost:${config.port}`);
  console.log(`Frontend: http://localhost:${config.port}/`);
});
