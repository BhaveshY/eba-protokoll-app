const TERM_SEPARATOR_RE = /[\r\n,;]+/g;
const SIMPLE_LIST_MARKER_RE = /^\s*(?:[-*]+|\d+[\.)]|[A-Za-z][\.)])\s+/;

export function parseGlossaryTerms(input: string): string[] {
  return normalizeGlossaryTerms(
    input.split(TERM_SEPARATOR_RE).map((term) =>
      term.replace(SIMPLE_LIST_MARKER_RE, "").trim()
    )
  );
}

export function mergeGlossaryTerms(
  existingTerms: string[],
  newTerms: string[]
): { terms: string[]; added: number } {
  const terms = normalizeGlossaryTerms(existingTerms);
  const seen = new Set(terms.map(termKey));
  let added = 0;

  for (const term of normalizeGlossaryTerms(newTerms)) {
    const key = termKey(term);
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
    added += 1;
  }

  return { terms, added };
}

function normalizeGlossaryTerms(terms: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of terms) {
    const term = raw.trim();
    if (!term) continue;
    const key = termKey(term);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
  }

  return out;
}

function termKey(term: string): string {
  return term.toLocaleLowerCase();
}
