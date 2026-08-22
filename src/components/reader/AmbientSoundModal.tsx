import React, { useState, useEffect } from 'react';
import { CloudRain, Flame, Coffee, Volume2, VolumeX, Clock, X, Sparkles, BookOpen } from 'lucide-react';
import { soundscapes, SoundscapePreset } from '../../utils/soundscapes';

interface AmbientSoundModalProps {
  isOpen: boolean;
  onClose: () => void;
  pageTurnSfxEnabled: boolean;
  onTogglePageTurnSfx: (enabled: boolean) => void;
}

export const AmbientSoundModal: React.FC<AmbientSoundModalProps> = ({
  isOpen,
  onClose,
  pageTurnSfxEnabled,
  onTogglePageTurnSfx,
}) => {
  const [currentPreset, setCurrentPreset] = useState<SoundscapePreset>(soundscapes.getCurrentPreset());
  const [volume, setVolume] = useState<number>(soundscapes.getVolume());
  const [sleepMinutes, setSleepMinutes] = useState<number>(0);
  const [remainingTime, setRemainingTime] = useState<number | null>(soundscapes.getRemainingSleepMinutes());

  useEffect(() => {
    if (isOpen) {
      setCurrentPreset(soundscapes.getCurrentPreset());
      setVolume(soundscapes.getVolume());
      setRemainingTime(soundscapes.getRemainingSleepMinutes());
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const timer = setInterval(() => {
      setRemainingTime(soundscapes.getRemainingSleepMinutes());
      if (soundscapes.getCurrentPreset() !== currentPreset) {
        setCurrentPreset(soundscapes.getCurrentPreset());
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [isOpen, currentPreset]);

  if (!isOpen) return null;

  const handleSelectPreset = (preset: SoundscapePreset) => {
    setCurrentPreset(preset);
    soundscapes.playPreset(preset);
  };

  const handleVolumeChange = (newVol: number) => {
    setVolume(newVol);
    soundscapes.setVolume(newVol);
  };

  const handleSetSleepTimer = (mins: number) => {
    setSleepMinutes(mins);
    soundscapes.setSleepTimer(mins, () => {
      setCurrentPreset('off');
      setRemainingTime(null);
    });
    setRemainingTime(mins > 0 ? mins : null);
  };

  const presets: Array<{ id: SoundscapePreset; name: string; icon: React.ReactNode; desc: string; color: string }> = [
    { id: 'rain', name: 'Rain on Window', icon: <CloudRain className="w-5 h-5 text-blue-400" />, desc: 'Soothing rain droplets on glass', color: 'border-blue-500/50 bg-blue-500/10' },
    { id: 'campfire', name: 'Forest Campfire', icon: <Flame className="w-5 h-5 text-amber-400" />, desc: 'Warm crackling fireplace embers', color: 'border-amber-500/50 bg-amber-500/10' },
    { id: 'lofi', name: 'Cozy Lo-Fi', icon: <Coffee className="w-5 h-5 text-emerald-400" />, desc: 'Relaxing vintage tape ambience', color: 'border-emerald-500/50 bg-emerald-500/10' },
    { id: 'off', name: 'Mute / Off', icon: <VolumeX className="w-5 h-5 text-slate-400" />, desc: 'Silent reading mode', color: 'border-slate-700 bg-slate-800/40' },
  ];

  return (
    <div className="fixed inset-0 z-9999 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-md bg-slate-900/95 border border-slate-800 rounded-3xl p-6 shadow-2xl text-slate-100 flex flex-col gap-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-500/15 text-indigo-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-100">Ambient Atmosphere & Audio</h3>
              <p className="text-xs text-slate-400">Web Audio procedural soundscapes</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-all cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Soundscape Presets */}
        <div className="grid grid-cols-2 gap-3">
          {presets.map(p => {
            const isSelected = currentPreset === p.id;
            return (
              <button
                key={p.id}
                onClick={() => handleSelectPreset(p.id)}
                className={`p-3.5 rounded-2xl border text-left transition-all flex flex-col gap-2 cursor-pointer ${
                  isSelected
                    ? `${p.color} ring-2 ring-indigo-500/50 shadow-lg`
                    : 'border-slate-800 bg-slate-800/40 hover:bg-slate-800/80 text-slate-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  {p.icon}
                  {isSelected && (
                    <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300">
                      Active
                    </span>
                  )}
                </div>
                <div>
                  <div className="text-sm font-semibold text-slate-100">{p.name}</div>
                  <div className="text-[11px] text-slate-400 leading-tight mt-0.5">{p.desc}</div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Volume Slider */}
        <div className="bg-slate-800/40 border border-slate-800/80 rounded-2xl p-4 flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs text-slate-300">
            <span className="flex items-center gap-1.5 font-medium">
              <Volume2 className="w-4 h-4 text-indigo-400" />
              Soundscape Volume
            </span>
            <span className="font-mono text-slate-400">{Math.round(volume * 100)}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={volume}
            onChange={e => handleVolumeChange(parseFloat(e.target.value))}
            className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
          />
        </div>

        {/* Page Turn SFX & Sleep Timer */}
        <div className="space-y-4">
          <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-800/40 border border-slate-800/80">
            <div className="flex items-center gap-2.5">
              <BookOpen className="w-4 h-4 text-slate-400" />
              <div>
                <div className="text-xs font-semibold text-slate-200">Page Turn SFX</div>
                <div className="text-[11px] text-slate-400">Play realistic paper rustle on turning pages</div>
              </div>
            </div>
            <button
              onClick={() => {
                onTogglePageTurnSfx(!pageTurnSfxEnabled);
                if (!pageTurnSfxEnabled) soundscapes.playPageTurn();
              }}
              className={`w-11 h-6 flex items-center rounded-full p-1 transition-all cursor-pointer ${
                pageTurnSfxEnabled ? 'bg-indigo-600 justify-end' : 'bg-slate-700 justify-start'
              }`}
            >
              <div className="w-4 h-4 rounded-full bg-white shadow-md" />
            </button>
          </div>

          {/* Sleep Timer */}
          <div className="p-3 rounded-2xl bg-slate-800/40 border border-slate-800/80">
            <div className="flex items-center justify-between text-xs mb-2.5">
              <span className="flex items-center gap-1.5 text-slate-300 font-medium">
                <Clock className="w-4 h-4 text-amber-400" />
                Auto-Sleep Timer
              </span>
              {remainingTime && (
                <span className="text-[11px] font-semibold text-amber-400">
                  {remainingTime} min remaining
                </span>
              )}
            </div>
            <div className="grid grid-cols-5 gap-1.5">
              {[0, 15, 30, 45, 60].map(mins => (
                <button
                  key={mins}
                  onClick={() => handleSetSleepTimer(mins)}
                  className={`py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer ${
                    (mins === 0 && !remainingTime) || (remainingTime && mins === sleepMinutes)
                      ? 'bg-amber-500/20 border border-amber-500/40 text-amber-300'
                      : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
                  }`}
                >
                  {mins === 0 ? 'Off' : `${mins}m`}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
