'use strict';

const ruleList   = document.getElementById('rule-list');
const inpPrefix  = document.getElementById('inp-prefix');
const inpUrl     = document.getElementById('inp-url');
const btnAdd     = document.getElementById('btn-add');
const btnCancel  = document.getElementById('btn-cancel');
const addForm    = document.getElementById('add-form');
const saveBanner = document.getElementById('save-banner');

let rules = [];
let editingIdx = null; // null = add mode, number = edit mode

// ── Render ──────────────────────────────────────────────────────────────────

function render() {
  ruleList.innerHTML = '';

  if (rules.length === 0) {
    ruleList.innerHTML = '<li class="empty-state">No rules yet.</li>';
    return;
  }

  rules.forEach((rule, idx) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="rule-info">
        <div class="prefix">${escapeHtml(rule.prefix)}</div>
        <div class="url-template">${escapeHtml(rule.urlTemplate)}</div>
      </div>
      <div class="actions">
        <button class="btn-edit"   data-action="edit"   data-idx="${idx}" title="Edit">✎</button>
        <button class="btn-delete" data-action="delete" data-idx="${idx}" title="Delete">✕</button>
      </div>
    `;
    ruleList.appendChild(li);
  });
}

function enterEditMode(idx) {
  editingIdx = idx;
  inpPrefix.value = rules[idx].prefix;
  inpUrl.value    = rules[idx].urlTemplate;
  btnAdd.textContent = 'Save';
  addForm.classList.add('edit-mode');
  inpPrefix.focus();
}

function exitEditMode() {
  editingIdx = null;
  inpPrefix.value = '';
  inpUrl.value    = '';
  btnAdd.textContent = 'Add';
  addForm.classList.remove('edit-mode');
}

// ── Persistence ─────────────────────────────────────────────────────────────

function saveRules(newRules) {
  rules = newRules;
  chrome.storage.sync.set({ rules }, () => {
    render();
    showBanner();
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { type: 'RULES_UPDATED' }).catch(() => {});
      });
    });
  });
}

// ── Event handlers ───────────────────────────────────────────────────────────

btnAdd.addEventListener('click', () => {
  const prefix      = inpPrefix.value.trim();
  const urlTemplate = inpUrl.value.trim();

  if (!prefix)      { inpPrefix.focus(); return; }
  if (!urlTemplate) { inpUrl.focus();    return; }

  if (editingIdx !== null) {
    // 수정 모드: 다른 규칙과 prefix 중복 검사 (자기 자신 제외)
    const duplicate = rules.some((r, i) => i !== editingIdx && r.prefix === prefix);
    if (duplicate) { alert(`A rule with prefix "${prefix}" already exists.`); return; }

    saveRules(updateRule(rules, editingIdx, { prefix, urlTemplate }));
    exitEditMode();
  } else {
    // add mode
    if (rules.some(r => r.prefix === prefix)) {
      alert(`A rule with prefix "${prefix}" already exists.`);
      return;
    }
    saveRules([...rules, { prefix, urlTemplate }]);
    inpPrefix.value = '';
    inpUrl.value    = '';
    inpPrefix.focus();
  }
});

btnCancel.addEventListener('click', exitEditMode);

ruleList.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;

  const idx = parseInt(btn.dataset.idx, 10);

  if (btn.dataset.action === 'edit') {
    enterEditMode(idx);
  } else if (btn.dataset.action === 'delete') {
    if (editingIdx === idx) exitEditMode();
    saveRules(rules.filter((_, i) => i !== idx));
  }
});

// Allow Enter key in the URL field to trigger Add / Save.
inpUrl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnAdd.click();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showBanner() {
  saveBanner.style.display = 'block';
  clearTimeout(showBanner._timer);
  showBanner._timer = setTimeout(() => { saveBanner.style.display = 'none'; }, 2500);
}

// ── Init ─────────────────────────────────────────────────────────────────────

chrome.storage.sync.get({ rules: [] }, (data) => {
  rules = data.rules || [];
  render();
});
