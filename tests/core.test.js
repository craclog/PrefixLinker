const {
  escapeRegex,
  buildPattern,
  findMatchingRule,
  generateUrl,
  splitTextByPattern,
  isAlreadyProcessed,
} = require('../src/core');

// ─────────────────────────────────────────────
// escapeRegex
// ─────────────────────────────────────────────
describe('escapeRegex', () => {
  test('leaves normal strings untouched', () => {
    // '-' is NOT a special regex character outside character classes
    expect(escapeRegex('CSWPR-')).toBe('CSWPR-');
  });

  test('escapes all special regex characters', () => {
    expect(escapeRegex('a.b*c?d+e^f$')).toBe('a\\.b\\*c\\?d\\+e\\^f\\$');
  });

  test('escapes braces and brackets', () => {
    expect(escapeRegex('{}[]|()')).toBe('\\{\\}\\[\\]\\|\\(\\)');
  });
});

// ─────────────────────────────────────────────
// buildPattern
// ─────────────────────────────────────────────
describe('buildPattern', () => {
  test('returns null for empty array', () => {
    expect(buildPattern([])).toBeNull();
  });

  test('returns null for null/undefined', () => {
    expect(buildPattern(null)).toBeNull();
    expect(buildPattern(undefined)).toBeNull();
  });

  test('matches a single prefix pattern', () => {
    const rules = [{ prefix: 'CSWPR-', urlTemplate: 'https://g.co?q={match}' }];
    const re = buildPattern(rules);
    expect(re).not.toBeNull();
    expect(re.test('CSWPR-12345')).toBe(true);
  });

  test('does not match unrelated text', () => {
    const rules = [{ prefix: 'CSWPR-', urlTemplate: 'https://g.co?q={match}' }];
    const re = buildPattern(rules);
    expect(re.test('OTHER-12345')).toBe(false);
    expect(re.test('CSWPR')).toBe(false); // no suffix
  });

  test('matches multiple prefixes', () => {
    const rules = [
      { prefix: 'CSWPR-', urlTemplate: 'https://g.co?q={match}' },
      { prefix: 'JIRA-',  urlTemplate: 'https://jira.example.com/browse/{match}' },
    ];
    // Use fresh RegExp instances to avoid global lastIndex state between calls.
    const reFor = (rules) => new RegExp(buildPattern(rules).source);
    expect(reFor(rules).test('CSWPR-001')).toBe(true);
    expect(reFor(rules).test('JIRA-999')).toBe(true);
    expect(reFor(rules).test('OTHER-1')).toBe(false);
  });

  test('treats dot in prefix as a literal character', () => {
    const rules = [{ prefix: 'A.B-', urlTemplate: 'https://example.com/{match}' }];
    const re = buildPattern(rules);
    expect(re.test('A.B-1')).toBe(true);
    expect(re.test('AXB-1')).toBe(false); // dot is NOT a wildcard
  });

  test('returned pattern has the global flag', () => {
    const rules = [{ prefix: 'X-', urlTemplate: 'https://x.com/{match}' }];
    expect(buildPattern(rules).flags).toContain('g');
  });
});

// ─────────────────────────────────────────────
// findMatchingRule
// ─────────────────────────────────────────────
describe('findMatchingRule', () => {
  const rules = [
    { prefix: 'CSWPR-', urlTemplate: 'https://g.co?q={match}' },
    { prefix: 'JIRA-',  urlTemplate: 'https://jira.example.com/browse/{match}' },
  ];

  test('returns the correct rule for each prefix', () => {
    expect(findMatchingRule('CSWPR-123', rules)).toBe(rules[0]);
    expect(findMatchingRule('JIRA-456', rules)).toBe(rules[1]);
  });

  test('returns null when no rule matches', () => {
    expect(findMatchingRule('OTHER-123', rules)).toBeNull();
    expect(findMatchingRule('', rules)).toBeNull();
  });

  test('returns null for empty rules array', () => {
    expect(findMatchingRule('CSWPR-1', [])).toBeNull();
  });
});

// ─────────────────────────────────────────────
// generateUrl
// ─────────────────────────────────────────────
describe('generateUrl', () => {
  test('replaces {match} with the matched text', () => {
    expect(generateUrl('https://g.co?q={match}', 'CSWPR-123'))
      .toBe('https://g.co?q=CSWPR-123');
  });

  test('URL-encodes special characters', () => {
    expect(generateUrl('https://example.com?q={match}', 'A B&C'))
      .toBe('https://example.com?q=A%20B%26C');
  });

  test('replaces only the first {match} occurrence', () => {
    // Standard String.replace replaces first occurrence — document the behaviour.
    expect(generateUrl('https://a.com/{match}/info/{match}', 'X-1'))
      .toBe('https://a.com/X-1/info/{match}');
  });

  test('works when urlTemplate contains no placeholder', () => {
    expect(generateUrl('https://example.com/fixed', 'CSWPR-99'))
      .toBe('https://example.com/fixed');
  });
});

