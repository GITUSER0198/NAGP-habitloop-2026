import { h } from '@stencil/core';

export function Action(props: { label: string; busy?: boolean; disabled?: boolean; secondary?: boolean; onClick: () => void }) {
  return <button type="button" class={props.secondary ? 'secondary' : ''}
    disabled={props.disabled || props.busy} aria-busy={props.busy ? 'true' : 'false'}
    onClick={() => { if (!props.busy && !props.disabled) props.onClick(); }}>
    {props.busy && <span class="spinner" aria-hidden="true" />}
    {props.busy ? `${props.label} (working)` : props.label}
  </button>;
}

function disclosureKey(host: HTMLElement): string | null {
  return host.id ? `habitloop:details:${host.id}` : null;
}

export function Details(props: { host: HTMLElement; summary: string }, children: unknown[]) {
  let open = false;
  const key = disclosureKey(props.host);
  try { open = key !== null && window.localStorage.getItem(key) === 'true'; } catch { /* Storage is optional. */ }
  return <details open={open} onToggle={(event: Event) => {
    try { if (key) window.localStorage.setItem(key, String((event.currentTarget as HTMLDetailsElement).open)); }
    catch { /* Storage is optional. */ }
  }}><summary>{props.summary}</summary>{children}</details>;
}
