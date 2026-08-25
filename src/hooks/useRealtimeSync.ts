import { useEffect, useRef } from 'react';
import { getApiBaseUrl, getAuthToken } from '../utils/api';

export type RealtimeEventType =
  | 'connected'
  | 'chapter_read'
  | 'progress_updated'
  | 'library_updated'
  | 'download_progress'
  | 'source_health'
  | 'auto_update';

export interface RealtimeEventPayload<T = any> {
  type: RealtimeEventType;
  userId?: string;
  timestamp: number | string;
  data?: T;
  [key: string]: any;
}

/**
 * Universal React hook to subscribe to Server-Sent Events (SSE) from /api/events
 * Triggers callback whenever any server event or targeted event occurs.
 */
export function useRealtimeSync(
  eventTypes: RealtimeEventType[] | '*',
  onEvent: (event: RealtimeEventPayload) => void
): void {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    let evtSource: EventSource | null = null;
    let reconnectTimeout: any = null;
    let isMounted = true;

    const connect = () => {
      if (!isMounted) return;
      try {
        const baseUrl = getApiBaseUrl();
        const authToken = getAuthToken();
        const tokenParam = authToken ? `?token=${encodeURIComponent(authToken)}` : '';
        const url = `${baseUrl}/api/events${tokenParam}`;

        evtSource = new EventSource(url);

        const handleIncoming = (event: MessageEvent) => {
          try {
            const parsed = JSON.parse(event.data) as RealtimeEventPayload;
            if (
              eventTypes === '*' ||
              eventTypes.includes(parsed.type) ||
              (event.type && eventTypes.includes(event.type as RealtimeEventType))
            ) {
              handlerRef.current?.(parsed);
            }
          } catch {
            // Non-JSON ping or heartbeat
          }
        };

        evtSource.onmessage = handleIncoming;

        if (Array.isArray(eventTypes)) {
          for (const t of eventTypes) {
            evtSource.addEventListener(t, handleIncoming);
          }
        }

        evtSource.onerror = () => {
          if (evtSource) {
            evtSource.close();
            evtSource = null;
          }
          if (isMounted) {
            reconnectTimeout = setTimeout(connect, 4000);
          }
        };
      } catch (err) {
        if (isMounted) {
          reconnectTimeout = setTimeout(connect, 6000);
        }
      }
    };

    connect();

    return () => {
      isMounted = false;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (evtSource) {
        evtSource.close();
        evtSource = null;
      }
    };
  }, [Array.isArray(eventTypes) ? eventTypes.join(',') : eventTypes]);
}
