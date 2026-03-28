/**
 * PrefixLinker — Content Script
 * Walks the page's text nodes and replaces matches with <a> elements.
 * Depends on core.js being loaded first (via manifest content_scripts order).
 */

(function () {
  'use strict';

  // Tags whose text content must never be modified.
  const SKIP_TAGS = new Set([
    'A', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT',
    'SELECT', 'BUTTON', 'CODE', 'PRE',
  ]);

  // Marker attribute to avoid re-processing nodes we already touched.
  const PROCESSED_ATTR = 'data-prefixlinker-done';

  /**
   * Walk every text node beneath `root` and linkify matches.
   *
   * @param {Node} root
   * @param {Array<{prefix:string, urlTemplate:string}>} rules
   * @param {RegExp} pattern
   */
  function walkAndLinkify(root, rules, pattern) {
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
          if (parent.closest('[' + PROCESSED_ATTR + ']')) return NodeFilter.FILTER_REJECT;
          if (node.nodeValue.trim() === '') return NodeFilter.FILTER_SKIP;
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) {
      textNodes.push(node);
    }

    textNodes.forEach(textNode => linkifyTextNode(textNode, rules, pattern));
  }

  /**
   * Replace a single text node with a DocumentFragment that contains
   * plain text nodes and <a> elements for each match.
   *
   * @param {Text} textNode
   * @param {Array} rules
   * @param {RegExp} pattern
   */
  function linkifyTextNode(textNode, rules, pattern) {
    const parts = splitTextByPattern(textNode.nodeValue, pattern);

    // Nothing to do if there are no matches.
    if (parts.every(p => p.type === 'text')) return;

    const fragment = document.createDocumentFragment();

    parts.forEach(part => {
      if (part.type === 'text') {
        fragment.appendChild(document.createTextNode(part.value));
        return;
      }

      const rule = findMatchingRule(part.value, rules);
      if (!rule) {
        fragment.appendChild(document.createTextNode(part.value));
        return;
      }

      const a = document.createElement('a');
      a.href = generateUrl(rule.urlTemplate, part.value);
      a.textContent = part.value;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.className = 'prefix-linker-link';
      a.setAttribute(PROCESSED_ATTR, '1');
      fragment.appendChild(a);
    });

    textNode.parentNode.replaceChild(fragment, textNode);
  }

  // Active observer reference — kept so we can disconnect on rule updates.
  let observer = null;

  /**
   * Start a MutationObserver that linkifies newly added nodes in real time.
   *
   * @param {Array} rules
   * @param {RegExp} pattern
   */
  function startObserver(rules, pattern) {
    if (observer) observer.disconnect();

    observer = new MutationObserver((mutations) => {
      mutations.forEach(({ addedNodes }) => {
        addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            walkAndLinkify(node, rules, pattern);
          } else if (node.nodeType === Node.TEXT_NODE) {
            linkifyTextNode(node, rules, pattern);
          }
        });
      });
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  /**
   * Main entry: load rules from storage, process the current page,
   * then watch for dynamic content.
   */
  function init() {
    chrome.storage.sync.get({ rules: [] }, ({ rules }) => {
      if (!rules || rules.length === 0) return;

      const pattern = buildPattern(rules);
      if (!pattern) return;

      walkAndLinkify(document.body, rules, pattern);
      startObserver(rules, pattern);
    });
  }

  // Run on initial page load.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Re-run when the popup saves updated rules.
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'RULES_UPDATED') {
      window.location.reload();
    }
  });
})();
