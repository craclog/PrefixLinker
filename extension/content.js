/**
 * PrefixLinker — Content Script
 * Walks the page's text nodes and replaces matches with <a> elements.
 * Depends on core.js being loaded first (via manifest content_scripts order).
 */

(function () {
  'use strict';

  // Tags whose text content must never be modified.
  // NOTE: PRE is intentionally excluded — commit-message containers in tools
  // like Gerrit render text inside <pre> elements and should be linkified.
  const SKIP_TAGS = new Set([
    'A', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT',
    'SELECT', 'BUTTON', 'CODE',
  ]);

  // Marker attribute to avoid re-processing nodes we already touched.
  const PROCESSED_ATTR = 'data-prefixlinker-done';

  /**
   * Walk every text node beneath `root` and linkify matches.
   * Also recurses into open shadow roots so that web components
   * (e.g. Gerrit's gr-commit-message) have their text linkified too.
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

    // Recurse into open shadow roots (querySelectorAll does not pierce shadow
    // boundaries, so we must check each element's .shadowRoot explicitly).
    if (root.querySelectorAll) {
      Array.from(root.querySelectorAll('*')).forEach(el => {
        if (el.shadowRoot) walkAndLinkify(el.shadowRoot, rules, pattern);
      });
    }

    // When the MutationObserver fires during Gerrit SPA navigation, it calls
    // walkAndLinkify with the newly added ELEMENT (e.g. <gr-change-view>), not
    // its shadowRoot.  Polymer/LitElement components set up their shadow DOM
    // synchronously, so the shadow DOM already has content at mutation time.
    // querySelectorAll('*') above only walks the light DOM, so we must also
    // recurse into root's own shadowRoot when root is a shadow-host element.
    if (root.shadowRoot) walkAndLinkify(root.shadowRoot, rules, pattern);
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
    // Guard: the node may have been detached between the MutationObserver
    // recording it as "added" and this callback actually running.
    // In browsers, multiple DOM mutations are batched before the observer
    // fires, so a node can be removed before we get to process it.
    if (!textNode.parentNode) return;

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

  // Track shadow roots we are already observing to avoid duplicate observers.
  const _observedShadowRoots = new WeakSet();
  // All shadow-root MutationObserver instances — disconnected on rule updates.
  let _shadowObservers = [];

  /**
   * Start a MutationObserver on a single shadow root and track it.
   * Newly added nodes inside the shadow root are processed and their own
   * shadow roots are observed recursively.
   *
   * @param {ShadowRoot} shadowRoot
   * @param {Array} rules
   * @param {RegExp} pattern
   */
  function _observeShadowRoot(shadowRoot, rules, pattern) {
    if (_observedShadowRoots.has(shadowRoot)) return;
    _observedShadowRoots.add(shadowRoot);

    const obs = new MutationObserver((mutations) => {
      mutations.forEach(({ addedNodes }) => {
        addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (!node.isConnected) return;
            walkAndLinkify(node, rules, pattern);
            _observeElementShadowRoots(node, rules, pattern);
          } else if (node.nodeType === Node.TEXT_NODE) {
            linkifyTextNode(node, rules, pattern);
          }
        });
      });
    });
    obs.observe(shadowRoot, { childList: true, subtree: true });
    _shadowObservers.push(obs);
  }

  /**
   * Set up MutationObservers for all shadow roots found within `el`
   * (including `el` itself). Already-observed roots are skipped.
   *
   * @param {Element|ShadowRoot} el
   * @param {Array} rules
   * @param {RegExp} pattern
   */
  function _observeElementShadowRoots(el, rules, pattern) {
    if (el.shadowRoot) _observeShadowRoot(el.shadowRoot, rules, pattern);
    if (el.querySelectorAll) {
      Array.from(el.querySelectorAll('*')).forEach(child => {
        if (child.shadowRoot) _observeShadowRoot(child.shadowRoot, rules, pattern);
      });
    }
  }

  /**
   * Start a MutationObserver that linkifies newly added nodes in real time.
   * Also watches existing and future shadow roots for dynamic changes.
   *
   * @param {Array} rules
   * @param {RegExp} pattern
   */
  function startObserver(rules, pattern) {
    if (observer) observer.disconnect();
    _shadowObservers.forEach(obs => obs.disconnect());
    _shadowObservers = [];

    observer = new MutationObserver((mutations) => {
      mutations.forEach(({ addedNodes }) => {
        addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Guard: element may have been removed before this callback ran.
            if (!node.isConnected) return;
            walkAndLinkify(node, rules, pattern);
            _observeElementShadowRoots(node, rules, pattern);
          } else if (node.nodeType === Node.TEXT_NODE) {
            linkifyTextNode(node, rules, pattern);
          }
        });
      });
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Set up observers for shadow roots that already exist in the page
    // (e.g. Gerrit components rendered before this script ran).
    _observeElementShadowRoots(document.body, rules, pattern);
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

  // Expose internals for unit testing in Node.js (no-op in the browser).
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { linkifyTextNode, walkAndLinkify };
  }
})();
