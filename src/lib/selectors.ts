// Best-effort stable selector generation and lookup.
//
// We need to relocate an element on restore even though the page may have been
// freshly rendered. No selector is perfect on dynamic apps; we prefer #id, then
// [name], then a structural path, and we keep `name` as a secondary matcher.

/** Build a reasonably stable selector for an element. */
export function selectorFor(el: Element): string {
  if (el.id) return `#${cssEscape(el.id)}`;

  const name = el.getAttribute('name');
  const tag = el.tagName.toLowerCase();
  if (name) return `${tag}[name="${cssEscape(name)}"]`;

  // Structural fallback: path of tag:nth-of-type from a stable ancestor.
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.body) {
    const current: Element = node;
    let part = current.tagName.toLowerCase();
    const parent = current.parentElement;
    if (parent) {
      const sameTag = Array.from(parent.children).filter(
        (c) => c.tagName === current.tagName,
      );
      if (sameTag.length > 1) {
        part += `:nth-of-type(${sameTag.indexOf(current) + 1})`;
      }
    }
    parts.unshift(part);
    if (current.id) {
      parts[0] = `#${cssEscape(current.id)}`;
      break;
    }
    node = parent;
  }
  return parts.join(' > ');
}

/** Find an element from a saved selector, falling back to a name match. */
export function findElement(
  selector: string,
  name?: string,
): Element | null {
  try {
    const bySelector = document.querySelector(selector);
    if (bySelector) return bySelector;
  } catch {
    // Invalid/stale selector — fall through to name match.
  }
  if (name) {
    const byName = document.querySelector(`[name="${cssEscape(name)}"]`);
    if (byName) return byName;
  }
  return null;
}

/** Minimal CSS.escape polyfill for older engines / safety. */
function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/["\\\]\[#.:>~+*^$|()=]/g, '\\$&');
}
