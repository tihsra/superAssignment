export function judgePrompt(factAJson: string, factBJson: string): string {
  return `You are comparing two factual claims extracted from documents to determine their
relationship. You will be given both facts with their full structured data and
source evidence.

Fact A: ${factAJson}
Fact B: ${factBJson}

Determine the relationship:
- "corroborates": both facts support the same underlying claim, even if worded,
  scoped, or sourced differently, and the values are consistent once you account
  for their time_scope, unit, and qualifiers.
- "contradicts": the facts are about the same entity, metric, and comparable
  time_scope/unit/qualifiers, but report meaningfully different values with no
  clear reconciling factor.
- "reconciled_by_context": the facts appear to conflict at first glance (different
  numbers for what looks like the same thing), but the difference is explained by
  their time_scope, unit, or qualifiers being genuinely different — explain exactly
  what differs and why that resolves the apparent conflict.
- "unrelated": despite embedding similarity, these aren't actually comparable
  claims (e.g. genuinely different metrics that happen to use similar words).

Return relationship, a confidence level, and a reasoning string (2-4 sentences,
referencing the specific fields that drove your judgment — this reasoning will be
shown directly to a human reviewer).`;
}
