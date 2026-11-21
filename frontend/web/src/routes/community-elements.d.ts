import type { HTMLAttributes } from 'svelte/elements';

declare module 'svelte/elements' {
  export interface SvelteHTMLElements {
    'hl-challenge-card': HTMLAttributes<HTMLElement> & {
      title?: string; visibility?: string; participants?: number; progress?: number; target?: number; joined?: boolean; invited?: boolean; busy?: boolean;
      onhlJoin?: () => void; onhlAccept?: () => void; onhlDecline?: () => void;
    };
    'hl-leaderboard': HTMLAttributes<HTMLElement> & { rows?: string };
    'hl-partner-tile': HTMLAttributes<HTMLElement> & {
      provider?: string; linked?: boolean; busy?: boolean; 'last-event-at'?: string; 'rejected-count'?: number;
      onhlConnect?: () => void; onhlDisconnect?: () => void;
    };
    'hl-recommendation-card': HTMLAttributes<HTMLElement> & {
      kind?: string; current?: string; suggested?: string; reason?: string; confidence?: number; status?: string;
      busy?: boolean; onhlAccept?: () => void; onhlDismiss?: () => void;
    };
  }
}