// ─────────────────────────────────────────────
// splitTextByPattern
// ─────────────────────────────────────────────
describe('splitTextByPattern', () => {
  function makePattern(prefixes) {
    const rules = prefixes.map(p => ({ prefix: p, urlTemplate: '' }));
    return buildPattern(rules);
  }

  test('returns single text part when there are no matches', () => {
    const re = makePattern(['CSWPR-']);
    expect(splitTextByPattern('nothing to see here', re)).toEqual([
      { type: 'text', value: 'nothing to see here' },
    ]);
  });

  test('returns empty array for empty input', () => {
    const re = makePattern(['CSWPR-']);
    expect(splitTextByPattern('', re)).toEqual([]);
  });

  test('handles a match at the start of text', () => {
    const re = makePattern(['CSWPR-']);
    expect(splitTextByPattern('CSWPR-1 is here', re)).toEqual([
      { type: 'match', value: 'CSWPR-1' },
      { type: 'text',  value: ' is here' },
    ]);
  });

  test('handles a match at the end of text', () => {
    const re = makePattern(['CSWPR-']);
    expect(splitTextByPattern('See CSWPR-999', re)).toEqual([
      { type: 'text',  value: 'See ' },
      { type: 'match', value: 'CSWPR-999' },
    ]);
  });

  test('handles a match in the middle of text', () => {
    const re = makePattern(['CSWPR-']);
    expect(splitTextByPattern('Fix CSWPR-42 now', re)).toEqual([
      { type: 'text',  value: 'Fix ' },
      { type: 'match', value: 'CSWPR-42' },
      { type: 'text',  value: ' now' },
    ]);
  });

  test('handles multiple matches in a single string', () => {
    const re = makePattern(['CSWPR-']);
    expect(splitTextByPattern('CSWPR-1 and CSWPR-2 done', re)).toEqual([
      { type: 'match', value: 'CSWPR-1' },
      { type: 'text',  value: ' and ' },
      { type: 'match', value: 'CSWPR-2' },
      { type: 'text',  value: ' done' },
    ]);
  });

  test('handles mixed prefixes', () => {
    const re = makePattern(['CSWPR-', 'JIRA-']);
    expect(splitTextByPattern('CSWPR-10 relates to JIRA-20', re)).toEqual([
      { type: 'match', value: 'CSWPR-10' },
      { type: 'text',  value: ' relates to ' },
      { type: 'match', value: 'JIRA-20' },
    ]);
  });

  test('is idempotent — calling twice gives the same result', () => {
    const re = makePattern(['CSWPR-']);
    const first  = splitTextByPattern('See CSWPR-5', re);
    const second = splitTextByPattern('See CSWPR-5', re);
    expect(second).toEqual(first);
  });
});

// ─────────────────────────────────────────────
// isAlreadyProcessed
// ─────────────────────────────────────────────
describe('isAlreadyProcessed', () => {
  const ATTR = 'data-prefixlinker-done';

  // Minimal fake Element for testing without a real DOM.
  function makeEl(hasAttr, parentHasAttr = false) {
    const parent = parentHasAttr
      ? { closest: (sel) => (sel === '[' + ATTR + ']' ? parent : null) }
      : null;

    return {
      closest: (sel) => {
        if (sel !== '[' + ATTR + ']') return null;
        if (hasAttr) return {}; // self matches
        if (parent && parentHasAttr) return parent;
        return null;
      },
    };
  }

  test('returns false for element with no marker', () => {
    expect(isAlreadyProcessed(makeEl(false), ATTR)).toBe(false);
  });

  test('returns true for element that carries the marker itself', () => {
    expect(isAlreadyProcessed(makeEl(true), ATTR)).toBe(true);
  });

  test('returns true when an ancestor carries the marker', () => {
    expect(isAlreadyProcessed(makeEl(false, true), ATTR)).toBe(true);
  });

  test('returns false for null element', () => {
    expect(isAlreadyProcessed(null, ATTR)).toBe(false);
  });

  test('returns false for element without closest method', () => {
    expect(isAlreadyProcessed({}, ATTR)).toBe(false);
  });
});
