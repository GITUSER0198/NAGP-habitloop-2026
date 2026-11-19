import type { Activity, TodayItem } from '$lib/types';
import { app } from '$lib/config/app';
import { features } from '$lib/config/features';

export class TodayState {
  items = $state<TodayItem[]>([]);
  activities = $state<Activity[]>([]);
  categories = $state<Record<string, string>>({});
  now = $state(Date.now());
  snoozes = $state<Record<string, number>>({});
  busy = $state<Record<string, boolean>>({});
  errors = $state<Record<string, string>>({});
  remaining = $derived(this.items.filter(item => !item.status).length);
  reminders = $derived(features.reminders ? this.items.filter(item => !item.status
    && Date.parse(item.due_at) <= this.now + app.reminderWindowMinutes * 60000
    && (this.snoozes[item.id] ?? 0) <= this.now).map(item => ({ activityId: item.id, name: item.name, dueAt: item.due_at })) : []);
  reminderBusy = $derived(Object.values(this.busy).some(Boolean));

  restore(key: string): void {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(key) ?? '{}');
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
        this.snoozes = Object.fromEntries(Object.entries(saved).filter(([, until]) => typeof until === 'number' && until > Date.now()));
      }
    } catch { this.snoozes = {}; }
  }

  snooze(id: string, key: string): void {
    this.now = Date.now();
    this.snoozes = { ...Object.fromEntries(Object.entries(this.snoozes).filter(([, until]) => until > this.now)), [id]: this.now + 30 * 60000 };
    try { localStorage.setItem(key, JSON.stringify(this.snoozes)); } catch { /* Storage can be disabled. */ }
  }
}
