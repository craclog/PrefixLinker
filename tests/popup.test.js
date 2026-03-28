/**
 * @jest-environment jsdom
 *
 * popup.js is a plain browser script (no exports).
 * We simulate the browser environment:
 *   1. Provide DOM structure matching popup.html's <body>
 *   2. Mock chrome.* APIs
 *   3. Expose core.js functions as globals — this mirrors what
 *      <script src="core.js"> does in popup.html before popup.js loads.
 *      Without this step, popup.js throws "updateRule is not defined"
 *      when the user tries to save an edited rule.
 */
'use strict';

// ── 1. Core globals (simulates <script src="core.js"> in popup.html) ────────
const core = require('../src/core');
Object.assign(global, core);

// ── 2. Chrome API mock ───────────────────────────────────────────────────────
let _rules = [];

global.chrome = {
  storage: {
    sync: {
      get: jest.fn((_defaults, cb) => cb({ rules: _rules })),
      set: jest.fn((data, cb) => { _rules = [...data.rules]; if (cb) cb(); }),
    },
  },
  tabs: {
    query:       jest.fn((_q, cb) => cb([])),
    sendMessage: jest.fn(() => Promise.resolve()),
  },
  runtime: {
    onMessage: { addListener: jest.fn() },
  },
};

// ── 3. Minimal popup DOM ─────────────────────────────────────────────────────
const POPUP_HTML = `
  <ul id="rule-list"></ul>
  <div id="add-form">
    <div id="edit-label">규칙 수정 중</div>
    <input id="inp-prefix" type="text" />
    <input id="inp-url"    type="text" />
    <button id="btn-add">추가</button>
    <button id="btn-cancel">취소</button>
  </div>
  <div id="save-banner"></div>
`;

// ── Helper: reset DOM + module cache then load popup.js ──────────────────────
function initPopup(initialRules = []) {
  document.body.innerHTML = POPUP_HTML;
  jest.resetModules();
  jest.clearAllMocks();  // reset call counts so each test starts fresh
  // Re-expose core globals after module reset (they persist on global, but
  // re-assigning ensures a clean state if core.js is ever restructured).
  Object.assign(global, require('../src/core'));
  _rules = [...initialRules];
  require('../extension/popup.js');
}

const RULE_A = { prefix: 'CSWPR-', urlTemplate: 'https://www.google.com/search?q={match}' };
const RULE_B = { prefix: 'JIRA-',  urlTemplate: 'https://jira.example.com/browse/{match}' };

// ── Tests ────────────────────────────────────────────────────────────────────

describe('popup: initial render', () => {
  test('shows empty-state when there are no rules', () => {
    initPopup([]);
    expect(document.querySelector('.empty-state')).not.toBeNull();
  });

  test('renders one row per rule', () => {
    initPopup([RULE_A, RULE_B]);
    expect(document.querySelectorAll('#rule-list li:not(.empty-state)')).toHaveLength(2);
  });

  test('each row shows the prefix and URL template', () => {
    initPopup([RULE_A]);
    expect(document.querySelector('.prefix').textContent).toBe('CSWPR-');
    expect(document.querySelector('.url-template').textContent).toContain('google.com');
  });

  test('each row has both an edit and a delete button', () => {
    initPopup([RULE_A]);
    expect(document.querySelectorAll('.btn-edit')).toHaveLength(1);
    expect(document.querySelectorAll('.btn-delete')).toHaveLength(1);
  });
});

describe('popup: add mode', () => {
  beforeEach(() => initPopup([RULE_A]));

  test('adds a new rule and clears the form on submit', () => {
    document.getElementById('inp-prefix').value = 'JIRA-';
    document.getElementById('inp-url').value    = 'https://jira.example.com/browse/{match}';
    document.getElementById('btn-add').click();

    expect(_rules).toHaveLength(2);
    expect(_rules[1].prefix).toBe('JIRA-');
    expect(document.getElementById('inp-prefix').value).toBe('');
  });

  test('rejects a duplicate prefix with an alert', () => {
    const spy = jest.spyOn(window, 'alert').mockImplementation(() => {});
    document.getElementById('inp-prefix').value = 'CSWPR-';
    document.getElementById('inp-url').value    = 'https://other.com/{match}';
    document.getElementById('btn-add').click();

    expect(spy).toHaveBeenCalled();
    expect(_rules).toHaveLength(1);
    spy.mockRestore();
  });
});

