import { PageShape } from "../types";
import { LLMClient } from "../llm/types";

/**
 * Cheap heuristic first: high digit density + many short "line" segments
 * (pdf-parse text is already whitespace-collapsed, so we approximate "lines"
 * by splitting on runs of 2+ spaces, which is what column gutters look like
 * once extracted text loses real newlines) suggests a table. This lets us
 * skip an LLM call entirely for the (very common) clearly-one-or-the-other
 * pages, saving free-tier quota per additional-context.md §6, and only
 * escalates to the LLM (guide §7.2) when the heuristic is genuinely unsure.
 */
function heuristicClassify(pageText: string): PageShape | "ambiguous" {
  const trimmed = pageText.trim();
  if (trimmed.length === 0) return "narrative"; // empty page: nothing to extract either way

  const digitCount = (trimmed.match(/\d/g) || []).length;
  const digitDensity = digitCount / trimmed.length;

  const columnGutters = (trimmed.match(/ {2,}/g) || []).length;
  const gutterDensity = columnGutters / Math.max(1, trimmed.split(" ").length / 20);

  const strongTabular = digitDensity > 0.15 && gutterDensity > 0.5;
  const strongNarrative = digitDensity < 0.03 && gutterDensity < 0.1;

  if (strongTabular) return "tabular";
  if (strongNarrative) return "narrative";
  return "ambiguous";
}

export async function classifyPageShape(pageText: string, llm: LLMClient): Promise<PageShape> {
  const heuristic = heuristicClassify(pageText);
  if (heuristic !== "ambiguous") return heuristic;
  return llm.classifyPage(pageText);
}
