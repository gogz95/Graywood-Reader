import { useEffect, useRef } from 'react';

export interface GamepadNavigationCallbacks {
  onNextPage: () => void;
  onPrevPage: () => void;
  onScrollUp?: () => void;
  onScrollDown?: () => void;
  onToggleHud?: () => void;
}

/**
 * Hook to support hands-free reading via:
 * - Bluetooth presentation remotes & clickers (Volume keys, PageUp/Down, Arrow keys)
 * - Gamepads & Nintendo Switch Joy-Cons (D-Pad, Bumpers, Triggers, A/B buttons)
 * - Stylus / Samsung S-Pen air clicks & barrel button actions
 */
export function useGamepadNavigation({
  onNextPage,
  onPrevPage,
  onScrollUp,
  onScrollDown,
  onToggleHud,
}: GamepadNavigationCallbacks): void {
  const callbacksRef = useRef({ onNextPage, onPrevPage, onScrollUp, onScrollDown, onToggleHud });
  callbacksRef.current = { onNextPage, onPrevPage, onScrollUp, onScrollDown, onToggleHud };

  const lastButtonStateRef = useRef<Map<number, boolean>>(new Map());
  const lastActionTimeRef = useRef<number>(0);

  // 1. Hardware Bluetooth Remotes & Presentation Clickers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input/textarea
      const target = e.target as HTMLElement;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) {
        return;
      }

      switch (e.key) {
        case 'PageDown':
        case 'MediaTrackNext':
        case 'AudioVolumeUp':
          e.preventDefault();
          callbacksRef.current.onNextPage();
          break;
        case 'PageUp':
        case 'MediaTrackPrevious':
        case 'AudioVolumeDown':
          e.preventDefault();
          callbacksRef.current.onPrevPage();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // 2. Stylus & Samsung S-Pen Pointer / Button Actions
  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'pen') {
        // Barrel button clicked (button === 2 or buttons === 2)
        if (e.button === 2 || e.buttons === 2) {
          callbacksRef.current.onNextPage();
        }
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, []);

  // 3. HTML5 Gamepad / Nintendo Joy-Con Polling Loop (Active only when gamepads are plugged in)
  useEffect(() => {
    let animFrameId: number | null = null;
    let isPolling = false;
    let slowCheckInterval: ReturnType<typeof setInterval> | null = null;

    const hasConnectedGamepad = (): boolean => {
      if (typeof navigator.getGamepads !== 'function') return false;
      const gps = navigator.getGamepads();
      for (let i = 0; i < gps.length; i++) {
        if (gps[i]) return true;
      }
      return false;
    };

    const pollGamepads = () => {
      if (document.hidden) {
        stopPolling();
        return;
      }

      const gamepads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
      let anyFound = false;
      const now = Date.now();
      const DEBOUNCE_MS = 220; // prevent rapid duplicate fires

      for (const gp of gamepads) {
        if (!gp) continue;
        anyFound = true;

        // Button index mapping:
        // 0: A / Bottom face button -> Next
        // 1: B / Right face button -> Next
        // 2: X / Left face button -> Prev
        // 3: Y / Top face button
        // 4: L1 / Left Bumper -> Prev
        // 5: R1 / Right Bumper -> Next
        // 6: L2 / Left Trigger -> Prev
        // 7: R2 / Right Trigger -> Next
        // 9: Start / Options -> Toggle HUD
        // 12: D-Pad Up -> Scroll Up
        // 13: D-Pad Down -> Scroll Down
        // 14: D-Pad Left -> Prev
        // 15: D-Pad Right -> Next

        const isPressed = (idx: number) => gp.buttons[idx]?.pressed || gp.buttons[idx]?.value > 0.5;

        if (now - lastActionTimeRef.current > DEBOUNCE_MS) {
          if (isPressed(5) || isPressed(7) || isPressed(15) || isPressed(0) || isPressed(1)) {
            callbacksRef.current.onNextPage();
            lastActionTimeRef.current = now;
          } else if (isPressed(4) || isPressed(6) || isPressed(14) || isPressed(2)) {
            callbacksRef.current.onPrevPage();
            lastActionTimeRef.current = now;
          } else if (isPressed(12)) {
            callbacksRef.current.onScrollUp?.();
            lastActionTimeRef.current = now;
          } else if (isPressed(13)) {
            callbacksRef.current.onScrollDown?.();
            lastActionTimeRef.current = now;
          } else if (isPressed(9)) {
            callbacksRef.current.onToggleHud?.();
            lastActionTimeRef.current = now;
          }

          // Check Left Joystick horizontal axis
          const axisX = gp.axes[0] || 0;
          if (axisX > 0.7) {
            callbacksRef.current.onNextPage();
            lastActionTimeRef.current = now;
          } else if (axisX < -0.7) {
            callbacksRef.current.onPrevPage();
            lastActionTimeRef.current = now;
          }
        }
      }

      if (anyFound) {
        animFrameId = requestAnimationFrame(pollGamepads);
      } else {
        stopPolling();
      }
    };

    const startPolling = () => {
      if (isPolling || document.hidden) return;
      isPolling = true;
      animFrameId = requestAnimationFrame(pollGamepads);
    };

    const stopPolling = () => {
      isPolling = false;
      if (animFrameId !== null) {
        cancelAnimationFrame(animFrameId);
        animFrameId = null;
      }
    };

    const handleGamepadConnected = () => startPolling();
    const handleGamepadDisconnected = () => {
      if (!hasConnectedGamepad()) stopPolling();
    };
    const handleVisibilityChange = () => {
      if (document.hidden) stopPolling();
      else if (hasConnectedGamepad()) startPolling();
    };

    window.addEventListener('gamepadconnected', handleGamepadConnected);
    window.addEventListener('gamepaddisconnected', handleGamepadDisconnected);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Initial check: only start high-frequency RAF if a gamepad is already attached
    if (hasConnectedGamepad()) {
      startPolling();
    } else {
      // Light check every 3s in case browser doesn't dispatch gamepadconnected
      slowCheckInterval = setInterval(() => {
        if (!isPolling && hasConnectedGamepad()) {
          startPolling();
        }
      }, 3000);
    }

    return () => {
      stopPolling();
      if (slowCheckInterval) clearInterval(slowCheckInterval);
      window.removeEventListener('gamepadconnected', handleGamepadConnected);
      window.removeEventListener('gamepaddisconnected', handleGamepadDisconnected);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);
}
