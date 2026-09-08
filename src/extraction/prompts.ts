/**
 * These templates are deliberately generic: no entity names, metric names, or
 * document identifiers appear anywhere in them. The LLM fills the schema in
 * fresh for every page of every document. See additional-context.md §2.
 */

const DEDUP_INSTRUCTION = `Do not extract the same underlying value more than once under
differently-worded metric names. A single sentence or table cell describing one number
(or one number expressed two ways, e.g. an amount and a component count in the same
clause) should produce exactly one fact per genuinely distinct measurement — not one
fact per way you could phrase its label. Before emitting a fact, check: have I already
captured this exact value, from this exact source_quote, under a different metric label?
If so, do not emit it again — keep only the most specific, accurate label for that value.
Two facts from the same quote are only both warranted when they describe two genuinely
different quantities (e.g. a share count AND a separately-stated rupee amount), never
when one is just a more/less specific restatement of the other.`;

export function tabularPrompt(pageText: string): string {
  return `You are extracting factual claims from a page of a financial or statistical document.
This page appears to contain a table with numbers across multiple time periods or categories.

Before extracting any facts, first restate in your own words: what are the column
headers, and what time period or category does each column represent? Then, for
each meaningful data point, emit a fact using the exact column/row mapping you just
identified. Do not guess a mapping — if a column's time period is ambiguous, set
time_scope.type to "unspecified" and note it in the quote.

${DEDUP_INSTRUCTION}

For each fact, capture:
- entity: who/what the fact is about
- metric: the specific line item or measure, exactly as labeled on the page
- value and unit: the number and its unit as written (do not convert units)
- time_scope: the period this specific value applies to, using the page's own labels
- qualifiers: any modifiers that change what the number means (e.g. "restated",
  "standalone", "consolidated", "adjusted", "excluding X")
- source_quote: the exact text spanning the row label and this specific value
- extraction_confidence: "low" if the column/period mapping was ambiguous

Page text:
${pageText}`;
}

export function narrativePrompt(pageText: string): string {
  return `You are extracting factual claims from a page of prose (a report, survey, or
narrative document). Extract every discrete factual claim that includes a number,
date, percentage, or a specific named entity taking a specific action or state.

Skip claims that are purely opinion, forecast framing without a number ("growth is
expected to remain robust"), or rhetorical. Do include a claim even if only loosely
quantified, but mark extraction_confidence "low" in that case.

${DEDUP_INSTRUCTION}

When a single sentence contains no natural label for a value (e.g. plain prose, not a
table), choose the clearest concise metric name that describes what the number
measures, and use that same phrasing consistently if the identical concept appears
again elsewhere on the page — do not vary the wording between equivalent facts.

For each fact, capture the same fields as above: entity, metric, value/unit,
time_scope, qualifiers, source_quote, extraction_confidence.

Page text:
${pageText}`;
}

export const CLASSIFY_PROMPT_PREFIX = `Classify the shape of this single PDF page's extracted text.
Return "tabular" if it's dominated by a table of numbers across columns/rows (financial
statements, data tables). Return "narrative" if it's prose. Return "mixed" if both are
clearly present in meaningful amounts. Judge only from the text given; do not assume
anything about what document this came from.

Page text:
`;