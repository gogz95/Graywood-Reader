import { useState, useRef, useCallback, useEffect } from 'react';

export interface ReaderZoomState {
  scale: number;
  position: { x: number; y: number };
  isZoomed: boolean;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  setZoomLevel: (scale: number) => void;
  handleTouchStart: (e: React.TouchEvent) => void;
  handleTouchMove: (e: React.TouchEvent) => void;
  handleTouchEnd: (e: React.TouchEvent) => void;
  handleWheel: (e: React.WheelEvent) => void;
  handleMouseDown: (e: React.MouseEvent) => void;
  handleMouseMove: (e: React.MouseEvent) => void;
  handleMouseUp: () => void;
  handleDoubleTap: (clientX: number, clientY: number, containerRect?: DOMRect) => void;
  transformStyle: React.CSSProperties;
}

const MIN_SCALE = 1.0;
const MAX_SCALE = 3.5;
const DOUBLE_TAP_SCALE = 2.0;

export function useReaderZoom(enabled = true): ReaderZoomState {
  const [scale, setScale] = useState<number>(1.0);
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Tracking touch / mouse drag state
  const touchStartDistRef = useRef<number | null>(null);
  const initialScaleRef = useRef<number>(1.0);
  const isDraggingRef = useRef<boolean>(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const positionRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const scaleRef = useRef<number>(1.0);

  // Keep refs synced to state
  positionRef.current = position;
  scaleRef.current = scale;

  const resetZoom = useCallback(() => {
    setScale(1.0);
    setPosition({ x: 0, y: 0 });
  }, []);

  const setZoomLevel = useCallback((newScale: number) => {
    const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, newScale));
    setScale(clamped);
    if (clamped === 1.0) {
      setPosition({ x: 0, y: 0 });
    }
  }, []);

  const zoomIn = useCallback(() => {
    setScale((prev) => {
      const next = Math.min(MAX_SCALE, Number((prev + 0.25).toFixed(2)));
      return next;
    });
  }, []);

  const zoomOut = useCallback(() => {
    setScale((prev) => {
      const next = Math.max(MIN_SCALE, Number((prev - 0.25).toFixed(2)));
      if (next === 1.0) setPosition({ x: 0, y: 0 });
      return next;
    });
  }, []);

  const handleDoubleTap = useCallback((clientX: number, clientY: number, containerRect?: DOMRect) => {
    if (!enabled) return;

    if (scaleRef.current > 1.1) {
      // Already zoomed in -> reset to 1x
      resetZoom();
    } else {
      // Zoom in to 2.0x centered around tap point
      const rect = containerRect || { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
      const offsetX = clientX - rect.left - rect.width / 2;
      const offsetY = clientY - rect.top - rect.height / 2;

      setScale(DOUBLE_TAP_SCALE);
      setPosition({
        x: -offsetX * (DOUBLE_TAP_SCALE - 1) * 0.5,
        y: -offsetY * (DOUBLE_TAP_SCALE - 1) * 0.5,
      });
    }
  }, [enabled, resetZoom]);

  // Touch Events (Pinch-to-zoom & pan)
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!enabled) return;
    if (e.touches.length === 2) {
      // Pinch start
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      touchStartDistRef.current = dist;
      initialScaleRef.current = scaleRef.current;
    } else if (e.touches.length === 1 && scaleRef.current > 1.0) {
      // Drag start while zoomed
      isDraggingRef.current = true;
      dragStartRef.current = {
        x: e.touches[0].clientX - positionRef.current.x,
        y: e.touches[0].clientY - positionRef.current.y,
      };
    }
  }, [enabled]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!enabled) return;
    if (e.touches.length === 2 && touchStartDistRef.current !== null) {
      // Pinching
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      const ratio = dist / touchStartDistRef.current;
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, initialScaleRef.current * ratio));
      setScale(newScale);
      if (newScale === 1.0) {
        setPosition({ x: 0, y: 0 });
      }
    } else if (e.touches.length === 1 && isDraggingRef.current && scaleRef.current > 1.0) {
      // Panning while zoomed
      const newX = e.touches[0].clientX - dragStartRef.current.x;
      const newY = e.touches[0].clientY - dragStartRef.current.y;
      setPosition({ x: newX, y: newY });
    }
  }, [enabled]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (e.touches.length < 2) {
      touchStartDistRef.current = null;
    }
    if (e.touches.length === 0) {
      isDraggingRef.current = false;
      if (scaleRef.current <= 1.05) {
        resetZoom();
      }
    }
  }, [resetZoom]);

  // Desktop Mouse Drag Panning when zoomed
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!enabled || scaleRef.current <= 1.0 || e.button !== 0) return;
    isDraggingRef.current = true;
    dragStartRef.current = {
      x: e.clientX - positionRef.current.x,
      y: e.clientY - positionRef.current.y,
    };
  }, [enabled]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!enabled || !isDraggingRef.current || scaleRef.current <= 1.0) return;
    const newX = e.clientX - dragStartRef.current.x;
    const newY = e.clientY - dragStartRef.current.y;
    setPosition({ x: newX, y: newY });
  }, [enabled]);

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

  // Desktop Ctrl + Wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!enabled || !e.ctrlKey) return;
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.15 : -0.15;
    setScale((prev) => {
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number((prev + delta).toFixed(2))));
      if (next === 1.0) setPosition({ x: 0, y: 0 });
      return next;
    });
  }, [enabled]);

  // Global Keyboard Shortcuts (+ / - / 0 / Esc)
  useEffect(() => {
    if (!enabled) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === '+' || (e.key === '=' && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        zoomIn();
      } else if (e.key === '-' || (e.key === '_' && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        zoomOut();
      } else if (e.key === '0' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        resetZoom();
      } else if (e.key === 'Escape' && scaleRef.current > 1.0) {
        resetZoom();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, zoomIn, zoomOut, resetZoom]);

  const transformStyle: React.CSSProperties = {
    transform: scale > 1.0 ? `scale(${scale}) translate3d(${position.x / scale}px, ${position.y / scale}px, 0)` : undefined,
    transformOrigin: 'center center',
    transition: isDraggingRef.current ? 'none' : 'transform 0.15s ease-out',
    cursor: scale > 1.0 ? 'grab' : undefined,
  };

  return {
    scale,
    position,
    isZoomed: scale > 1.0,
    zoomIn,
    zoomOut,
    resetZoom,
    setZoomLevel,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handleWheel,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleDoubleTap,
    transformStyle,
  };
}
