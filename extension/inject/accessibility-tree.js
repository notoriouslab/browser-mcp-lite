// Accessibility Tree Builder
// Builds a text representation of the DOM for AI consumption.
// Each interactive/structural element gets a ref_* ID for targeting.

(() => {
  const MAX_DEPTH = 25;
  const MAX_NODES = 3000;
  const MAX_LABEL = 80;

  // Ref counter (persisted on window for subsequent calls)
  if (!window.__mcpRefCounter) window.__mcpRefCounter = 0;
  if (!window.__mcpRefMap) window.__mcpRefMap = new Map();

  let nodeCount = 0;

  function getRef(el) {
    if (window.__mcpRefMap.has(el)) return window.__mcpRefMap.get(el);
    const ref = `ref_${++window.__mcpRefCounter}`;
    window.__mcpRefMap.set(el, ref);
    return ref;
  }

  // --- Visibility ---
  function isVisible(el) {
    if (!(el instanceof HTMLElement)) return true;
    const style = getComputedStyle(el);
    if (style.display === 'none') return false;
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    if (parseFloat(style.opacity) === 0) return false;
    if (el.offsetWidth === 0 && el.offsetHeight === 0 && style.overflow === 'hidden') return false;
    return true;
  }

  // --- Role inference ---
  const TAG_ROLES = {
    A: 'link', BUTTON: 'button', INPUT: 'input', SELECT: 'select',
    TEXTAREA: 'textarea', IMG: 'image', TABLE: 'table', TR: 'row',
    TH: 'columnheader', TD: 'cell', FORM: 'form', NAV: 'navigation',
    MAIN: 'main', HEADER: 'banner', FOOTER: 'contentinfo',
    ASIDE: 'complementary', SECTION: 'region', ARTICLE: 'article',
    UL: 'list', OL: 'list', LI: 'listitem', DIALOG: 'dialog',
    H1: 'heading', H2: 'heading', H3: 'heading',
    H4: 'heading', H5: 'heading', H6: 'heading',
  };

  function inferRole(el) {
    const ariaRole = el.getAttribute?.('role');
    if (ariaRole) return ariaRole;
    const tag = el.tagName;
    if (TAG_ROLES[tag]) return TAG_ROLES[tag];
    if (tag === 'INPUT') {
      const type = (el.type || 'text').toLowerCase();
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'submit' || type === 'button') return 'button';
      return 'textbox';
    }
    return null;
  }

  // --- Label inference ---
  function inferLabel(el) {
    const ariaLabel = el.getAttribute?.('aria-label');
    if (ariaLabel) return truncate(ariaLabel);

    const labelledBy = el.getAttribute?.('aria-labelledby');
    if (labelledBy) {
      const parts = labelledBy.split(/\s+/).map(id => document.getElementById(id)?.textContent?.trim()).filter(Boolean);
      if (parts.length) return truncate(parts.join(' '));
    }

    const tag = el.tagName;

    if (tag === 'IMG') return truncate(el.alt || el.title || '');

    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      if (el.placeholder) return truncate(el.placeholder);
      if (el.title) return truncate(el.title);
      if (el.id) {
        const label = document.querySelector(`label[for="${el.id}"]`);
        if (label) return truncate(label.textContent);
      }
      return '';
    }

    if (tag === 'A' || tag === 'BUTTON') {
      return truncate(el.textContent?.trim() || el.title || '');
    }

    if (/^H[1-6]$/.test(tag)) {
      return truncate(el.textContent?.trim() || '');
    }

    return '';
  }

  function truncate(text) {
    if (!text) return '';
    const clean = text.replace(/\s+/g, ' ').trim();
    return clean.length > MAX_LABEL ? clean.slice(0, MAX_LABEL) + '...' : clean;
  }

  // --- Interactivity check ---
  function isInteractive(el) {
    if (!(el instanceof HTMLElement)) return false;
    const tag = el.tagName;
    if (['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(tag)) return true;
    if (el.hasAttribute('onclick') || el.hasAttribute('tabindex')) return true;
    if (el.isContentEditable) return true;
    const role = el.getAttribute('role');
    if (role && ['button', 'link', 'tab', 'menuitem', 'checkbox', 'radio', 'textbox', 'switch', 'option'].includes(role)) return true;
    return false;
  }

  // --- Structural check ---
  function isStructural(el) {
    const tag = el.tagName;
    return /^H[1-6]$/.test(tag) || ['NAV', 'MAIN', 'HEADER', 'FOOTER', 'SECTION', 'ARTICLE', 'ASIDE', 'TABLE', 'FORM', 'DIALOG'].includes(tag);
  }

  // --- Tree builder ---
  function buildTree(node, depth, lines) {
    if (nodeCount >= MAX_NODES || depth > MAX_DEPTH) return;

    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim();
      if (text && text.length > 1) {
        const indent = '  '.repeat(depth);
        lines.push(`${indent}${truncate(text)}`);
        nodeCount++;
      }
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node;
    if (!isVisible(el)) return;

    const tag = el.tagName;
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'LINK', 'META', 'BR', 'HR'].includes(tag)) return;

    const role = inferRole(el);
    const label = inferLabel(el);
    const interactive = isInteractive(el);
    const structural = isStructural(el);

    const shouldOutput = role || interactive || structural;

    if (shouldOutput) {
      nodeCount++;
      const ref = getRef(el);
      const indent = '  '.repeat(depth);
      const parts = [ref];
      if (role) parts.push(role);
      if (tag === 'INPUT') parts.push(`type=${el.type || 'text'}`);
      if (/^H[1-6]$/.test(tag)) parts.push(`level=${tag[1]}`);
      if (label) parts.push(`"${label}"`);
      if (el.value && ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) {
        const inputType = (el.type || '').toLowerCase();
        if (inputType !== 'password') {
          parts.push(`value="${truncate(el.value)}"`);
        }
      }
      if (el.checked) parts.push('checked');
      if (el.disabled) parts.push('disabled');
      if (tag === 'A' && el.href) parts.push(`href=${truncate(el.href)}`);

      lines.push(`${indent}[${parts.join(' ')}]`);
    }

    const children = el.shadowRoot ? el.shadowRoot.childNodes : el.childNodes;
    for (const child of children) {
      buildTree(child, shouldOutput ? depth + 1 : depth, lines);
    }
  }

  // --- Main ---
  const lines = [`Page: ${document.title}`, `URL: ${location.href}`, ''];
  nodeCount = 0;
  buildTree(document.body, 0, lines);

  if (nodeCount >= MAX_NODES) {
    lines.push(`\n... (truncated at ${MAX_NODES} nodes)`);
  }

  return lines.join('\n');
})();
