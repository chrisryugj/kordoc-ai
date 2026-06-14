type Handler = (...args: unknown[]) => void;

export class EventBus {
  private handlers = new Map<string, Set<Handler>>();

  on(event: string, handler: Handler): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
    return () => {
      this.handlers.get(event)?.delete(handler);
    };
  }

  emit(event: string, ...args: unknown[]): void {
    this.handlers.get(event)?.forEach((h) => h(...args));
  }

  removeAll(): void {
    this.handlers.clear();
  }
}