describe('popup: edit mode — entering', () => {
  beforeEach(() => initPopup([RULE_A, RULE_B]));

  test('clicking edit fills the form with the existing values', () => {
    document.querySelectorAll('.btn-edit')[0].click();
    expect(document.getElementById('inp-prefix').value).toBe('CSWPR-');
    expect(document.getElementById('inp-url').value).toBe('https://www.google.com/search?q={match}');
  });

  test('clicking edit changes the submit button label to 저장', () => {
    document.querySelectorAll('.btn-edit')[0].click();
    expect(document.getElementById('btn-add').textContent).toBe('저장');
  });

  test('clicking edit adds the edit-mode CSS class to the form', () => {
    document.querySelectorAll('.btn-edit')[0].click();
    expect(document.getElementById('add-form').classList.contains('edit-mode')).toBe(true);
  });
});

describe('popup: edit mode — saving', () => {
  beforeEach(() => initPopup([RULE_A, RULE_B]));

  test('saving updates the rule in storage', () => {
    document.querySelectorAll('.btn-edit')[0].click();
    document.getElementById('inp-url').value = 'https://new-url.com/{match}';
    document.getElementById('btn-add').click();

    expect(_rules[0].urlTemplate).toBe('https://new-url.com/{match}');
    expect(_rules).toHaveLength(2); // count must not change
  });

  test('saving exits edit mode: button label reverts to 추가', () => {
    document.querySelectorAll('.btn-edit')[0].click();
    document.getElementById('inp-url').value = 'https://new-url.com/{match}';
    document.getElementById('btn-add').click();

    expect(document.getElementById('btn-add').textContent).toBe('추가');
  });

  test('saving exits edit mode: edit-mode class is removed', () => {
    document.querySelectorAll('.btn-edit')[0].click();
    document.getElementById('inp-url').value = 'https://new-url.com/{match}';
    document.getElementById('btn-add').click();

    expect(document.getElementById('add-form').classList.contains('edit-mode')).toBe(false);
  });

  test('saving exits edit mode: form fields are cleared', () => {
    document.querySelectorAll('.btn-edit')[0].click();
    document.getElementById('inp-url').value = 'https://new-url.com/{match}';
    document.getElementById('btn-add').click();

    expect(document.getElementById('inp-prefix').value).toBe('');
    expect(document.getElementById('inp-url').value).toBe('');
  });

  test('keeping the same prefix does not trigger a duplicate-prefix error', () => {
    const spy = jest.spyOn(window, 'alert').mockImplementation(() => {});
    document.querySelectorAll('.btn-edit')[0].click();
    document.getElementById('inp-url').value = 'https://new-url.com/{match}';
    document.getElementById('btn-add').click();

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  test('changing prefix to one used by another rule triggers a duplicate-prefix error', () => {
    const spy = jest.spyOn(window, 'alert').mockImplementation(() => {});
    document.querySelectorAll('.btn-edit')[0].click();
    document.getElementById('inp-prefix').value = 'JIRA-'; // already used by RULE_B
    document.getElementById('btn-add').click();

    expect(spy).toHaveBeenCalled();
    expect(_rules[0].prefix).toBe('CSWPR-'); // unchanged
    spy.mockRestore();
  });
});

describe('popup: edit mode — cancel', () => {
  beforeEach(() => initPopup([RULE_A, RULE_B]));

  test('cancel exits edit mode without modifying storage', () => {
    document.querySelectorAll('.btn-edit')[0].click();
    document.getElementById('inp-url').value = 'https://changed.com/{match}';
    document.getElementById('btn-cancel').click();

    expect(_rules[0].urlTemplate).toBe('https://www.google.com/search?q={match}');
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
  });

  test('cancel reverts the button label to 추가', () => {
    document.querySelectorAll('.btn-edit')[0].click();
    document.getElementById('btn-cancel').click();
    expect(document.getElementById('btn-add').textContent).toBe('추가');
  });

  test('cancel removes the edit-mode class', () => {
    document.querySelectorAll('.btn-edit')[0].click();
    document.getElementById('btn-cancel').click();
    expect(document.getElementById('add-form').classList.contains('edit-mode')).toBe(false);
  });
});

describe('popup: edit mode — delete while editing', () => {
  beforeEach(() => initPopup([RULE_A, RULE_B]));

  test('deleting the rule being edited also exits edit mode', () => {
    document.querySelectorAll('.btn-edit')[0].click();
    document.querySelectorAll('.btn-delete')[0].click();

    expect(_rules).toHaveLength(1);
    expect(document.getElementById('btn-add').textContent).toBe('추가');
    expect(document.getElementById('add-form').classList.contains('edit-mode')).toBe(false);
  });

  test('deleting a different rule while in edit mode does not exit edit mode', () => {
    document.querySelectorAll('.btn-edit')[0].click();      // editing RULE_A
    document.querySelectorAll('.btn-delete')[1].click();    // deleting RULE_B

    expect(_rules).toHaveLength(1);
    expect(document.getElementById('btn-add').textContent).toBe('저장'); // still editing
  });
});
