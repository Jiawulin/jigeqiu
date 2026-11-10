type PageKey = Pick<KeyboardEvent, 'key' | 'defaultPrevented' | 'repeat' | 'isComposing' | 'keyCode'
  | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>;

export type DesktopArrow = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';

export function desktopArrowKey(event: PageKey, blocked: boolean): DesktopArrow | null {
  if (blocked || event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229
    || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  switch (event.key) {
    case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown': return event.key;
    default: return null;
  }
}

export function desktopNavigationIndex(
  key: DesktopArrow, focusedIndex: number, page: number, columns: number, pageSize: number, count: number,
): number | null {
  const start = page * pageSize;
  const end = Math.min(count, start + pageSize);
  if (start >= end) return null;
  if (focusedIndex < start || focusedIndex >= end) return start;
  if (key === 'ArrowLeft') return Math.max(0, focusedIndex - 1);
  if (key === 'ArrowRight') return Math.min(count - 1, focusedIndex + 1);
  const next = focusedIndex + (key === 'ArrowDown' ? columns : -columns);
  return next >= start && next < end ? next : focusedIndex;
}
