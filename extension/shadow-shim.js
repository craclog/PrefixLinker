/**
 * PrefixLinker — Shadow DOM Shim (MAIN world)
 *
 * Runs in the page's JavaScript context (world: "MAIN") so that the patch
 * actually intercepts every attachShadow call made by page scripts (e.g.
 * Gerrit's Polymer components, test.html's addGerritDynamic).
 *
 * When an open shadow root is created, we dispatch a bubbling CustomEvent on
 * the host element.  The isolated-world content script listens for this event
 * and immediately sets up a MutationObserver on the new shadow root, so any
 * content added afterwards (shadow.innerHTML, appendChild, …) is linkified.
 *
 * Why this file is necessary:
 *   Content scripts run in an isolated JavaScript world.  Patching
 *   Element.prototype.attachShadow inside content.js only affects code that
 *   runs in the same isolated world — page scripts still call the original,
 *   unpatched attachShadow and the content script never learns about the new
 *   shadow root.  Running this shim in MAIN world solves that gap.
 */
(function () {
  'use strict';

  var _orig = Element.prototype.attachShadow;

  Element.prototype.attachShadow = function (init) {
    var shadowRoot = _orig.call(this, init);
    if (init && init.mode === 'open') {
      this.dispatchEvent(
        new CustomEvent('__prefixlinker_shadowroot', { bubbles: true })
      );
    }
    return shadowRoot;
  };
})();
