import { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch, resolveApiUrl } from '../utils/api';

export interface RoomParticipant {
  id: string;
  name: string;
  avatar?: string;
  isHost: boolean;
}

export interface ActiveRoomState {
  id: string;
  name: string;
  hostId: string;
  hostName: string;
  mangaId: string;
  mangaTitle: string;
  chapterNumber: number;
  pageIndex: number;
  scrollPercent: number;
  participants: RoomParticipant[];
}

export interface LaserPointer {
  id: string;
  x: number;
  y: number;
  actorName: string;
  timestamp: number;
}

export interface FloatingReaction {
  id: string;
  emoji: string;
  actorName: string;
  timestamp: number;
}

export function useMangaTogether(options: {
  mangaId: string;
  currentChapterNumber: number;
  onRemoteNavigate?: (chapterNumber: number, pageIndex: number, scrollPercent: number) => void;
}) {
  const [activeRoom, setActiveRoom] = useState<ActiveRoomState | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [currentUser, setCurrentUser] = useState<RoomParticipant | null>(null);
  const [laserPointers, setLaserPointers] = useState<LaserPointer[]>([]);
  const [floatingReactions, setFloatingReactions] = useState<FloatingReaction[]>([]);
  const [autoFollow, setAutoFollow] = useState(true);

  const eventSourceRef = useRef<EventSource | null>(null);
  const lastSyncTimeRef = useRef(0);

  // Clean up stale laser pointers and reactions after 3-4 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      setLaserPointers((prev) => prev.filter((p) => now - p.timestamp < 3000));
      setFloatingReactions((prev) => prev.filter((r) => now - r.timestamp < 4000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const leaveRoom = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setActiveRoom(null);
    setIsHost(false);
    setCurrentUser(null);
    setLaserPointers([]);
    setFloatingReactions([]);
  }, []);

  const connectToRoomSse = useCallback((roomId: string, user: RoomParticipant) => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const sseUrl = resolveApiUrl(`/api/rooms/${roomId}/events`);
    const es = new EventSource(sseUrl);
    eventSourceRef.current = es;

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'room_state') {
          setActiveRoom((prev) =>
            prev
              ? {
                  ...prev,
                  chapterNumber: data.chapterNumber,
                  pageIndex: data.pageIndex,
                  scrollPercent: data.scrollPercent,
                  participants: data.participants || prev.participants,
                }
              : null
          );
        } else if (data.type === 'participant_joined') {
          setActiveRoom((prev) =>
            prev ? { ...prev, participants: data.participants || prev.participants } : null
          );
        } else if (data.type === 'sync_navigation') {
          // If we are a follower and not the host who initiated the action, follow the host
          if (data.actorId !== user.id && autoFollow) {
            options.onRemoteNavigate?.(data.chapterNumber, data.pageIndex, data.scrollPercent);
          }
        } else if (data.type === 'laser_pointer') {
          if (data.pointer) {
            const newPointer: LaserPointer = {
              id: `ptr_${Date.now()}_${Math.random()}`,
              x: data.pointer.x,
              y: data.pointer.y,
              actorName: data.actorName || 'Reader',
              timestamp: Date.now(),
            };
            setLaserPointers((prev) => [...prev.slice(-4), newPointer]);
          }
        } else if (data.type === 'reaction') {
          if (data.reaction) {
            const newReaction: FloatingReaction = {
              id: `rxn_${Date.now()}_${Math.random()}`,
              emoji: data.reaction,
              actorName: data.actorName || 'Reader',
              timestamp: Date.now(),
            };
            setFloatingReactions((prev) => [...prev.slice(-6), newReaction]);
          }
        }
      } catch (err) {
        console.error('[MangaTogether] SSE parse error:', err);
      }
    };

    es.onerror = () => {
      // Reconnection handled automatically by browser EventSource
    };
  }, [autoFollow, options]);

  const createRoom = useCallback(
    async (mangaTitle: string, hostName: string, avatar?: string) => {
      try {
        const res = await apiFetch('/api/rooms', {
          method: 'POST',
          body: JSON.stringify({
            mangaId: options.mangaId,
            mangaTitle,
            chapterNumber: options.currentChapterNumber,
            hostName,
            avatar,
          }),
        });
        if (res.ok) {
          const roomData = await res.json();
          const hostUser: RoomParticipant = {
            id: roomData.hostId,
            name: roomData.hostName,
            avatar,
            isHost: true,
          };
          setActiveRoom({
            ...roomData,
            pageIndex: 0,
            scrollPercent: 0,
          });
          setIsHost(true);
          setCurrentUser(hostUser);
          connectToRoomSse(roomData.id, hostUser);
          return roomData.id as string;
        }
      } catch (err) {
        console.error('[MangaTogether] Create room error:', err);
      }
      return null;
    },
    [connectToRoomSse, options.currentChapterNumber, options.mangaId]
  );

  const joinRoom = useCallback(
    async (roomId: string, userName: string, avatar?: string) => {
      try {
        const res = await apiFetch(`/api/rooms/${roomId.toUpperCase()}/join`, {
          method: 'POST',
          body: JSON.stringify({ userName, avatar }),
        });
        if (res.ok) {
          const data = await res.json();
          setActiveRoom(data.room);
          setIsHost(Boolean(data.user?.isHost));
          setCurrentUser(data.user);
          connectToRoomSse(data.room.id, data.user);
          return true;
        }
      } catch (err) {
        console.error('[MangaTogether] Join room error:', err);
      }
      return false;
    },
    [connectToRoomSse]
  );

  const broadcastNav = useCallback(
    async (action: 'scroll' | 'page' | 'chapter', chapterNumber: number, pageIndex: number, scrollPercent: number) => {
      if (!activeRoom || !currentUser || !isHost) return;
      const now = Date.now();
      if (action === 'scroll' && now - lastSyncTimeRef.current < 80) return; // throttle scroll events
      lastSyncTimeRef.current = now;

      try {
        await apiFetch(`/api/rooms/${activeRoom.id}/sync`, {
          method: 'POST',
          body: JSON.stringify({
            action,
            chapterNumber,
            pageIndex,
            scrollPercent,
            userId: currentUser.id,
            userName: currentUser.name,
          }),
        });
      } catch (err) {
        console.error('[MangaTogether] Broadcast nav error:', err);
      }
    },
    [activeRoom, currentUser, isHost]
  );

  const sendLaserPointer = useCallback(
    async (xPercent: number, yPercent: number) => {
      if (!activeRoom || !currentUser) return;
      try {
        await apiFetch(`/api/rooms/${activeRoom.id}/sync`, {
          method: 'POST',
          body: JSON.stringify({
            action: 'laser_pointer',
            pointer: { x: xPercent, y: yPercent },
            userId: currentUser.id,
            userName: currentUser.name,
          }),
        });
      } catch (err) {
        console.error('[MangaTogether] Laser pointer error:', err);
      }
    },
    [activeRoom, currentUser]
  );

  const sendReaction = useCallback(
    async (emoji: string) => {
      if (!activeRoom || !currentUser) return;
      try {
        await apiFetch(`/api/rooms/${activeRoom.id}/sync`, {
          method: 'POST',
          body: JSON.stringify({
            action: 'reaction',
            reaction: emoji,
            userId: currentUser.id,
            userName: currentUser.name,
          }),
        });
      } catch (err) {
        console.error('[MangaTogether] Reaction error:', err);
      }
    },
    [activeRoom, currentUser]
  );

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  return {
    activeRoom,
    isHost,
    currentUser,
    laserPointers,
    floatingReactions,
    autoFollow,
    setAutoFollow,
    createRoom,
    joinRoom,
    leaveRoom,
    broadcastNav,
    sendLaserPointer,
    sendReaction,
  };
}
