import React, { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Lock, Settings } from 'lucide-react';
import { AppLockOverlay } from '../AppLockOverlay';
import { useAuthStore } from '../../stores/useAuthStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useModalStore } from '../../stores/useModalStore';

// ============================================================================
// VaultUnlockModal
// ============================================================================
// Wraps the existing AppLockOverlay to handle the NSFW vault unlock flow.
// Renders when the user clicks a locked NSFW card.
//
// Reads the PIN hash from AppSettings and sets the Zustand vault state on a
// successful match. If no PIN is configured, shows a guidance notice directing
// the user to Settings → Security instead of presenting a useless keypad.
// Uses React Portal to avoid being trapped inside transformed card containers
// or invalid table element nesting.
// ============================================================================

interface VaultUnlockModalProps {
  /** Whether the modal is currently open. */
  isOpen: boolean;
  /** Callback fired when the vault is successfully unlocked. Runs deferred action. */
  onUnlocked?: () => void;
  /** Callback fired when the user dismisses the overlay without unlocking. */
  onDismiss?: () => void;
}

export const VaultUnlockModal: React.FC<VaultUnlockModalProps> = ({
  isOpen,
  onUnlocked,
  onDismiss,
}) => {
  const appSettings = useSettingsStore((s) => s.appSettings);
  const pinHash = appSettings.appLockPinHash ?? '';
  const lockType = appSettings.appLockType ?? 'pin';
  const hasPinConfigured = Boolean(pinHash);

  const handleUnlock = useCallback(() => {
    // AppLockOverlay already verified the PIN hash; sync Zustand vault state
    useAuthStore.setState({ isVaultUnlocked: true });
    onUnlocked?.();
  }, [onUnlocked]);

  const handleOpenSettings = useCallback(() => {
    onDismiss?.();
    useModalStore.getState().openModal('settings');
  }, [onDismiss]);

  if (!isOpen) return null;

  // ── No PIN configured: guide the user to Settings ─────────────────────────
  if (!hasPinConfigured) {
    const modalContent = (
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/90 backdrop-blur-md animate-in fade-in duration-200"
        role="dialog"
        aria-modal="true"
        aria-label="Vault locked — PIN not configured"
        onClick={onDismiss}
      >
        <div
          className="w-full max-w-sm mx-4 p-8 rounded-3xl bg-slate-900/90 border border-slate-800/80 shadow-2xl shadow-indigo-950/40 text-center flex flex-col items-center gap-4"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="w-16 h-16 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
            <Lock className="w-8 h-8" />
          </div>

          <div>
            <h2 className="text-xl font-bold text-slate-100 tracking-wide">Vault Locked</h2>
            <p className="text-sm text-slate-400 mt-2 leading-relaxed">
              This series contains 18+ content. To unlock the NSFW Vault, set up a security PIN in{' '}
              <span className="text-indigo-400 font-semibold">Settings → Security</span>.
            </p>
          </div>

          <div className="flex gap-3 w-full mt-2">
            <button
              type="button"
              id="vault-modal-dismiss"
              onClick={onDismiss}
              className="flex-1 py-3 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/60 text-slate-300 font-semibold text-sm transition-all cursor-pointer"
            >
              Dismiss
            </button>
            <button
              type="button"
              id="vault-modal-settings"
              onClick={handleOpenSettings}
              className="flex-1 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm transition-all shadow-lg shadow-indigo-600/30 cursor-pointer flex items-center justify-center gap-1.5"
            >
              <Settings className="w-4 h-4" />
              Open Settings
            </button>
          </div>
        </div>
      </div>
    );

    return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
  }

  // ── PIN configured: render the full keypad overlay ─────────────────────────
  const keypadContent = (
    <div
      className="fixed inset-0 z-[9999]"
      role="dialog"
      aria-modal="true"
      aria-label="18+ Vault — PIN required"
    >
      {/* Dismiss on backdrop click */}
      <div className="absolute inset-0" onClick={onDismiss} />
      <AppLockOverlay
        isLocked={true}
        pinHash={pinHash}
        lockType={lockType}
        onUnlock={handleUnlock}
      />
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(keypadContent, document.body) : keypadContent;
};

// ============================================================================
// useVaultUnlock — imperative hook for vault-gated actions
// ============================================================================
// Manages the modal open/close state and deferred action queue so any component
// can gate an action behind the vault with a single function call.
//
// Usage:
//   const { openVaultFor, VaultModal } = useVaultUnlock();
//   // In JSX:
//   {VaultModal}
//   // In event handler:
//   openVaultFor(() => onSelectManga(manga));
// ============================================================================

export function useVaultUnlock() {
  const isVaultUnlocked = useAuthStore((s) => s.isVaultUnlocked);

  const [isModalOpen, setIsModalOpen] = useState(false);
  // Store action ref in state so it survives renders; wrap in object to avoid
  // React treating a function as a lazy-init callback.
  const [pendingAction, setPendingAction] = useState<{ fn: (() => void) | null }>({ fn: null });

  /**
   * If the vault is already unlocked, run the action immediately.
   * Otherwise, open the modal — the action fires after a successful PIN entry.
   */
  const openVaultFor = useCallback((action: () => void) => {
    if (isVaultUnlocked) {
      action();
      return;
    }
    setPendingAction({ fn: action });
    setIsModalOpen(true);
  }, [isVaultUnlocked]);

  const handleUnlocked = useCallback(() => {
    setIsModalOpen(false);
    pendingAction.fn?.();
    setPendingAction({ fn: null });
  }, [pendingAction]);

  const handleDismiss = useCallback(() => {
    setIsModalOpen(false);
    setPendingAction({ fn: null });
  }, []);

  /** Drop this into your component's render tree — renders nothing when closed. */
  const VaultModal = (
    <VaultUnlockModal
      isOpen={isModalOpen}
      onUnlocked={handleUnlocked}
      onDismiss={handleDismiss}
    />
  );

  return { openVaultFor, VaultModal, isVaultUnlocked };
}
