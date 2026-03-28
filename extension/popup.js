'use strict';

const ruleList   = document.getElementById('rule-list');
const inpPrefix  = document.getElementById('inp-prefix');
const inpUrl     = document.getElementById('inp-url');
const btnAdd     = document.getElementById('btn-add');
const saveBanner = document.getElementById('save-banner');

let rules = [];

// ── Render ──────────────────────────────────────────────────────────────────

function render() {
  ruleList.innerHTML = '';

  if (rules.length === 0) {
    ruleList.innerHTML = '<li class="empty-state">등록된 규칙이 없습니다.</li>';
    return;
  }

  rules.forEach((rule, idx) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="rule-info">
        <div class="prefix">${escapeHtml(rule.prefix)}</div>
        <div class="url-template">${escapeHtml(rule.urlTemplate)}</div>
      </div>
      <button data-idx="${idx}" title="삭제">✕</button>
    `;
    ruleList.appendChild(li);
  });
}

// ── Persistence ─────────────────────────────────────────────────────────────

function saveRules(newRules) {
  rules = newRules;
  chrome.storage.sync.set({ rules }, () => {
    render();
    showBanner();
    // Notify all tabs to reload so new rules take effect.
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { type: 'RULES_UPDATED' }).catch(() => {});
      });
    });
  });
}

// ── Event handlers ───────────────────────────────────────────────────────────

btnAdd.addEventListener('click', () => {
  const prefix = inpPrefix.value.trim();
  const urlTemplate = inpUrl.value.trim();

  if (!prefix) { inpPrefix.focus(); return; }
  if (!urlTemplate) { inpUrl.focus(); return; }

  if (rules.some(r => r.prefix === prefix)) {
    alert(`"${prefix}" 규칙이 이미 존재합니다.`);
    return;
  }

  saveRules([...rules, { prefix, urlTemplate }]);
  inpPrefix.value = '';
  inpUrl.value = '';
  inpPrefix.focus();
});

ruleList.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-idx]');
  if (!btn) return;
  const idx = parseInt(btn.dataset.idx, 10);
  const updated = rules.filter((_, i) => i !== idx);
  saveRules(updated);
});

// Allow Enter key in the URL field to trigger Add.
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
