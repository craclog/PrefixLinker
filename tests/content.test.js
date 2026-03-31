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

/**
 * Simulates the test.html page-load scenario:
 * 1. Set up light-DOM HTML (shadow host elements etc.)
 * 2. Run setupFn to attach shadow roots (before content script loads)
 * 3. Load content.js — init() fires immediately via the sync mock
 *
 * This mirrors what happens in the browser: page scripts create shadow DOM
 * before the content script's chrome.storage.sync.get callback fires.
 */
function loadContentWithShadow(html, setupFn, rules = DEFAULT_RULES) {
  document.body.innerHTML = html;
  setupFn && setupFn();
  jest.resetModules();
  jest.clearAllMocks();
  Object.assign(global, require('../src/core'));
  _rules = [...rules];
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

// ── Tests: shadow-host element passed directly (Gerrit SPA navigation) ────────
//
// When a user clicks a link in Gerrit's related-change chain, Gerrit navigates
// via history.pushState and re-renders the new change view inside <gr-app>'s
// shadow DOM.  The MutationObserver fires with the new <gr-change-view> element
// in addedNodes and calls walkAndLinkify(<gr-change-view>, rules, pattern).
//
// <gr-change-view> is itself a shadow host — commit-message text lives inside
// its own shadow DOM.  Before the fix, walkAndLinkify only traversed the light
// DOM and the shadow roots of light-DOM descendants, completely missing the
// added element's own shadowRoot.

describe('content: walkAndLinkify — shadow-host element (Gerrit SPA navigation)', () => {
  beforeEach(() => loadContent());

  test('linkifies text in shadow root when called with the shadow-host element directly', () => {
    const { walkAndLinkify } = contentExports;
    const host = document.createElement('div');
    const shadowRoot = host.attachShadow({ mode: 'open' });
    shadowRoot.innerHTML = '<span>Fix CSWPR-12345 in production</span>';
    document.body.appendChild(host);

    // Simulate what the MutationObserver callback does: it receives the added
    // ELEMENT (not its shadowRoot).  The shadow DOM already has content at this
    // point because Polymer/LitElement custom elements set up their shadow DOM
    // synchronously before the element is connected to the DOM.
    walkAndLinkify(host, RULES, PATTERN);

    const links = shadowRoot.querySelectorAll('.prefix-linker-link');
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toBe('CSWPR-12345');
    expect(links[0].href).toBe('https://www.google.com/search?q=CSWPR-12345');
  });

  test('linkifies text in nested shadow DOMs when called with outermost shadow-host', () => {
    // Mirrors Gerrit's <gr-app> → <gr-change-view> → <gr-commit-message> nesting.
    const { walkAndLinkify } = contentExports;

    const outer = document.createElement('div');
    const outerShadow = outer.attachShadow({ mode: 'open' });

    const inner = document.createElement('div');
    const innerShadow = inner.attachShadow({ mode: 'open' });
    innerShadow.innerHTML = '<span>CSWPR-999</span>';
    outerShadow.appendChild(inner);
    document.body.appendChild(outer);

    walkAndLinkify(outer, RULES, PATTERN);

    const links = innerShadow.querySelectorAll('.prefix-linker-link');
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toBe('CSWPR-999');
  });

  test('light DOM text in the host itself is still linkified alongside shadow DOM', () => {
    const { walkAndLinkify } = contentExports;
    const host = document.createElement('div');
    const shadowRoot = host.attachShadow({ mode: 'open' });
    shadowRoot.innerHTML = '<p>CSWPR-111</p>';

    // Light DOM slot content lives directly inside the host.
    const slot = document.createElement('span');
    slot.textContent = 'CSWPR-222';
    host.appendChild(slot);
    document.body.appendChild(host);

    walkAndLinkify(host, RULES, PATTERN);

    const shadowLinks = shadowRoot.querySelectorAll('.prefix-linker-link');
    const lightLinks  = host.querySelectorAll(':not([data-prefixlinker-done]) .prefix-linker-link');
    expect(shadowLinks).toHaveLength(1);
    expect(lightLinks).toHaveLength(1);
  });
});

// ── Tests: attachShadow called AFTER init (test.html addGerritDynamic scenario) ─
//
// The root cause of the Gerrit related-chain bug:
//
//   1. init() / startObserver() runs — no shadow root on the host element yet.
//   2. User clicks a button (or Gerrit SPA navigates) → attachShadow() is called
//      on an element that is already in the light DOM.
//   3. MutationObserver on document.body does NOT observe shadow-root mutations,
//      so content added to the new shadow root is never processed.
//
// Fix: monkey-patch Element.prototype.attachShadow so that every new open shadow
// root gets a MutationObserver registered on it immediately at creation time.

describe('content: dynamic shadow root creation after init (addGerritDynamic scenario)', () => {
  let origAttachShadow;

  beforeEach(() => {
    // Save the real attachShadow before loadContent potentially patches it,
    // so we can restore it after each test and keep test suites isolated.
    origAttachShadow = Element.prototype.attachShadow;
    loadContent(DEFAULT_RULES, '<div id="dynamic-host"></div>');
  });

  afterEach(() => {
    Element.prototype.attachShadow = origAttachShadow;
  });

  test('linkifies content added synchronously after attachShadow on a connected element', async () => {
    const host = document.getElementById('dynamic-host');

    // Simulate addGerritDynamic(): attachShadow then innerHTML on connected element.
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<div>동적 추가 커밋: CSWPR-5999 hotfix</div>';

    // MutationObserver callbacks are microtasks — flush them.
    await Promise.resolve();

    const links = shadow.querySelectorAll('.prefix-linker-link');
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toBe('CSWPR-5999');
  });

  test('linkifies content added asynchronously after attachShadow (Polymer async render)', async () => {
    const host = document.getElementById('dynamic-host');
    const shadow = host.attachShadow({ mode: 'open' });

    // Content is added after a tick — simulates Polymer/LitElement async render.
    await Promise.resolve();
    shadow.innerHTML = '<span>Fixes CSWPR-8888</span>';
    await Promise.resolve();

    const links = shadow.querySelectorAll('.prefix-linker-link');
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toBe('CSWPR-8888');
  });

  test('linkifies content in nested shadow root created dynamically', async () => {
    const host = document.getElementById('dynamic-host');
    const outerShadow = host.attachShadow({ mode: 'open' });

    // Inner shadow host added to outer shadow.
    const inner = document.createElement('div');
    outerShadow.appendChild(inner);
    await Promise.resolve();

    const innerShadow = inner.attachShadow({ mode: 'open' });
    innerShadow.innerHTML = '<p>CSWPR-7777 nested</p>';
    await Promise.resolve();

    const links = innerShadow.querySelectorAll('.prefix-linker-link');
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toBe('CSWPR-7777');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tests mirroring test.html scenarios
// ═══════════════════════════════════════════════════════════════════════════════

// ── test.html 정상 케이스 (should be linkified) ──────────────────────────────

describe('content: test.html — 정상 케이스', () => {
  const BOTH_RULES = [
    { prefix: 'CSWPR-', urlTemplate: 'https://www.google.com/search?q={match}' },
    { prefix: 'JIRA-',  urlTemplate: 'https://jira.example.com/browse/{match}' },
  ];

  test('단일 매칭: Korean sentence with CSWPR-12345', () => {
    loadContent(DEFAULT_RULES, '<p>이슈 CSWPR-12345 를 확인해주세요.</p>');
    const link = document.querySelector('.prefix-linker-link');
    expect(link).not.toBeNull();
    expect(link.textContent).toBe('CSWPR-12345');
  });

  test('문장 앞: match at start of sentence', () => {
    loadContent(DEFAULT_RULES, '<p>CSWPR-1 이 먼저 처리돼야 합니다.</p>');
    const link = document.querySelector('.prefix-linker-link');
    expect(link).not.toBeNull();
    expect(link.textContent).toBe('CSWPR-1');
  });

  test('문장 끝: match at end of sentence', () => {
    loadContent(DEFAULT_RULES, '<p>다음 스프린트로 이관: CSWPR-9999</p>');
    const link = document.querySelector('.prefix-linker-link');
    expect(link).not.toBeNull();
    expect(link.textContent).toBe('CSWPR-9999');
  });

  test('한 줄에 여러 개: multiple matches in one line', () => {
    loadContent(DEFAULT_RULES, '<p>CSWPR-100 과 CSWPR-200 은 중복입니다.</p>');
    const links = document.querySelectorAll('.prefix-linker-link');
    expect(links).toHaveLength(2);
    expect(links[0].textContent).toBe('CSWPR-100');
    expect(links[1].textContent).toBe('CSWPR-200');
  });

  test('여러 prefix 혼합: CSWPR and JIRA in same sentence', () => {
    loadContent(BOTH_RULES, '<p>CSWPR-300 이 JIRA-450 에서 파생됐습니다.</p>');
    const links = document.querySelectorAll('.prefix-linker-link');
    expect(links).toHaveLength(2);
    expect(links[0].textContent).toBe('CSWPR-300');
    expect(links[1].textContent).toBe('JIRA-450');
  });

  test('한글 문장 내 매칭: Korean surrounding text does not affect match', () => {
    loadContent(DEFAULT_RULES, '<p>이 버그는 티켓 CSWPR-777 을 통해 추적됩니다.</p>');
    const link = document.querySelector('.prefix-linker-link');
    expect(link).not.toBeNull();
    expect(link.textContent).toBe('CSWPR-777');
  });
});

// ── test.html 변환되면 안 되는 케이스 (should NOT be linkified) ───────────────

describe('content: test.html — 변환되면 안 되는 케이스', () => {
  test('이미 <a>: no double-wrap inside existing anchor', () => {
    loadContent(DEFAULT_RULES,
      '<a href="https://example.com">CSWPR-000 (이미 &lt;a&gt; 태그 안)</a>');
    const anchor = document.querySelector('a[href="https://example.com"]');
    expect(anchor.querySelector('a')).toBeNull();
  });

  test('textarea: text inside <textarea> is not linkified', () => {
    loadContent(DEFAULT_RULES,
      '<textarea rows="2" readonly>CSWPR-TEXTAREA</textarea>');
    expect(document.querySelector('.prefix-linker-link')).toBeNull();
  });

  test('CSWPR- 단독 (suffix 없음): prefix without suffix must not match', () => {
    loadContent(DEFAULT_RULES, '<p>CSWPR- (suffix 없어서 매칭 안 됨)</p>');
    expect(document.querySelector('.prefix-linker-link')).toBeNull();
  });
});

// ── test.html Gerrit Shadow DOM — init() 흐름으로 처리되는지 ─────────────────
//
// These tests replicate the exact test.html setup:
//   inline page script → attachShadow → innerHTML
// then the content script loads and init() calls walkAndLinkify.
// If these pass, static shadow DOM works end-to-end through the init() path.

describe('content: test.html — Shadow DOM (Gerrit commit message, init() flow)', () => {
  let origAttachShadow;
  beforeEach(() => { origAttachShadow = Element.prototype.attachShadow; });
  afterEach(() => { Element.prototype.attachShadow = origAttachShadow; });

  test('Shadow DOM <div>: CSWPR-5001 linkified by init() on page load', () => {
    let shadow;
    loadContentWithShadow(
      '<div id="gerrit-commit-div"></div>',
      () => {
        const host = document.getElementById('gerrit-commit-div');
        shadow = host.attachShadow({ mode: 'open' });
        shadow.innerHTML =
          '<div>커밋 메시지: CSWPR-5001 수정 건 (Shadow DOM div)</div>';
      },
    );

    const link = shadow.querySelector('.prefix-linker-link');
    expect(link).not.toBeNull();
    expect(link.textContent).toBe('CSWPR-5001');
  });

  test('Shadow DOM <pre>: CSWPR-5002 and CSWPR-5003 linkified by init()', () => {
    let shadow;
    loadContentWithShadow(
      '<div id="gerrit-commit-pre"></div>',
      () => {
        const host = document.getElementById('gerrit-commit-pre');
        shadow = host.attachShadow({ mode: 'open' });
        shadow.innerHTML =
          '<pre>fix: resolve login issue\n\nThis fixes CSWPR-5002.\n' +
          'See also CSWPR-5003 for the backend side.</pre>';
      },
    );

    const links = shadow.querySelectorAll('.prefix-linker-link');
    expect(links).toHaveLength(2);
    expect(links[0].textContent).toBe('CSWPR-5002');
    expect(links[1].textContent).toBe('CSWPR-5003');
  });

  test('Shadow DOM dynamic (addGerritDynamic): CSWPR-5999 linkified via shadow observer', async () => {
    // Simulate: host is already in light DOM, then user clicks button → attachShadow + innerHTML
    loadContentWithShadow('<div id="gerrit-dynamic-host"></div>');

    const host = document.getElementById('gerrit-dynamic-host');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<div>동적 추가 커밋: CSWPR-5999 hotfix</div>';

    await Promise.resolve(); // flush MutationObserver microtasks

    const links = shadow.querySelectorAll('.prefix-linker-link');
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toBe('CSWPR-5999');
  });
});
