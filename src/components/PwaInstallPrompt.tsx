import React, { useState } from 'react';
import { Download, X, Smartphone, Monitor, CheckCircle, Share, PlusSquare, Sparkles } from 'lucide-react';
import { usePwaInstall } from '../hooks/usePwaInstall';

interface PwaInstallPromptProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PwaInstallPrompt: React.FC<PwaInstallPromptProps> = ({ isOpen, onClose }) => {
  const { canInstall, hasPrompt, isInstalled, isIOS, installApp } = usePwaInstall();
  const [isInstalling, setIsInstalling] = useState(false);
  const [installSuccess, setInstallSuccess] = useState(false);

  if (!isOpen) return null;

  const handleInstall = async () => {
    setIsInstalling(true);
    const success = await installApp();
    setIsInstalling(false);
    if (success) {
      setInstallSuccess(true);
      setTimeout(() => {
        onClose();
      }, 1800);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-md bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden text-slate-100 p-6 sm:p-7">
        {/* Glow Header */}
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-amber-500 via-rose-500 to-indigo-500" />
        
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-3.5 mb-5">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500/20 to-amber-600/30 border border-amber-500/40 flex items-center justify-center text-amber-400 shadow-inner">
            <Download className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <h3 className="text-lg font-bold tracking-tight text-white flex items-center gap-1.5">
              Install Graywood App
              <Sparkles className="w-4 h-4 text-amber-400" />
            </h3>
            <p className="text-xs text-slate-400">Standalone Progressive Web App (PWA)</p>
          </div>
        </div>

        {/* Feature List */}
        <div className="space-y-3 mb-6 bg-slate-950/60 p-4 rounded-xl border border-slate-800">
          <div className="flex items-start gap-2.5 text-xs text-slate-300">
            <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span><strong>Full-Screen Immersive Reader:</strong> Zero address bars or browser clutter.</span>
          </div>
          <div className="flex items-start gap-2.5 text-xs text-slate-300">
            <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span><strong>Offline Chapter Cache:</strong> Read downloaded titles anywhere, even without Wi-Fi.</span>
          </div>
          <div className="flex items-start gap-2.5 text-xs text-slate-300">
            <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span><strong>Ultra-Fast 0ms Startup:</strong> Launches instantly from your dock or home screen.</span>
          </div>
        </div>

        {/* Platform-Specific Instructions */}
        {isIOS ? (
          <div className="bg-amber-950/40 border border-amber-700/50 rounded-xl p-4 mb-5 text-xs text-amber-200">
            <p className="font-semibold mb-2 flex items-center gap-1.5">
              <Smartphone className="w-4 h-4 text-amber-400" />
              How to install on iOS / iPadOS:
            </p>
            <ol className="list-decimal list-inside space-y-1.5 text-amber-300/90 pl-1">
              <li>Tap the <Share className="w-3.5 h-3.5 inline mx-1 text-amber-400" /> <strong>Share</strong> icon in Safari.</li>
              <li>Scroll down and select <PlusSquare className="w-3.5 h-3.5 inline mx-1 text-amber-400" /> <strong>Add to Home Screen</strong>.</li>
              <li>Tap <strong>Add</strong> in the top-right corner.</li>
            </ol>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs text-slate-400 mb-5">
            <Monitor className="w-4 h-4 text-slate-400" />
            <span>Compatible with Android, Chrome, Edge, and macOS/Windows.</span>
          </div>
        )}

        {/* Action Button */}
        {installSuccess ? (
          <div className="w-full py-3 bg-emerald-600/20 border border-emerald-500/40 text-emerald-400 font-semibold rounded-xl text-center flex items-center justify-center gap-2">
            <CheckCircle className="w-5 h-5" />
            App Installed Successfully!
          </div>
        ) : hasPrompt ? (
          <button
            onClick={handleInstall}
            disabled={isInstalling}
            className="w-full py-3 px-4 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 active:scale-[0.99] text-slate-950 font-bold rounded-xl shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2 transition-all disabled:opacity-50"
          >
            {isInstalling ? (
              <div className="w-5 h-5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <Download className="w-5 h-5" />
                Install Now (1-Click)
              </>
            )}
          </button>
        ) : isIOS ? (
          <button
            onClick={onClose}
            className="w-full py-3 px-4 bg-slate-800 hover:bg-slate-700 text-white font-semibold rounded-xl text-center transition-colors"
          >
            Got it, thanks!
          </button>
        ) : isInstalled ? (
          <div className="w-full py-3 bg-slate-800 border border-slate-700 text-slate-300 font-medium rounded-xl text-center text-xs">
            Already running as an installed application.
          </div>
        ) : (
          <button
            onClick={onClose}
            className="w-full py-3 px-4 bg-slate-800 hover:bg-slate-700 text-white font-semibold rounded-xl text-center transition-colors"
          >
            Close
          </button>
        )}
      </div>
    </div>
  );
};
