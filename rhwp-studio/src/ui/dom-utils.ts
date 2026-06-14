const SVG_ROOT = 'svg';

/** SVG XML 문자열을 파싱해 대상 요소에 추가한다. */
export function appendSvgMarkup(parent: Element, svgMarkup: string): void {
  const parsed = new DOMParser().parseFromString(svgMarkup, 'image/svg+xml');
  if (parsed.querySelector('parsererror')) return;

  const root = parsed.documentElement;
  if (root.nodeName.toLowerCase() !== SVG_ROOT) return;

  parent.appendChild(document.importNode(root, true));
}

export function makeOption(value: string, label: string): HTMLOptionElement {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  return option;
}
