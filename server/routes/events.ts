import express, { Request, Response } from 'express';
import { eventBus, AppEventPayload } from '../services/eventBus';
import { verifyAuthToken, AUTH_ENABLED } from '../security';

export const eventsRouter = express.Router();

interface EventClientRecord {
  res: Response;
  heartbeatInterval: NodeJS.Timeout;
  unsubscribe: () => void;
}
export const activeEventsClients = new Set<EventClientRecord>();

export function closeAllEventsSseClients(message = 'Server is shutting down'): void {
  for (const client of Array.from(activeEventsClients)) {
    try {
      clearInterval(client.heartbeatInterval);
      client.unsubscribe();
      client.res.write(`event: shutdown\n`);
      client.res.write(`data: ${JSON.stringify({ type: 'shutdown', message, timestamp: Date.now() })}\n\n`);
      client.res.end();
    } catch {
      // client already closed
    }
  }
  activeEventsClients.clear();
}

/**
 * SSE endpoint for live multi-device event streaming
 * GET /api/events
 */
eventsRouter.get('/', (req: Request, res: Response) => {
  // Support token via query param (since EventSource in browsers doesn't support custom headers directly)
  const token = (req.query.token as string) || req.headers.authorization?.replace(/^Bearer\s+/i, '');
  let authenticatedUserId: string | undefined;

  if (AUTH_ENABLED && token) {
    try {
      const decoded = verifyAuthToken(token);
      if (decoded && (decoded as any).sub) {
        authenticatedUserId = String((decoded as any).sub);
      }
    } catch {
      // Ignored for optional auth or token parse failure
    }
  }

  // Set SSE Headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': '*',
  });

  // Send initial handshake
  res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`);

  // Subscribe to EventBus
  const unsubscribe = eventBus.subscribe((event: AppEventPayload) => {
    // If event is scoped to a specific user and requester is authenticated, verify matching user
    if (event.userId && authenticatedUserId && event.userId !== authenticatedUserId) {
      return;
    }

    try {
      res.write(`event: ${event.type}\n`);
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch (err) {
      console.warn('[EventsRouter] Error writing SSE message to client:', err);
    }
  });

  // Keep-alive heartbeat every 25 seconds to prevent proxy dropouts
  const heartbeatInterval = setInterval(() => {
    try {
      res.write(`: heartbeat\n\n`);
    } catch {
      clearInterval(heartbeatInterval);
      activeEventsClients.delete(clientRecord);
    }
  }, 25000);

  const clientRecord: EventClientRecord = { res, heartbeatInterval, unsubscribe };
  activeEventsClients.add(clientRecord);

  // Clean up on disconnect
  req.on('close', () => {
    clearInterval(heartbeatInterval);
    unsubscribe();
    activeEventsClients.delete(clientRecord);
    res.end();
  });
});
