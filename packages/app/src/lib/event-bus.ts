/**
 * EventBus — type-safe event emitter for cross-module communication
 */

type EventMap = {
  "book:opened": { bookId: string };
  "book:closed": { bookId: string };
  "book:imported": { bookId: string; filePath: string };
  "book:deleted": { bookId: string };
  "annotation:added": {
    bookId: string;
    annotationId: string;
    type: "highlight" | "note" | "bookmark";
  };
  "annotation:removed": { id: string; type: "highlight" | "note" | "bookmark" };
  "reading:progress": { bookId: string; progress: number; cfi?: string };
  "reading:session-start": { bookId: string; sessionId: string };
  "reading:session-end": { sessionId: string };
  "sync:started": Record<string, never>;
  "sync:completed": { timestamp: number };
  "sync:error": { error: Error };
  "vectorize:started": { bookId: string };
  "vectorize:progress": { bookId: string; progress: number; status: string };
  "vectorize:completed": { bookId: string; chunksCount: number };
  "vectorize:error": { bookId: string; error: string };
};

type EventCallback<K extends keyof EventMap> = (data: EventMap[K]) => void;

class EventBusImpl {
  private listeners = new Map<string, Set<EventCallback<keyof EventMap>>>();

  /** Subscribe to an event */
  on<K extends keyof EventMap>(event: K, callback: EventCallback<K>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback as EventCallback<keyof EventMap>);

    // Return unsubscribe function
    return () => {
      this.listeners.get(event)?.delete(callback as EventCallback<keyof EventMap>);
    };
  }

  /** Subscribe to an event, auto-unsubscribe after first invocation */
  once<K extends keyof EventMap>(event: K, callback: EventCallback<K>): () => void {
    const wrapper: EventCallback<K> = (data) => {
      callback(data);
      this.off(event, wrapper);
    };
    return this.on(event, wrapper);
  }

  /** Unsubscribe from an event */
  off<K extends keyof EventMap>(event: K, callback: EventCallback<K>): void {
    this.listeners.get(event)?.delete(callback as EventCallback<keyof EventMap>);
  }

  /** Emit an event */
  emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
    this.listeners.get(event)?.forEach((cb) => {
      try {
        cb(data);
      } catch (err) {
        console.error(`EventBus error in handler for '${event}':`, err);
      }
    });
  }

  /** Remove all listeners for an event (or all events) */
  clear(event?: keyof EventMap): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }
}

/** Singleton event bus instance */
export const eventBus = new EventBusImpl();

/** Type-safe EventMap export for consumers */
export type { EventMap };
