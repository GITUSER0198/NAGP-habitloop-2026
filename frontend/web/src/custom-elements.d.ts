import type { HTMLAttributes } from 'svelte/elements';

declare module 'svelte/elements' {
  export interface SvelteHTMLElements {
    'hl-chart': HTMLAttributes<HTMLElement> & { type?: string; data?: string };
    'hl-heatmap': HTMLAttributes<HTMLElement> & { data?: string };
    'hl-badge': HTMLAttributes<HTMLElement> & { days?: number; earned?: boolean; 'earned-at'?: string; remaining?: number };
    'hl-activity-summary': HTMLAttributes<HTMLElement> & {
      name?: string; category?: string; 'preferred-time'?: string; status?: string; streak?: number; busy?: boolean;
      onhlLog?: (event: CustomEvent<{ status: import('$lib/types').Status }>) => void;
    };
    'hl-reminder-banner': HTMLAttributes<HTMLElement> & {
      items?: string; busy?: boolean;
      onhlLogNow?: (event: CustomEvent<{ activityId: string }>) => void;
      onhlSnooze?: (event: CustomEvent<{ activityId: string }>) => void;
    };
  }
}
