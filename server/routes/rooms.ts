// ============================================================================
// REAL-TIME CO-READING & "MANGA TOGETHER" ROOMS ROUTER
// Manages synchronized multi-user reading lobbies, real-time scroll sync,
// live laser pointers, and emoji reactions via Server-Sent Events (SSE).
// ============================================================================

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { resolveRequestUserId } from '../appState';
import { logger } from '../logger';

export interface RoomParticipant {
  id: string;
  name: string;
  avatar?: string;
  isHost: boolean;
  lastActive: number;
}

export interface CoReadingRoom {
  id: string; // 6-character code
  name: string;
  hostId: string;
  hostName: string;
  mangaId: string;
  mangaTitle: string;
  chapterNumber: number;
  pageIndex: number;
  scrollPercent: number;
  participants: Map<string, RoomParticipant>;
  clients: Set<Response>;
  createdAt: string;
}

export const roomsRouter = Router();
const rooms = new Map<string, CoReadingRoom>();

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export function broadcastToRoom(room: CoReadingRoom, event: Record<string, any>): void {
  const payload = `data: ${JSON.stringify({ ...event, timestamp: new Date().toISOString() })}\n\n`;
  for (const res of room.clients) {
    try {
      res.write(payload);
    } catch {
      room.clients.delete(res);
    }
  }
}

// ── GET /api/rooms - List Active Rooms ─────────────────────────────────────────
roomsRouter.get('/api/rooms', (_req: Request, res: Response) => {
  const list = Array.from(rooms.values()).map((r) => ({
    id: r.id,
    name: r.name,
    hostId: r.hostId,
    hostName: r.hostName,
    mangaId: r.mangaId,
    mangaTitle: r.mangaTitle,
    chapterNumber: r.chapterNumber,
    participantCount: r.participants.size,
    createdAt: r.createdAt,
  }));
  res.json(list);
});

// ── POST /api/rooms - Create a New Reading Room ────────────────────────────────
roomsRouter.post('/api/rooms', (req: Request, res: Response) => {
  const { name, mangaId, mangaTitle, chapterNumber, hostName, avatar, userId: explicitUserId } = req.body || {};
  if (!mangaId) {
    return res.status(400).json({ error: 'mangaId is required' });
  }

  const userId = explicitUserId || resolveRequestUserId(req) || `usr_host_${crypto.randomBytes(3).toString('hex')}`;
  const effectiveHostName = String(hostName || 'Host Reader').trim();
  const roomId = generateRoomCode();

  const newRoom: CoReadingRoom = {
    id: roomId,
    name: String(name || `${effectiveHostName}'s Reading Room`).trim(),
    hostId: userId,
    hostName: effectiveHostName,
    mangaId: String(mangaId),
    mangaTitle: String(mangaTitle || 'Manga Series'),
    chapterNumber: Number(chapterNumber) || 1,
    pageIndex: 0,
    scrollPercent: 0,
    participants: new Map(),
    clients: new Set(),
    createdAt: new Date().toISOString(),
  };

  newRoom.participants.set(userId, {
    id: userId,
    name: effectiveHostName,
    avatar: avatar || '👤',
    isHost: true,
    lastActive: Date.now(),
  });

  rooms.set(roomId, newRoom);
  logger.info('Rooms', `Created Manga Together room ${roomId} for "${newRoom.mangaTitle}" by ${effectiveHostName}`);

  res.status(201).json({
    id: newRoom.id,
    name: newRoom.name,
    hostId: newRoom.hostId,
    hostName: newRoom.hostName,
    mangaId: newRoom.mangaId,
    mangaTitle: newRoom.mangaTitle,
    chapterNumber: newRoom.chapterNumber,
    participants: Array.from(newRoom.participants.values()),
  });
});

// ── GET /api/rooms/:id - Get Room Details ──────────────────────────────────────
roomsRouter.get('/api/rooms/:id', (req: Request, res: Response) => {
  const roomId = String(req.params.id || '').toUpperCase();
  const room = rooms.get(roomId);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  res.json({
    id: room.id,
    name: room.name,
    hostId: room.hostId,
    hostName: room.hostName,
    mangaId: room.mangaId,
    mangaTitle: room.mangaTitle,
    chapterNumber: room.chapterNumber,
    pageIndex: room.pageIndex,
    scrollPercent: room.scrollPercent,
    participants: Array.from(room.participants.values()),
    createdAt: room.createdAt,
  });
});

