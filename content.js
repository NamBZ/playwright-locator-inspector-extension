// ============================================
// Playwright Locator Inspector — Content Script
// ============================================

(() => {
  "use strict";

  // --- State ---
  let isActive = false;         // Whether the inspector is currently on
  let currentTarget = null;     // Currently hovered element
  let tooltip = null;           // Tooltip DOM element
  let escBanner = null;         // ESC info banner element
  let modal = null;             // Copy modal element
  let copiedTimeout = null;     // Timer for "Copied!" feedback

  // ============================================
  // 1. LOCATOR GENERATION
  // ============================================

  /**
   * Trim and truncate text to a max length.
   * @param {string} text
   * @param {number} max
   * @returns {string}
   */
  function cleanText(text, max = 50) {
    if (!text) return "";
    const trimmed = text.trim().replace(/\s+/g, " ");
    return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
  }

  /**
   * Get the visible (inner) text of an element, excluding children's text optionally.
   * @param {HTMLElement} el
   * @returns {string}
   */
  function getDirectText(el) {
    // Collect text from direct text nodes only
    let text = "";
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
      }
    }
    return cleanText(text);
  }

  /**
   * Get the full visible text content of an element.
   * @param {HTMLElement} el
   * @returns {string}
   */
  function getVisibleText(el) {
    return cleanText(el.textContent);
  }

  /**
   * Find the associated <label> for an input/textarea element.
   * @param {HTMLElement} el
   * @returns {string}
   */
  function getAssociatedLabel(el) {
    // 1. By 'id' attribute — look for <label for="id">
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) {
        const text = cleanText(label.textContent);
        if (text) return text;
      }
    }
    // 2. By parent <label>
    const parentLabel = el.closest("label");
    if (parentLabel) {
      const text = cleanText(parentLabel.textContent);
      if (text) return text;
    }
    // 3. By aria-labelledby
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const labelEl = document.getElementById(labelledBy);
      if (labelEl) {
        const text = cleanText(labelEl.textContent);
        if (text) return text;
      }
    }
    return "";
  }

  /**
   * Generate Playwright locator string for a given element.
   * Priority order as specified in requirements.
   * @param {HTMLElement} el
   * @returns {string}
   */
  function generateLocator(el) {
    const tag = el.tagName.toLowerCase();

    // --- 1. Image with alt/title/src → "img:..." ---
    if (tag === "img" || el.getAttribute("role") === "img") {
      const alt = cleanText(el.getAttribute("alt"));
      if (alt) return `img:${alt}`;

      const title = cleanText(el.getAttribute("title"));
      if (title) return `img:${title}`;

      // 👉 NEW: fallback theo src
      const src = el.getAttribute("src");
      if (src) {
        // lấy phần cuối của path (vd: dong.png)
        const fileName = src.split('/').pop();
        if (fileName) {
          return `img[src*="${fileName}"]`;
        }
      }
    }

    // --- 2. Button with text → "button:Text" ---
    if (tag === "button" || el.getAttribute("role") === "button" || (tag === "input" && (el.type === "button" || el.type === "submit" || el.type === "reset"))) {
      let text = "";
      if (tag === "input") {
        text = cleanText(el.value || el.getAttribute("aria-label") || "");
      } else {
        text = getVisibleText(el);
      }
      if (text) return `button:${text}`;
    }

    // --- 3. Has id → "#id" (HIGHEST PRIORITY) ---
    if (el.id) return `#${el.id}`;

    // --- 4. Link (<a>) → "link:Text" ---
    if (tag === "a" || el.getAttribute("role") === "link") {
      const text = getVisibleText(el);
      if (text) return `link:${text}`;
    }

    // --- 5. Input / Textarea ---
    if (tag === "input" || tag === "textarea" || tag === "select" || el.getAttribute("role") === "textbox") {
      // 5a. Has placeholder → "placeholder:Text"
      const placeholder = cleanText(el.getAttribute("placeholder"));
      if (placeholder) return `placeholder:${placeholder}`;

      // 5b. Has associated label → "label:Text"
      const label = getAssociatedLabel(el);
      if (label) return `label:${label}`;

      // 5c. Fallback → "textbox:Name"
      const name = cleanText(el.getAttribute("name") || el.getAttribute("aria-label") || el.id || "");
      if (name) return `textbox:${name}`;
    }

    // --- 6. Label → "label:Text" ---
    if (tag === "label") {
      const text = getVisibleText(el);
      if (text) return `label:${text}`;
    }

    // --- 7. Element with aria-label → "label:Text" ---
    const ariaLabel = cleanText(el.getAttribute("aria-label"));
    if (ariaLabel) return `label:${ariaLabel}`;

    // --- 8. Element with visible text → "text:Content" ---
    const directText = getDirectText(el);
    if (directText) return `text:${directText}`;

    // --- 9. Specific attributes → "tag[attr]:Value" ---
    const usefulAttrs = ["data-testid", "data-test", "data-cy", "name", "title", "aria-describedby"];
    for (const attr of usefulAttrs) {
      const val = cleanText(el.getAttribute(attr));
      if (val) return `${tag}[${attr}]:${val}`;
    }

    // --- 10. Fallback → CSS selector ---
    return generateCssSelector(el);
  }

  // ============================================
  // 1b. CSS SELECTOR GENERATION
  // ============================================

  /**
   * Generate a unique CSS selector for a given element.
   * Walks up the DOM tree to build a path that uniquely identifies the element.
   * @param {HTMLElement} el
   * @returns {string}
   */
  function generateCssSelector(el) {
    if (!(el instanceof HTMLElement)) return "";

    // If element has a unique id, use it directly
    if (el.id) return `#${CSS.escape(el.id)}`;

    const parts = [];
    let current = el;

    while (current && current !== document.documentElement && current !== document.body) {
      let selector = current.tagName.toLowerCase();

      // If this element has an id, use it and stop (unique anchor)
      if (current.id) {
        selector = `#${CSS.escape(current.id)}`;
        parts.unshift(selector);
        break;
      }

      // Add meaningful classes (skip utility/dynamic classes)
      const classes = Array.from(current.classList || [])
        .filter(c => !c.startsWith("pw-") && c.length < 40)
        .slice(0, 2)
        .map(c => `.${CSS.escape(c)}`)
        .join("");

      if (classes) {
        selector += classes;
      }

      // Check if selector is unique among siblings, if not add :nth-child
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children);
        const sameTagSiblings = siblings.filter(s => {
          if (s.tagName !== current.tagName) return false;
          if (classes) {
            // Check if classes also match
            const sClasses = Array.from(s.classList || [])
              .filter(c => !c.startsWith("pw-") && c.length < 40)
              .slice(0, 2)
              .map(c => `.${CSS.escape(c)}`)
              .join("");
            return sClasses === classes;
          }
          return true;
        });
        if (sameTagSiblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += `:nth-child(${index})`;
        }
      }

      parts.unshift(selector);
      current = current.parentElement;

      // Stop if we've built enough specificity (max 4 levels)
      if (parts.length >= 4) break;
    }

    return parts.join(" > ");
  }

  // ============================================
  // 1c. GRID SELECTOR GENERATION (for table.gridX)
  // ============================================

  /**
   * Generate a Grid selector for elements inside table.gridX.
   * Extracts: table id, column (cot), row (hang), input name (ten).
   * @param {HTMLElement} el
   * @returns {string|null} Grid selector string, or null if not in gridX
   */
  function generateGridSelector(el) {
    // Check if element is inside a table.gridX
    const table = el.closest("table.gridX");
    if (!table) return null;

    // Find parent <td> with cot attribute
    const td = el.closest("td[cot]");
    if (!td) return null;

    const cot = td.getAttribute("cot");

    // Find parent <tr> with hang attribute
    const tr = el.closest("tr[hang]");
    const hang = tr ? tr.getAttribute("hang") : null;

    // Get table id
    const tableId = table.id || "";

    // Return grid info object
    return { tableId, hang, cot };
  }

  /**
   * Get a short Grid label for tooltip display.
   * @param {HTMLElement} el
   * @returns {string|null}
   */
  function getGridLabel(el) {
    const table = el.closest("table.gridX");
    if (!table) return null;

    const td = el.closest("td[cot]");
    if (!td) return null;

    const cot = td.getAttribute("cot");
    const tr = el.closest("tr[hang]");
    const hang = tr ? tr.getAttribute("hang") : null;

    return hang ? `${cot} (row ${hang})` : cot;
  }

  // ============================================
  // 1d. ARIA SNAPSHOT GENERATION
  // ============================================

  /**
   * Approximate Playwright's toMatchAriaSnapshot YAML tree.
   * @param {HTMLElement} rootElement
   * @returns {string}
   */
  function computeAriaSnapshot(rootElement) {
    function walk(node, depth) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent.replace(/\s+/g, ' ').trim();
        if (text) {
          return [`${"  ".repeat(depth)}- text "${text}"`];
        }
        return [];
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return [];
      
      const style = window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return [];
      
      let role = node.getAttribute('role');
      if (!role) {
        const tag = node.tagName.toLowerCase();
        const roleMap = {
          'button': 'button', 'a': 'link', 'h1': 'heading', 'h2': 'heading', 'h3': 'heading', 'h4': 'heading', 'h5': 'heading', 'h6': 'heading',
          'ul': 'list', 'ol': 'list', 'li': 'listitem',
          'input': node.type === 'checkbox' ? 'checkbox' : (node.type === 'radio' ? 'radio' : 'textbox'),
          'textarea': 'textbox', 'img': 'img', 'nav': 'navigation', 'main': 'main', 'header': 'banner', 'footer': 'contentinfo',
          'p': 'paragraph', 'select': 'combobox', 'table': 'table', 'tr': 'row', 'td': 'cell', 'th': 'columnheader',
          'thead': 'rowgroup', 'tbody': 'rowgroup', 'tfoot': 'rowgroup',
          'section': 'region', 'aside': 'complementary', 'figure': 'figure', 'dialog': 'dialog',
        };
        role = roleMap[tag];
      }
      
      let name = node.getAttribute('aria-label') || node.getAttribute('title') || node.getAttribute('alt');
      const rolesUsingInnerTextForName = ['button', 'link', 'cell', 'columnheader', 'row', 'heading', 'checkbox', 'radio', 'listitem'];
      if (!name && role && rolesUsingInnerTextForName.includes(role)) {
        let innerText = (node.innerText || "").replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
        if (innerText) {
          name = innerText;
        }
      }
      
      let lineLevelAttr = '';
      let lineStateAttr = '';
      if (role === 'heading') {
        const match = node.tagName.match(/^H(\d)$/i);
        const ariaLevel = node.getAttribute('aria-level');
        if (ariaLevel) lineLevelAttr = ` [level=${ariaLevel}]`;
        else if (match) lineLevelAttr = ` [level=${match[1]}]`;
      }
      if (node.hasAttribute('disabled')) lineStateAttr += ` [disabled=true]`;
      if (node.hasAttribute('checked') || node.checked) lineStateAttr += ` [checked=true]`;
      if (node.hasAttribute('aria-expanded')) lineStateAttr += ` [expanded=${node.getAttribute('aria-expanded')}]`;
      
      let childrenOutput = [];
      const isLeafControl = ['button', 'link', 'img', 'checkbox', 'radio', 'textbox', 'combobox'].includes(role);
      
      let nodeValue = '';
      if (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA') {
        if (node.type !== 'checkbox' && node.type !== 'radio' && node.type !== 'button' && node.type !== 'submit') {
          nodeValue = node.value || "";
        }
      } else if (node.tagName === 'SELECT' && node.selectedIndex >= 0) {
        nodeValue = node.options[node.selectedIndex]?.text || "";
      }
      
      for (const child of node.childNodes) {
        const childRes = walk(child, depth + (role ? 1 : 0));
        if (childRes.length) {
          childrenOutput.push(...childRes);
        }
      }
      
      if (role) {
        if (isLeafControl) {
          childrenOutput = [];
        } else {
          const hasOnlyText = childrenOutput.length > 0 && childrenOutput.every(line => line.trim().startsWith('- text '));
          if (hasOnlyText && name) {
            childrenOutput = [];
          }
        }
        
        let headerLine = `${"  ".repeat(depth)}- ${role}`;
        if (name) {
          headerLine += ` "${name.replace(/"/g, '\\"')}"`;
        }
        headerLine += lineLevelAttr + lineStateAttr;
        
        if (nodeValue) {
          headerLine += `: ${nodeValue.replace(/\n/g, ' ')}`;
          return [headerLine];
        } else if (childrenOutput.length > 0) {
          headerLine += ':';
          return [headerLine, ...childrenOutput];
        } else {
          return [headerLine];
        }
      } else {
        return childrenOutput;
      }
    }
    
    const lines = walk(rootElement, 0);
    return lines.join('\n');
  }

  // ============================================
  // 2. TOOLTIP MANAGEMENT
  // ============================================

  /** Create and inject the tooltip element into the DOM. */
  function createTooltip() {
    if (tooltip) return;
    tooltip = document.createElement("div");
    tooltip.id = "pw-locator-tooltip";
    tooltip.setAttribute("aria-hidden", "true");
    document.documentElement.appendChild(tooltip);
  }

  /** Remove the tooltip from the DOM. */
  function destroyTooltip() {
    if (tooltip) {
      tooltip.remove();
      tooltip = null;
    }
  }

  /**
   * Show the tooltip near the cursor with the given locator text.
   * @param {string} locator
   * @param {number} x - clientX
   * @param {number} y - clientY
   */
  function showTooltip(locator, cssSelector, gridLabel, x, y) {
    if (!tooltip) return;

    // Set content — show Playwright locator, CSS selector, and Grid (if applicable)
    let html =
      `<div class="pw-locator-row"><span class="pw-locator-label">🎭</span><span class="pw-locator-text">${escapeHtml(locator)}</span></div>` +
      `<div class="pw-locator-row pw-css-row"><span class="pw-locator-label">🔍</span><span class="pw-css-text">${escapeHtml(cssSelector)}</span></div>`;
    if (gridLabel) {
      html += `<div class="pw-locator-row pw-css-row"><span class="pw-locator-label">📊</span><span class="pw-grid-text">${escapeHtml(gridLabel)}</span></div>`;
    }
    tooltip.innerHTML = html;
    tooltip.classList.add("pw-visible");
    tooltip.classList.remove("pw-copied");

    // Position: offset from cursor, keep within viewport
    const offsetX = 14;
    const offsetY = 18;
    let left = x + offsetX;
    let top = y + offsetY;

    // Measure tooltip dimensions
    const rect = tooltip.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Adjust if overflowing right
    if (left + rect.width > vw - 8) {
      left = x - rect.width - offsetX;
    }
    // Adjust if overflowing bottom
    if (top + rect.height > vh - 8) {
      top = y - rect.height - offsetY;
    }
    // Clamp to viewport
    left = Math.max(4, left);
    top = Math.max(4, top);

    tooltip.style.left = left + "px";
    tooltip.style.top = top + "px";
  }

  /** Hide the tooltip. */
  function hideTooltip() {
    if (tooltip) {
      tooltip.classList.remove("pw-visible", "pw-copied");
    }
  }

  /**
   * Show "Copied!" feedback in the tooltip.
   * @param {number} x
   * @param {number} y
   */
  function showCopiedFeedback(x, y) {
    if (!tooltip) return;
    tooltip.innerHTML = `✓ Copied!`;
    tooltip.classList.add("pw-visible", "pw-copied");

    // Position near click
    const offsetX = 14;
    const offsetY = 18;
    tooltip.style.left = (x + offsetX) + "px";
    tooltip.style.top = (y + offsetY) + "px";

    // Auto-hide after 1.2s
    clearTimeout(copiedTimeout);
    copiedTimeout = setTimeout(() => {
      tooltip.classList.remove("pw-copied");
    }, 1200);
  }

  /**
   * Escape HTML to prevent XSS when displaying locator text.
   * @param {string} str
   * @returns {string}
   */
  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ============================================
  // 3. HIGHLIGHT MANAGEMENT
  // ============================================

  /** Remove highlight from the current target. */
  function clearHighlight() {
    if (currentTarget) {
      currentTarget.classList.remove("pw-locator-highlight");
      currentTarget = null;
    }
  }

  /**
   * Apply highlight to an element.
   * @param {HTMLElement} el
   */
  function setHighlight(el) {
    if (el === currentTarget) return;
    clearHighlight();
    // Don't highlight our own tooltip
    if (el === tooltip || (tooltip && tooltip.contains(el))) return;
    el.classList.add("pw-locator-highlight");
    currentTarget = el;
  }

  // ============================================
  // 4. EVENT HANDLERS
  // ============================================

  /**
   * Handle mouse movement: highlight element + show tooltip with locator.
   * @param {MouseEvent} e
   */
  function onMouseMove(e) {
    // Don't update hover while modal is open
    if (modal) return;

    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === tooltip || (tooltip && tooltip.contains(el))) return;
    // Skip our own injected elements
    if (el.id === "pw-locator-tooltip" || el.id === "pw-locator-esc-banner" || (escBanner && escBanner.contains(el))) return;

    setHighlight(el);
    const locator = generateLocator(el);
    const cssSelector = generateCssSelector(el);
    const gridLabel = getGridLabel(el);
    showTooltip(locator, cssSelector, gridLabel, e.clientX, e.clientY);
  }

  /**
   * Handle mousedown: block native element behavior (e.g. onmousedown handlers).
   * Runs in capture phase BEFORE the element's own mousedown fires.
   * @param {MouseEvent} e
   */
  function onMouseDown(e) {
    // Let modal handle its own clicks
    if (modal) return;

    // Don't block our own elements
    const el = e.target;
    if (el === tooltip || (tooltip && tooltip.contains(el))) return;
    if (el === escBanner || (escBanner && escBanner.contains(el))) return;
    if (el.id === "pw-locator-tooltip" || el.id === "pw-locator-esc-banner") return;

    // Block native mousedown behavior (focus, onmousedown handlers, etc.)
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }


  /**
   * Handle click: show modal with locator options.
   * @param {MouseEvent} e
   */
  function onClick(e) {
    // If modal is open, let modal handle its own clicks
    if (modal) return;

    // Prevent default navigation/action
    e.preventDefault();
    e.stopPropagation();

    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === tooltip || (tooltip && tooltip.contains(el))) return;
    // Click on ESC banner → deactivate inspector
    if (el.id === "pw-locator-esc-banner" || (escBanner && escBanner.contains(el))) {
      deactivate();
      return;
    }

    const locator = generateLocator(el);
    const cssSelector = generateCssSelector(el);
    const gridSelector = generateGridSelector(el);
    const ariaSnapshot = computeAriaSnapshot(el);

    // Show modal with all options
    showCopyModal(locator, cssSelector, gridSelector, ariaSnapshot);
  }

  // ============================================
  // 4b. COPY MODAL
  // ============================================

  /**
   * Show modal with locator strings and copy buttons.
   * @param {string} locator
   * @param {string} cssSelector
   * @param {string|null} gridSelector
   * @param {string} ariaSnapshot
   */
  function showCopyModal(locator, cssSelector, gridSelector, ariaSnapshot) {
    if (modal) destroyCopyModal();

    // Pause hover/highlight while modal is open
    hideTooltip();
    clearHighlight();

    // Create overlay
    modal = document.createElement("div");
    modal.id = "pw-locator-modal-overlay";

    // Build rows
    let rowsHtml = `
      <div class="pw-modal-row">
        <span class="pw-modal-label">🎭 Playwright</span>
        <code class="pw-modal-code pw-playwright-code">${escapeHtml(locator)}</code>
        <button class="pw-modal-copy-btn" data-value="${escapeAttr(locator)}">📋 Copy</button>
      </div>
      <div class="pw-modal-row">
        <span class="pw-modal-label">🧩 Aria Snap</span>
        <code class="pw-modal-code pw-aria-code">${escapeHtml(ariaSnapshot)}</code>
        <button class="pw-modal-copy-btn" data-value="${escapeAttr(ariaSnapshot)}">📋 Copy</button>
      </div>
      <div class="pw-modal-row">
        <span class="pw-modal-label">🔍 CSS</span>
        <code class="pw-modal-code pw-css-code">${escapeHtml(cssSelector)}</code>
        <button class="pw-modal-copy-btn" data-value="${escapeAttr(cssSelector)}">📋 Copy</button>
      </div>
    `;
    if (gridSelector) {
      const hangCot = gridSelector.hang ? `hang=${gridSelector.hang}, cot=${gridSelector.cot}` : `cot=${gridSelector.cot}`;
      rowsHtml += `
      <div class="pw-modal-divider"></div>
      <div class="pw-modal-section-title">📊 Grid Info</div>
      <div class="pw-modal-grid-row">
        <span class="pw-modal-grid-label">Table ID</span>
        <input type="text" class="pw-modal-grid-input" value="#${escapeAttr(gridSelector.tableId)}" readonly />
        <button class="pw-modal-copy-btn" data-value="#${escapeAttr(gridSelector.tableId)}">📋 Copy</button>
      </div>
      <div class="pw-modal-grid-row">
        <span class="pw-modal-grid-label">Row / Col</span>
        <input type="text" class="pw-modal-grid-input" value="${escapeAttr(hangCot)}" readonly />
        <button class="pw-modal-copy-btn" data-value="${escapeAttr(hangCot)}">📋 Copy</button>
      </div>
      <div class="pw-modal-grid-row">
        <span class="pw-modal-grid-label">ColumnID</span>
        <input type="text" class="pw-modal-grid-input pw-grid-code" value="${escapeAttr(gridSelector.cot)}" readonly />
        <button class="pw-modal-copy-btn" data-value="${escapeAttr(gridSelector.cot)}">📋 Copy</button>
      </div>
      `;
    }

    // Modal content
    const box = document.createElement("div");
    box.className = "pw-modal-box";
    box.innerHTML = `
      <div class="pw-modal-header">
        <span class="pw-modal-title">🎯 Copy Locator</span>
        <button class="pw-modal-close" title="Close">&times;</button>
      </div>
      ${rowsHtml}
    `;

    modal.appendChild(box);
    document.documentElement.appendChild(modal);

    // Fade in
    requestAnimationFrame(() => modal.classList.add("pw-visible"));

    // --- Event handlers ---

    // Close button
    box.querySelector(".pw-modal-close").addEventListener("click", (e) => {
      e.stopPropagation();
      destroyCopyModal();
    });

    // Click overlay (outside box) → close
    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        e.stopPropagation();
        destroyCopyModal();
      }
    });

    // Copy buttons — each button stores its own value in data-value
    box.querySelectorAll(".pw-modal-copy-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const text = btn.getAttribute("data-value");
        copyToClipboard(text).then(() => {
          btn.textContent = "✓ Copied!";
          btn.classList.add("pw-copied");
          setTimeout(() => {
            btn.textContent = "📋 Copy";
            btn.classList.remove("pw-copied");
          }, 1500);
        });
      });
    });
  }

  /**
   * Escape a string for use in HTML attribute (data-value).
   * @param {string} str
   * @returns {string}
   */
  function escapeAttr(str) {
    return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  /** Destroy the copy modal. */
  function destroyCopyModal() {
    if (modal) {
      modal.remove();
      modal = null;
    }
  }

  /**
   * Copy text to clipboard with fallback.
   * @param {string} text
   * @returns {Promise}
   */
  function copyToClipboard(text) {
    // Clipboard API is only available on HTTPS pages
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    }
    // Fallback for HTTP pages
    fallbackCopy(text);
    return Promise.resolve();
  }

  /** Fallback copy using execCommand. */
  function fallbackCopy(text) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }

  /**
   * Handle keydown: ESC to deactivate, Alt+L to toggle.
   * @param {KeyboardEvent} e
   */
  function onKeyDown(e) {
    // ESC → close modal first, or deactivate
    if (e.key === "Escape") {
      if (modal) {
        destroyCopyModal();
      } else {
        deactivate();
      }
      return;
    }
    // Alt+L → toggle
    if (e.altKey && (e.key === "l" || e.key === "L")) {
      e.preventDefault();
      toggle();
    }
  }

  // ============================================
  // 5. ACTIVATION / DEACTIVATION
  // ============================================

  /** Create and show the ESC info banner. */
  function createEscBanner() {
    if (escBanner) return;
    escBanner = document.createElement("div");
    escBanner.id = "pw-locator-esc-banner";
    escBanner.innerHTML = `<span class="pw-esc-icon">🎯</span> Playwright Inspector <span class="pw-esc-key">ESC</span> to exit`;
    escBanner.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      deactivate();
    });
    document.documentElement.appendChild(escBanner);
    // Trigger fade-in
    requestAnimationFrame(() => escBanner.classList.add("pw-visible"));
  }

  /** Remove the ESC info banner. */
  function destroyEscBanner() {
    if (escBanner) {
      escBanner.remove();
      escBanner = null;
    }
  }

  /** Activate the inspector. */
  function activate() {
    if (isActive) return;
    isActive = true;
    createTooltip();
    createEscBanner();
    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);
    // Change cursor to crosshair to indicate inspect mode
    document.documentElement.style.cursor = "crosshair";
  }

  /** Deactivate the inspector. */
  function deactivate() {
    if (!isActive) return;
    isActive = false;
    document.removeEventListener("mousedown", onMouseDown, true);
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKeyDown, true);
    clearHighlight();
    hideTooltip();
    destroyTooltip();
    destroyCopyModal();
    destroyEscBanner();
    document.documentElement.style.cursor = "";
    clearTimeout(copiedTimeout);
  }

  /** Toggle the inspector on/off. */
  function toggle() {
    if (isActive) {
      deactivate();
    } else {
      activate();
    }
  }

  // ============================================
  // 6. INITIALIZATION
  // ============================================

  // Listen for messages from background script
  if (chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg.action === "ping") {
        // Respond to ping so background knows content script is loaded
        sendResponse({ status: "ready" });
        return;
      }
      if (msg.action === "toggle-inspector") {
        toggle();
      }
    });
  }

  // Also handle Alt+L directly in content script (keydown)
  document.addEventListener("keydown", (e) => {
    if (e.altKey && (e.key === "l" || e.key === "L")) {
      e.preventDefault();
      toggle();
    }
  });

  // Auto-activate on load for convenience (user can ESC to turn off)
  // Uncomment below if you want auto-activate:
  // activate();

})();
