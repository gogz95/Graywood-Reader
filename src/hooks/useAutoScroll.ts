import { useState, useEffect, useRef, useCallback } from 'react';

interface UseAutoScrollOptions {
  initialSpeed?: number;
  containerRef: React.RefObject<HTMLElement | null>;
}

export function useAutoScroll({ initialSpeed = 2, containerRef }: UseAutoScrollOptions) {
  const [isAutoScrolling, setIsAutoScrolling] = useState(false);
  const [speed, setSpeed] = useState(initialSpeed);
  const animFrameId = useRef<number | null>(null);

  const toggleAutoScroll = useCallback(() => {
    setIsAutoScrolling((prev) => !prev);
  }, []);

  const changeSpeed = useCallback((delta: number) => {
    setSpeed((prev) => Math.max(1, Math.min(10, prev + delta)));
  }, []);

  useEffect(() => {
    if (!isAutoScrolling) {
      if (animFrameId.current) {
        cancelAnimationFrame(animFrameId.current);
        animFrameId.current = null;
      }
      return;
    }

    let lastTime = performance.now();

    const scrollLoop = (time: number) => {
      const dt = (time - lastTime) / 1000;
      lastTime = time;

      const targetEl = containerRef.current || document.documentElement;
      if (targetEl) {
        targetEl.scrollTop += speed * 40 * dt;
      }

      animFrameId.current = requestAnimationFrame(scrollLoop);
    };

    animFrameId.current = requestAnimationFrame(scrollLoop);

    return () => {
      if (animFrameId.current) {
        cancelAnimationFrame(animFrameId.current);
        animFrameId.current = null;
      }
    };
  }, [isAutoScrolling, speed, containerRef]);

  return {
    isAutoScrolling,
    speed,
    setSpeed,
    toggleAutoScroll,
    changeSpeed,
  };
}
