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

  // 3. HTML5 Gamepad / Nintendo Joy-Con Polling Loop
  useEffect(() => {
    let animFrameId: number;

    const pollGamepads = () => {
      const gamepads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
      const now = Date.now();
      const DEBOUNCE_MS = 220; // prevent rapid duplicate fires

      for (const gp of gamepads) {
        if (!gp) continue;

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

      animFrameId = requestAnimationFrame(pollGamepads);
    };

    animFrameId = requestAnimationFrame(pollGamepads);
    return () => cancelAnimationFrame(animFrameId);
  }, []);
}
