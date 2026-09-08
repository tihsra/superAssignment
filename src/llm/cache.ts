import fs from "fs";
import path from "path";
import crypto from "crypto";
import { config } from "../config";

/**
 * The free Gemini tier's per-minute/per-day caps get hit constantly during
 * development, not just at demo time (additional-context.md §6). This cache
 * keys on (content hash, prompt version) so re-running the pipeline while
 * debugging doesn't re-spend quota on pages/pairs that haven't changed.
 *
 * This is a DEV convenience only — it is not a correctness cache in the sense
 * of avoiding recomputation across genuinely different content; bump the
 * prompt version whenever a prompt template changes so stale cached output
 * from an old prompt is never silently served.
 */
export const PROMPT_VERSIONS = {
  classify: "v1",
  // Bumped v1 -> v2: extraction prompts now include an explicit
  // anti-duplication instruction (see prompts.ts DEDUP_INSTRUCTION) so the
  // model stops emitting the same value multiple times under
  // differently-worded metric names (e.g. "Fresh Issue size" vs "Fresh
  // Issue size - Amount" for the same quote/value). The cache key only
  // hashes page content, not the prompt text itself, so without this bump
  // any page already seen under the old prompt would keep silently
  // serving its old, duplicate-producing cached result forever.
  extractTabular: "v2",
  extractNarrative: "v2",
  judge: "v1",
  embed: "v1",
} as const;

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function keyFor(namespace: string, promptVersion: string, content: string): string {
  const hash = crypto.createHash("sha256").update(content).digest("hex").slice(0, 32);
  return `${namespace}__${promptVersion}__${hash}`;
}

export async function cached<T>(
  namespace: string,
  promptVersion: string,
  content: string,
  compute: () => Promise<T>
): Promise<T> {
  if (!config.llmCacheEnabled) return compute();

  ensureDir(config.llmCacheDir);
  const file = path.join(config.llmCacheDir, `${keyFor(namespace, promptVersion, content)}.json`);

  if (fs.existsSync(file)) {
    try {
      const raw = fs.readFileSync(file, "utf-8");
      return JSON.parse(raw) as T;
    } catch {
      // fall through and recompute if the cache file is corrupt
    }
  }

  const result = await compute();
  try {
    fs.writeFileSync(file, JSON.stringify(result));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[llm-cache] failed to write cache for ${namespace}:`, err);
  }
  return result;
}