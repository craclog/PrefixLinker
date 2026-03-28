/**
 * PrefixLinker - Core Logic
 * Pure functions with no DOM/browser dependencies — fully unit-testable.
 */

/**
 * Escape special regex characters in a string.
 * @param {string} str
 * @returns {string}
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a single RegExp that matches any configured prefix + trailing word chars.
 * Returns null when rules list is empty.
 *
 * @param {Array<{prefix: string, urlTemplate: string}>} rules
 * @returns {RegExp|null}
 */
function buildPattern(rules) {
  if (!rules || rules.length === 0) return null;
  const alts = rules.map(r => escapeRegex(r.prefix) + '[\\w\\-]+');
  return new RegExp('(' + alts.join('|') + ')', 'g');
}

/**
 * Find the first rule whose prefix matches the start of matchedText.
 *
 * @param {string} matchedText
 * @param {Array<{prefix: string, urlTemplate: string}>} rules
 * @returns {{prefix: string, urlTemplate: string}|null}
 */
function findMatchingRule(matchedText, rules) {
  return rules.find(r => matchedText.startsWith(r.prefix)) || null;
}

/**
 * Replace the `{match}` placeholder in urlTemplate with the URL-encoded matchedText.
 *
 * @param {string} urlTemplate  e.g. "https://example.com?q={match}"
 * @param {string} matchedText  e.g. "CSWPR-12345"
 * @returns {string}
 */
function generateUrl(urlTemplate, matchedText) {
  return urlTemplate.replace('{match}', encodeURIComponent(matchedText));
}

/**
 * Split a text string into an array of {type, value} segments.
 * type is 'text' for plain text and 'match' for a pattern hit.
 *
 * @param {string} text
 * @param {RegExp} pattern  Must have the 'g' flag.
 * @returns {Array<{type: 'text'|'match', value: string}>}
 */
function splitTextByPattern(text, pattern) {
  const parts = [];
  let lastIndex = 0;
  pattern.lastIndex = 0;

  let m;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > lastIndex) {
      parts.push({ type: 'text', value: text.slice(lastIndex, m.index) });
    }
    parts.push({ type: 'match', value: m[0] });
    lastIndex = m.index + m[0].length;
  }

  if (lastIndex < text.length) {
    parts.push({ type: 'text', value: text.slice(lastIndex) });
  }

  return parts;
}

/**
 * Return a new rules array with the entry at `index` replaced by `updatedRule`.
 * If `index` is out of range the original contents are preserved (still a new array).
 *
 * @param {Array<{prefix:string, urlTemplate:string}>} rules
 * @param {number} index
 * @param {{prefix:string, urlTemplate:string}} updatedRule
 * @returns {Array<{prefix:string, urlTemplate:string}>}
 */
function updateRule(rules, index, updatedRule) {
  return rules.map((rule, i) => (i === index ? updatedRule : rule));
}

/**
 * Return true when the element (or any ancestor) has already been processed
 * by PrefixLinker, so we never double-linkify a node.
 *
 * @param {Element} element
 * @param {string} processedAttr  The marker attribute name.
 * @returns {boolean}
 */
function isAlreadyProcessed(element, processedAttr) {
  if (!element || typeof element.closest !== 'function') return false;
  return element.closest('[' + processedAttr + ']') !== null;
}

// Node.js export (tests). In the browser this file is loaded as a plain script.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    escapeRegex, buildPattern, findMatchingRule, generateUrl,
    splitTextByPattern, isAlreadyProcessed, updateRule,
  };
}
