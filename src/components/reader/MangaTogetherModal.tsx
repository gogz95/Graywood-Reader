import React, { useState } from 'react';
import {
  X,
  Users,
  Copy,
  Check,
  Radio,
  Sparkles,
  LogOut,
  Crown,
  Eye,
  Send,
  Zap,
  Link2,
} from 'lucide-react';
import { MangaItem } from '../../types';
import { ActiveRoomState, RoomParticipant } from '../../hooks/useMangaTogether';

interface MangaTogetherModalProps {
  isOpen: boolean;
  onClose: () => void;
  manga: MangaItem;
  currentChapterNumber: number;
  activeRoom: ActiveRoomState | null;
  isHost: boolean;
  currentUser: RoomParticipant | null;
  autoFollow: boolean;
  setAutoFollow: (follow: boolean) => void;
  onCreateRoom: (mangaTitle: string, hostName: string, avatar?: string) => Promise<string | null>;
  onJoinRoom: (roomId: string, userName: string, avatar?: string) => Promise<boolean>;
  onLeaveRoom: () => void;
  onSendReaction: (emoji: string) => void;
}

export const MangaTogetherModal: React.FC<MangaTogetherModalProps> = ({
  isOpen,
  onClose,
  manga,
  currentChapterNumber,
  activeRoom,
  isHost,
  currentUser,
  autoFollow,
  setAutoFollow,
  onCreateRoom,
  onJoinRoom,
  onLeaveRoom,
  onSendReaction,
}) => {
  const [tab, setTab] = useState<'create' | 'join'>('create');
  const [userName, setUserName] = useState('');
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [copied, setCopied] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  if (!isOpen) return null;

  const handleCopyCode = () => {
    if (!activeRoom) return;
    navigator.clipboard.writeText(activeRoom.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyLink = () => {
    if (!activeRoom) return;
    const shareUrl = `${window.location.origin}${window.location.pathname}?room=${activeRoom.id}`;
    navigator.clipboard.writeText(shareUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleCreate = async () => {
    setErrorMsg('');
    setLoading(true);
    const hostName = userName.trim() || 'Host Reader';
    const code = await onCreateRoom(manga.title, hostName);
    setLoading(false);
    if (!code) {
      setErrorMsg('Failed to create room. Please try again.');
    }
  };

  const handleJoin = async () => {
    setErrorMsg('');
    const code = roomCodeInput.trim().toUpperCase();
    if (!code) {
      setErrorMsg('Please enter a 6-character room code.');
      return;
    }
    setLoading(true);
    const name = userName.trim() || 'Guest Reader';
    const ok = await onJoinRoom(code, name);
    setLoading(false);
    if (!ok) {
      setErrorMsg('Room not found or expired. Check the code and try again.');
    }
  };

  const emojis = ['🔥', '😮', '❤️', '⚡', '😂', '👏', '🥋', '🗡️'];

  return (
    <div className="fixed inset-0 z-[120] bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 animate-fadeIn">
      <div className="bg-surface border border-edge rounded-2xl max-w-md w-full shadow-2xl overflow-hidden my-auto flex flex-col">
        {/* Header */}
        <div className="p-4 bg-app border-b border-edge flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-black text-primary">Manga Together</h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-bold flex items-center gap-1">
                  <Radio className="w-3 h-3 animate-pulse text-cyan-400" /> Live Co-Reading
                </span>
              </div>
              <p className="text-xs text-secondary truncate max-w-xs">{manga.title}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full bg-elevated text-secondary hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-5">
          {activeRoom ? (
            /* Active Connected Room State */
            <div className="space-y-4">
              {/* Room Code Card */}
              <div className="p-4 bg-app border border-edge rounded-xl flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted">Room Code</span>
                  <div className="text-2xl font-black tracking-widest text-cyan-300 font-mono">
                    {activeRoom.id}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopyCode}
                    title="Copy 6-character room code"
                    className="px-3 py-1.5 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? 'Copied' : 'Code'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyLink}
                    title="Copy full invite URL to clipboard"
                    className="px-3 py-1.5 bg-accent/20 hover:bg-accent/30 text-accent border border-accent/40 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer"
                  >
                    {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Link2 className="w-3.5 h-3.5" />}
                    <span>{copiedLink ? 'Link Copied!' : 'Share Link'}</span>
                  </button>
                </div>
              </div>

              {/* Status & Auto-Follow */}
              <div className="flex items-center justify-between p-3 bg-app/60 border border-edge rounded-xl text-xs">
                <div className="flex items-center gap-2">
                  <Eye className="w-4 h-4 text-cyan-400" />
                  <span className="font-semibold text-primary">
                    {isHost ? 'You are the Room Host' : 'Following Room Host'}
                  </span>
                </div>
                {!isHost && (
                  <button
                    type="button"
                    onClick={() => setAutoFollow(!autoFollow)}
                    className={`px-2.5 py-1 rounded-lg font-bold text-[11px] transition-colors ${
                      autoFollow
                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                        : 'bg-elevated text-muted'
                    }`}
                  >
                    {autoFollow ? 'Auto-Sync: ON' : 'Auto-Sync: OFF'}
                  </button>
                )}
              </div>

              {/* Participant List */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-primary flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-accent" />
                    Participants ({activeRoom.participants.length})
                  </span>
                  <span className="text-[10px] text-muted">Reading Ch. {activeRoom.chapterNumber}</span>
                </div>
                <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
                  {activeRoom.participants.map((p) => (
                    <div
                      key={p.id}
                      className="p-2 bg-app border border-edge rounded-lg flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-300 flex items-center justify-center font-bold text-[11px]">
                          {p.avatar || p.name.charAt(0)}
                        </div>
                        <span className="font-semibold text-primary">{p.name}</span>
                        {p.id === currentUser?.id && (
                          <span className="text-[10px] text-muted">(You)</span>
                        )}
                      </div>
                      {p.isHost && (
                        <span className="px-2 py-0.5 rounded text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold flex items-center gap-1">
                          <Crown className="w-3 h-3 text-amber-400" /> Host
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Emoji Reaction Bar */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-bold text-secondary flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-accent" /> Send Floating Reaction
                </span>
                <div className="flex items-center gap-2 p-2 bg-app border border-edge rounded-xl overflow-x-auto">
                  {emojis.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => onSendReaction(emoji)}
                      className="text-lg p-1.5 rounded-lg hover:bg-elevated hover:scale-125 transition-transform"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>

              {/* Leave Room Button */}
              <button
                type="button"
                onClick={onLeaveRoom}
                className="w-full py-2.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
              >
                <LogOut className="w-4 h-4" /> Leave Room
              </button>
            </div>
          ) : (
            /* Lobby Creation / Join Form */
            <div className="space-y-4">
              {/* Tab Switcher */}
              <div className="grid grid-cols-2 p-1 bg-app border border-edge rounded-xl">
                <button
                  type="button"
                  onClick={() => setTab('create')}
                  className={`py-1.5 rounded-lg text-xs font-bold transition-all ${
                    tab === 'create'
                      ? 'bg-surface text-primary shadow-sm border border-edge'
                      : 'text-secondary hover:text-primary'
                  }`}
                >
                  Create Room
                </button>
                <button
                  type="button"
                  onClick={() => setTab('join')}
                  className={`py-1.5 rounded-lg text-xs font-bold transition-all ${
                    tab === 'join'
                      ? 'bg-surface text-primary shadow-sm border border-edge'
                      : 'text-secondary hover:text-primary'
                  }`}
                >
                  Join via Code
                </button>
              </div>

              {/* User Name Input */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-primary">Your Display Name</label>
                <input
                  type="text"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  placeholder="e.g. MangaEnthusiast"
                  className="w-full bg-app border border-edge rounded-xl px-3.5 py-2 text-xs text-primary focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                />
              </div>

              {tab === 'join' && (
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-primary">6-Character Room Code</label>
                  <input
                    type="text"
                    maxLength={6}
                    value={roomCodeInput}
                    onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
                    placeholder="e.g. X9K2W1"
                    className="w-full bg-app border border-edge rounded-xl px-3.5 py-2 text-center text-base font-black tracking-widest text-cyan-300 font-mono focus:outline-none focus:ring-2 focus:ring-cyan-500/50 uppercase"
                  />
                </div>
              )}

              {errorMsg && (
                <p className="text-xs text-rose-400 font-semibold">{errorMsg}</p>
              )}

              <button
                type="button"
                onClick={tab === 'create' ? handleCreate : handleJoin}
                disabled={loading}
                className="w-full py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white rounded-xl text-xs font-black shadow-lg shadow-cyan-500/20 transition-all flex items-center justify-center gap-1.5"
              >
                {tab === 'create' ? (
                  <>
                    <Zap className="w-4 h-4" />
                    {loading ? 'Creating Lobby...' : 'Host Reading Lobby'}
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    {loading ? 'Joining Lobby...' : 'Join Reading Lobby'}
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
