/**
 * @jest-environment jsdom
 *
 * content.js is a browser script wrapped in an IIFE.
 * We simulate the browser environment exactly as popup.test.js does,
 * then import the exported linkifyTextNode / walkAndLinkify helpers
 * to exercise them in isolation.
 *
 * The key regression test here: linkifyTextNode must NOT throw when
 * the text node has already been detached from the DOM (parentNode === null).
 * In a real browser the MutationObserver batches mutations, so a node can
 * be recorded as "added" and then detached before the callback runs.
 * jsdom fires callbacks synchronously, which is why this bug is invisible
 * in a purely jsdom-based test unless we explicitly pass a detached node.
 */
'use strict';

// ── 1. Core globals (mirrors <script src="core.js"> in the page) ─────────────
const core = require('../src/core');
Object.assign(global, core);

// ── 2. Chrome API mock ───────────────────────────────────────────────────────
const DEFAULT_RULES = [
  { prefix: 'CSWPR-', urlTemplate: 'https://www.google.com/search?q={match}' },
];

let _rules = [...DEFAULT_RULES];

global.chrome = {
  storage: {
    sync: {
      get: jest.fn((_defaults, cb) => cb({ rules: _rules })),
    },
  },
  runtime: {
    onMessage: { addListener: jest.fn() },
  },
};

// ── 3. Helpers ────────────────────────────────────────────────────────────────
let contentExports = {};

function loadContent(initialRules = DEFAULT_RULES, html = '') {
  document.body.innerHTML = html;
  jest.resetModules();
  jest.clearAllMocks();
  Object.assign(global, require('../src/core'));
  _rules = [...initialRules];
  contentExports = require('../extension/content.js') || {};
}

const RULES   = DEFAULT_RULES;
const PATTERN = core.buildPattern(RULES);

// ── Tests: detached-node guard (the regression) ──────────────────────────────

describe('content: linkifyTextNode — detached node guard', () => {
  beforeEach(() => loadContent());

  test('does not throw when the text node has no parent (parentNode === null)', () => {
    const { linkifyTextNode } = contentExports;
    const detached = document.createTextNode('CSWPR-123');

    // Verify the precondition: node is not attached.
    expect(detached.parentNode).toBeNull();

    // Without the guard this throws:
    // TypeError: Cannot read properties of null (reading 'replaceChild')
    expect(() => linkifyTextNode(detached, RULES, PATTERN)).not.toThrow();
  });

  test('still linkifies text nodes that ARE attached', () => {
    const { linkifyTextNode } = contentExports;
    const p = document.createElement('p');
    p.textContent = 'See CSWPR-456 for details';
    document.body.appendChild(p);

    linkifyTextNode(p.firstChild, RULES, PATTERN);

    const link = p.querySelector('.prefix-linker-link');
    expect(link).not.toBeNull();
    expect(link.textContent).toBe('CSWPR-456');
    expect(link.href).toBe('https://www.google.com/search?q=CSWPR-456');
  });
});

// ── Tests: initial page scan ─────────────────────────────────────────────────

describe('content: initial page scan', () => {
  test('linkifies a matching text node on page load', () => {
    loadContent(DEFAULT_RULES, '<p>Issue CSWPR-789 needs review</p>');
    const link = document.querySelector('.prefix-linker-link');
    expect(link).not.toBeNull();
    expect(link.textContent).toBe('CSWPR-789');
  });

  test('linkifies multiple matches in the same paragraph', () => {
    loadContent(DEFAULT_RULES, '<p>CSWPR-1 and CSWPR-2</p>');
    const links = document.querySelectorAll('.prefix-linker-link');
    expect(links).toHaveLength(2);
    expect(links[0].textContent).toBe('CSWPR-1');
    expect(links[1].textContent).toBe('CSWPR-2');
  });

  test('does not process text inside <a> tags', () => {
    loadContent(DEFAULT_RULES, '<a href="https://example.com">CSWPR-000</a>');
    expect(document.querySelector('a a')).toBeNull();
  });

  test('does not process text inside <script> tags', () => {
    loadContent(DEFAULT_RULES, '<script>var x = "CSWPR-SCRIPT";</script>');
    expect(document.querySelector('.prefix-linker-link')).toBeNull();
  });

  test('does not process <input> values', () => {
    loadContent(DEFAULT_RULES, '<input type="text" value="CSWPR-INPUT" />');
    expect(document.querySelector('.prefix-linker-link')).toBeNull();
  });

  test('does not linkify when no rules are configured', () => {
    loadContent([], '<p>CSWPR-123</p>');
    expect(document.querySelector('.prefix-linker-link')).toBeNull();
  });

  test('generated link opens in a new tab with noopener', () => {
    loadContent(DEFAULT_RULES, '<p>CSWPR-321</p>');
    const link = document.querySelector('.prefix-linker-link');
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
  });
});

// ── Tests: walkAndLinkify ─────────────────────────────────────────────────────

describe('content: walkAndLinkify', () => {
  beforeEach(() => loadContent());

  test('processes all matching text nodes in a subtree', () => {
    const { walkAndLinkify } = contentExports;
    document.body.innerHTML = `
      <div>
        <p>CSWPR-10</p>
        <p>CSWPR-20</p>
      </div>
    `;
    walkAndLinkify(document.body, RULES, PATTERN);
    expect(document.querySelectorAll('.prefix-linker-link')).toHaveLength(2);
  });

  test('skips nodes already marked as processed', () => {
    const { walkAndLinkify } = contentExports;
    document.body.innerHTML =
      '<p data-prefixlinker-done="1">CSWPR-99</p>';
    walkAndLinkify(document.body, RULES, PATTERN);
    expect(document.querySelector('.prefix-linker-link')).toBeNull();
  });

  test('linkifies text inside <pre> (Gerrit commit message format)', () => {
    const { walkAndLinkify } = contentExports;
    document.body.innerHTML =
      '<pre>fix: resolve issue\n\nSee CSWPR-77 for details.</pre>';
    walkAndLinkify(document.body, RULES, PATTERN);
    const link = document.querySelector('.prefix-linker-link');
    expect(link).not.toBeNull();
    expect(link.textContent).toBe('CSWPR-77');
  });

  test('linkifies text inside open shadow DOM (Gerrit gr-commit-message)', () => {
    const { walkAndLinkify } = contentExports;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<div>커밋 메시지: CSWPR-42</div>';

    walkAndLinkify(document.body, RULES, PATTERN);

    const link = shadow.querySelector('.prefix-linker-link');
    expect(link).not.toBeNull();
    expect(link.textContent).toBe('CSWPR-42');
  });

  test('linkifies <pre> inside open shadow DOM (Gerrit raw commit text)', () => {
    const { walkAndLinkify } = contentExports;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<pre>fix: CSWPR-100\n\nAlso closes CSWPR-101.</pre>';

    walkAndLinkify(document.body, RULES, PATTERN);

    const links = shadow.querySelectorAll('.prefix-linker-link');
    expect(links).toHaveLength(2);
    expect(links[0].textContent).toBe('CSWPR-100');
    expect(links[1].textContent).toBe('CSWPR-101');
  });

  test('does not linkify text inside <code> even in shadow DOM', () => {
    const { walkAndLinkify } = contentExports;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<code>const x = "CSWPR-CODE";</code>';

    walkAndLinkify(document.body, RULES, PATTERN);

    expect(shadow.querySelector('.prefix-linker-link')).toBeNull();
  });
});
