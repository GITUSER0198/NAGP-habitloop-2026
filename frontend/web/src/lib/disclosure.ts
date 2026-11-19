export function rememberOpen(node: HTMLDetailsElement, key: string): { destroy: () => void } {
  try { node.open = localStorage.getItem(`habitloop:open:${key}`) === 'true'; } catch { /* Keep the default. */ }
  const save = (): void => { try { localStorage.setItem(`habitloop:open:${key}`, String(node.open)); } catch { /* Keep the in-memory state. */ } };
  node.addEventListener('toggle', save);
  return { destroy: () => node.removeEventListener('toggle', save) };
}
