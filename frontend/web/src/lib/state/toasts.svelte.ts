export class ToastState {
  items = $state<{ id: number; message: string; error: boolean }[]>([]);
  private next = 0;
  private timers = new Map<number, ReturnType<typeof setTimeout>>();

  push(message: string, error = false): void {
    const id = ++this.next;
    this.items = [...this.items.slice(-3), { id, message, error }];
    this.timers.set(id, setTimeout(() => this.dismiss(id), 6000));
  }
  dismiss(id: number): void {
    this.items = this.items.filter(item => item.id !== id);
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
  }
  destroy(): void { for (const timer of this.timers.values()) clearTimeout(timer); this.timers.clear(); }
}
