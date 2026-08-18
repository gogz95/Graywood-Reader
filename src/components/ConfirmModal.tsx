import React, { useEffect } from 'react';
import { AlertTriangle, Info, Trash2, X } from 'lucide-react';

export interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'info';
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  onConfirm,
  onCancel,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  const getVariantStyles = () => {
    switch (variant) {
      case 'danger':
        return {
          icon: <Trash2 className="w-6 h-6 text-red-400" />,
          iconBg: 'bg-red-500/10 border-red-500/20 text-red-400',
          btnBg: 'bg-red-600 hover:bg-red-500 text-white shadow-red-600/20',
        };
      case 'warning':
        return {
          icon: <AlertTriangle className="w-6 h-6 text-amber-400" />,
          iconBg: 'bg-amber-500/10 border-amber-500/20 text-amber-400',
          btnBg: 'bg-amber-600 hover:bg-amber-500 text-white shadow-amber-600/20',
        };
      case 'info':
      default:
        return {
          icon: <Info className="w-6 h-6 text-accent" />,
          iconBg: 'bg-accent/10 border-accent/20 text-accent',
          btnBg: 'bg-accent hover:bg-accent-bright text-accent-fg shadow-accent/20',
        };
    }
  };

  const { icon, iconBg, btnBg } = getVariantStyles();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn">
      <div
        className="bg-surface border border-edge rounded-2xl max-w-md w-full p-6 shadow-2xl shadow-black/80 space-y-5 animate-scaleUp"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className={`w-12 h-12 rounded-xl border flex items-center justify-center flex-shrink-0 ${iconBg}`}>
              {icon}
            </div>
            <div>
              <h3 id="confirm-modal-title" className="text-base font-bold text-primary">
                {title}
              </h3>
              <p className="text-xs text-secondary mt-1 leading-relaxed">{message}</p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="text-muted hover:text-primary p-1 rounded-lg hover:bg-elevated transition-colors"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-edge/60">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-xl border border-edge bg-elevated hover:bg-elevated-hover text-secondary hover:text-primary text-xs font-semibold transition-all active:scale-95"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => {
              onConfirm();
            }}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-md active:scale-95 ${btnBg}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
