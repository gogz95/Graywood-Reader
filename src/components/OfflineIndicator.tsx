import React, { useState, useEffect } from 'react';
import { WifiOff, Wifi } from 'lucide-react';

export const OfflineIndicator: React.FC = () => {
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [showReconnected, setShowReconnected] = useState(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setShowReconnected(true);
      const timer = setTimeout(() => setShowReconnected(false), 3500);
      return () => clearTimeout(timer);
    };

    const handleOffline = () => {
      setIsOnline(false);
      setShowReconnected(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (isOnline && !showReconnected) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[90] pointer-events-none animate-in slide-in-from-bottom duration-300">
      {!isOnline ? (
        <div className="flex items-center gap-2.5 px-4 py-2 bg-rose-950/90 border border-rose-600/70 text-rose-200 text-xs font-semibold rounded-full shadow-2xl backdrop-blur-md">
          <WifiOff className="w-4 h-4 text-rose-400 animate-pulse" />
          <span>Offline Mode — Serving cached library & chapters</span>
        </div>
      ) : (
        <div className="flex items-center gap-2.5 px-4 py-2 bg-emerald-950/90 border border-emerald-600/70 text-emerald-200 text-xs font-semibold rounded-full shadow-2xl backdrop-blur-md">
          <Wifi className="w-4 h-4 text-emerald-400" />
          <span>Back Online — Live sync restored</span>
        </div>
      )}
    </div>
  );
};
