/** 문단 모양 대화상자 공유 DOM 헬퍼 */

export function createFieldset(title: string): HTMLFieldSetElement {
  const fs = document.createElement('fieldset');
  fs.className = 'cs-fieldset';
  const legend = document.createElement('legend');
  legend.textContent = title;
  fs.appendChild(legend);
  return fs;
}

export function row(): HTMLDivElement {
  const r = document.createElement('div');
  r.className = 'dialog-row';
  return r;
}

export function label(text: string): HTMLSpanElement {
  const l = document.createElement('span');
  l.className = 'dialog-label';
  l.textContent = text;
  return l;
}

export function numberInput(min?: number, max?: number, step?: number): HTMLInputElement {
  const inp = document.createElement('input');
  inp.type = 'number';
  inp.className = 'dialog-input';
  if (min !== undefined) inp.min = String(min);
  if (max !== undefined) inp.max = String(max);
  if (step !== undefined) inp.step = String(step);
  return inp;
}

export function unit(text: string): HTMLSpanElement {
  const u = document.createElement('span');
  u.className = 'dialog-unit';
  u.textContent = text;
  return u;
}