// ── POST /api/rooms/:id/join - Join Room ───────────────────────────────────────
roomsRouter.post('/api/rooms/:id/join', (req: Request, res: Response) => {
  const roomId = String(req.params.id || '').toUpperCase();
  const room = rooms.get(roomId);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  const { userName, avatar, userId: explicitUserId } = req.body || {};
  const effectiveUserId =
    explicitUserId ||
    (resolveRequestUserId(req) && resolveRequestUserId(req) !== room.hostId
      ? resolveRequestUserId(req)!
      : `usr_guest_${crypto.randomBytes(3).toString('hex')}`);
  const effectiveName = String(userName || 'Reader').trim();

  const participant: RoomParticipant = {
    id: effectiveUserId,
    name: effectiveName,
    avatar: avatar || '👤',
    isHost: effectiveUserId === room.hostId,
    lastActive: Date.now(),
  };

  room.participants.set(effectiveUserId, participant);

  broadcastToRoom(room, {
    type: 'participant_joined',
    participant,
    participants: Array.from(room.participants.values()),
  });

  res.json({
    success: true,
    room: {
      id: room.id,
      name: room.name,
      hostId: room.hostId,
      hostName: room.hostName,
      mangaId: room.mangaId,
      mangaTitle: room.mangaTitle,
      chapterNumber: room.chapterNumber,
      pageIndex: room.pageIndex,
      scrollPercent: room.scrollPercent,
      participants: Array.from(room.participants.values()),
    },
    user: participant,
  });
});

// ── GET /api/rooms/:id/events - SSE Stream for Live Sync ──────────────────────
roomsRouter.get('/api/rooms/:id/events', (req: Request, res: Response) => {
  const roomId = String(req.params.id || '').toUpperCase();
  const room = rooms.get(roomId);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  room.clients.add(res);

  res.write(
    `data: ${JSON.stringify({
      type: 'room_state',
      mangaId: room.mangaId,
      chapterNumber: room.chapterNumber,
      pageIndex: room.pageIndex,
      scrollPercent: room.scrollPercent,
      participants: Array.from(room.participants.values()),
      timestamp: new Date().toISOString(),
    })}\n\n`
  );

  const heartbeat = setInterval(() => {
    try {
      res.write(': keepalive\n\n');
    } catch {
      clearInterval(heartbeat);
      room.clients.delete(res);
    }
  }, 20000);

  req.on('close', () => {
    clearInterval(heartbeat);
    room.clients.delete(res);
  });
});

// ── POST /api/rooms/:id/sync - Broadcast Synchronized Action ──────────────────
roomsRouter.post('/api/rooms/:id/sync', (req: Request, res: Response) => {
  const roomId = String(req.params.id || '').toUpperCase();
  const room = rooms.get(roomId);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  const { action, chapterNumber, pageIndex, scrollPercent, pointer, reaction, userId, userName } = req.body || {};

  if (action === 'scroll' || action === 'page' || action === 'chapter') {
    if (chapterNumber !== undefined) room.chapterNumber = Number(chapterNumber);
    if (pageIndex !== undefined) room.pageIndex = Number(pageIndex);
    if (scrollPercent !== undefined) room.scrollPercent = Number(scrollPercent);

    broadcastToRoom(room, {
      type: 'sync_navigation',
      action,
      chapterNumber: room.chapterNumber,
      pageIndex: room.pageIndex,
      scrollPercent: room.scrollPercent,
      actorId: userId,
      actorName: userName,
    });
  } else if (action === 'laser_pointer') {
    broadcastToRoom(room, {
      type: 'laser_pointer',
      pointer, // { x: percent, y: percent }
      actorId: userId,
      actorName: userName,
    });
  } else if (action === 'reaction') {
    broadcastToRoom(room, {
      type: 'reaction',
      reaction, // emoji string, e.g. "🔥" | "😮" | "❤️"
      actorId: userId,
      actorName: userName,
    });
  }

  res.json({ success: true });
});

// Periodic cleanup of idle rooms (inactive for > 2 hours)
setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (room.clients.size === 0 && now - new Date(room.createdAt).getTime() > 2 * 60 * 60 * 1000) {
      rooms.delete(id);
    }
  }
}, 10 * 60 * 1000);
