export interface DialogDragOptions {
  ignoreSelector?: string;
}

export function enableDialogDrag(
  dialog: HTMLElement,
  titleEl: HTMLElement,
  options: DialogDragOptions = {},
): () => void {
  const ignoreSelector = options.ignoreSelector ?? '.dialog-close';
  let offsetX = 0;
  let offsetY = 0;
  let dragging = false;

  const stopDrag = () => {
    dragging = false;
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', stopDrag);
  };

  const move = (e: MouseEvent) => {
    if (!dragging) return;
    dialog.style.left = `${e.clientX - offsetX}px`;
    dialog.style.top = `${e.clientY - offsetY}px`;
  };

  const startDrag = (e: MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest(ignoreSelector)) return;

    const rect = dialog.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;

    dialog.style.position = 'fixed';
    dialog.style.left = `${rect.left}px`;
    dialog.style.top = `${rect.top}px`;
    dialog.style.margin = '0';
    dialog.style.transform = 'none';

    dragging = true;
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', stopDrag);
    e.preventDefault();
  };

  titleEl.addEventListener('mousedown', startDrag);

  return () => {
    titleEl.removeEventListener('mousedown', startDrag);
    stopDrag();
  };
}
