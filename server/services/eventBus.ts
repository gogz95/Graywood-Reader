import { EventEmitter } from 'events';

export type AppEventType =
  | 'chapter_read'
  | 'progress_updated'
  | 'library_updated'
  | 'download_progress'
  | 'source_health'
  | 'auto_update';

export interface AppEventPayload<T = unknown> {
  type: AppEventType;
  userId?: string;
  timestamp: number;
  data: T;
}

class EventBusService extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(200);
  }

  public publish<T = unknown>(type: AppEventType, data: T, userId?: string): void {
    const eventPayload: AppEventPayload<T> = {
      type,
      userId,
      timestamp: Date.now(),
      data,
    };
    this.emit('app_event', eventPayload);
    this.emit(type, eventPayload);
  }

  public subscribe(handler: (event: AppEventPayload) => void): () => void {
    this.on('app_event', handler);
    return () => this.off('app_event', handler);
  }

  public subscribeType<T = unknown>(type: AppEventType, handler: (event: AppEventPayload<T>) => void): () => void {
    this.on(type, handler as (event: AppEventPayload) => void);
    return () => this.off(type, handler as (event: AppEventPayload) => void);
  }
}

export const eventBus = new EventBusService();
