import React, { useState, useEffect } from 'react';
import { apiFetch } from '../utils/api';
import {
  X,
  Plus,
  Play,
  ListOrdered,
  BookOpen,
  Trash2,
  Edit2,
  ArrowUp,
  ArrowDown,
  Layers,
  Sparkles,
  Search,
  Check,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';
import { MangaItem } from '../types';

export interface ReadlistItem {
  id: string;
  readlistId: string;
  mangaId: string;
  mangaTitle?: string;
  mangaCover?: string;
  mangaSourceUrl?: string;
  mangaSourceName?: string;
  chapterNumber: number;
  chapterTitle?: string;
  sortOrder: number;
  notes?: string;
}

export interface Readlist {
  id: string;
  userId: string;
  name: string;
  description?: string;
  coverImage?: string;
  createdAt: string;
  updatedAt: string;
  itemsCount: number;
  items?: ReadlistItem[];
}

interface ReadlistsModalProps {
  isOpen: boolean;
  onClose: () => void;
  mangaList: MangaItem[];
  onOpenReaderPlaylist?: (readlist: Readlist, startIndex?: number) => void;
}

export const ReadlistsModal: React.FC<ReadlistsModalProps> = ({
  isOpen,
  onClose,
  mangaList,
  onOpenReaderPlaylist,
}) => {
  const [readlists, setReadlists] = useState<Readlist[]>([]);
  const [selectedReadlistId, setSelectedReadlistId] = useState<string | null>(null);
  const [activeReadlist, setActiveReadlist] = useState<Readlist | null>(null);
  const [loading, setLoading] = useState(false);

  // Form states for creating / editing readlists
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newCover, setNewCover] = useState('');

  // Add chapter dialog state
  const [isAddingItems, setIsAddingItems] = useState(false);
  const [selectedMangaId, setSelectedMangaId] = useState<string>('');
  const [startChapter, setStartChapter] = useState<number>(1);
  const [endChapter, setEndChapter] = useState<number>(1);
  const [rangeMode, setRangeMode] = useState<boolean>(false);
  const [itemNote, setItemNote] = useState<string>('');
  const [mangaSearch, setMangaSearch] = useState<string>('');

  const fetchReadlists = async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/readlists');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.readlists)) {
          setReadlists(data.readlists);
        }
      }
    } catch {
      //
    } finally {
      setLoading(false);
    }
  };

  const fetchReadlistDetail = async (id: string) => {
    try {
      const res = await apiFetch(`/api/readlists/${id}`);
      if (res.ok) {
        const data = await res.json();
        if (data.readlist) {
          setActiveReadlist(data.readlist);
        }
      }
    } catch {
      //
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchReadlists();
    }
  }, [isOpen]);

  useEffect(() => {
    if (selectedReadlistId) {
      fetchReadlistDetail(selectedReadlistId);
    } else {
      setActiveReadlist(null);
    }
  }, [selectedReadlistId]);

  if (!isOpen) return null;

  const handleCreateReadlist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    try {
      const res = await apiFetch('/api/readlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          description: newDesc.trim() || undefined,
          coverImage: newCover.trim() || undefined,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setNewName('');
        setNewDesc('');
        setNewCover('');
        setIsCreating(false);
        await fetchReadlists();
        if (data.readlist?.id) {
          setSelectedReadlistId(data.readlist.id);
        }
      }
    } catch (err: any) {
      alert(`Failed to create readlist: ${err.message}`);
    }
  };

  const handleDeleteReadlist = async (id: string) => {
    if (!confirm('Are you sure you want to delete this reading list?')) return;
    try {
      await apiFetch(`/api/readlists/${id}`, { method: 'DELETE' });
      setSelectedReadlistId(null);
      fetchReadlists();
    } catch {
      //
    }
  };

  const handleAddItemsToReadlist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeReadlist || !selectedMangaId) return;

    const targetManga = mangaList.find((m) => m.id === selectedMangaId);
    if (!targetManga) return;

    try {
      let payload: any;
      if (rangeMode) {
        const min = Math.min(startChapter, endChapter);
        const max = Math.max(startChapter, endChapter);
        const nums: number[] = [];
        for (let n = min; n <= max; n++) nums.push(n);
        payload = {
          mangaId: targetManga.id,
          chapterNumbers: nums,
          notes: itemNote.trim() || undefined,
        };
      } else {
        payload = {
          mangaId: targetManga.id,
          chapterNumber: startChapter,
          notes: itemNote.trim() || undefined,
        };
      }

      const res = await apiFetch(`/api/readlists/${activeReadlist.id}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setIsAddingItems(false);
        setItemNote('');
        fetchReadlistDetail(activeReadlist.id);
        fetchReadlists();
      }
    } catch (err: any) {
      alert(`Failed to add chapters: ${err.message}`);
    }
  };

  const handleRemoveItem = async (itemId: string) => {
    if (!activeReadlist) return;
    try {
      await apiFetch(`/api/readlists/${activeReadlist.id}/items/${itemId}`, { method: 'DELETE' });
      fetchReadlistDetail(activeReadlist.id);
      fetchReadlists();
    } catch {
      //
    }
  };

  const handleMoveItem = async (index: number, direction: 'up' | 'down') => {
    if (!activeReadlist || !activeReadlist.items) return;
    const items = [...activeReadlist.items];
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= items.length) return;

    const temp = items[index];
    items[index] = items[targetIdx];
    items[targetIdx] = temp;

    const reordered = items.map((it, idx) => ({ ...it, sortOrder: idx }));
    setActiveReadlist({ ...activeReadlist, items: reordered });

    try {
      await apiFetch(`/api/readlists/${activeReadlist.id}/reorder`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: reordered }),
      });
    } catch {
      fetchReadlistDetail(activeReadlist.id);
    }
  };

  const filteredMangaList = mangaList.filter((m) =>
    m.title.toLowerCase().includes(mangaSearch.toLowerCase()) ||
    m.altTitles.some((alt) => alt.toLowerCase().includes(mangaSearch.toLowerCase()))
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div className="bg-surface border border-edge rounded-3xl w-full max-w-4xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-edge bg-app/50">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-accent-2/15 text-accent-2 border border-accent-2/25">
              <ListOrdered className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-black text-primary flex items-center gap-2">
                Cross-Series Story Arcs & Readlists
              </h3>
              <p className="text-xs text-secondary">
                Curate multi-series universe reading orders, crossover events, and custom sequential playlists.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-muted hover:text-primary hover:bg-elevated transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
          {/* Sidebar / List of Readlists */}
          <div className="w-full md:w-80 border-r border-edge bg-app/30 flex flex-col overflow-hidden">
            <div className="p-3 border-b border-edge flex items-center justify-between">
              <span className="text-xs font-bold text-secondary uppercase tracking-wider">
                My Story Arcs ({readlists.length})
              </span>
              <button
                type="button"
                onClick={() => {
                  setIsCreating(true);
                  setSelectedReadlistId(null);
                }}
                className="px-2.5 py-1 rounded-xl bg-accent-2/15 hover:bg-accent-2/25 text-accent-2 border border-accent-2/30 text-xs font-bold transition-all flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Arc</span>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
              {readlists.length === 0 ? (
                <div className="py-8 text-center text-secondary text-xs">
                  <p className="font-bold text-primary">No Readlists Created</p>
                  <p className="text-muted text-[11px] mt-1">Click "New Arc" to build your first crossover playlist.</p>
                </div>
              ) : (
                readlists.map((rl) => {
                  const isSelected = selectedReadlistId === rl.id;
                  return (
                    <div
                      key={rl.id}
                      onClick={() => {
                        setSelectedReadlistId(rl.id);
                        setIsCreating(false);
                      }}
                      className={`p-3 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                        isSelected
                          ? 'bg-accent-2/15 border-accent-2/40 shadow-sm'
                          : 'bg-surface/60 hover:bg-surface border-edge'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <h4 className={`font-bold text-xs truncate ${isSelected ? 'text-accent-2' : 'text-primary'}`}>
                          {rl.name}
                        </h4>
                        <div className="flex items-center gap-2 text-[11px] text-muted mt-0.5">
                          <span>{rl.itemsCount} Chapter{rl.itemsCount === 1 ? '' : 's'}</span>
                          {rl.description && <span>•</span>}
                          {rl.description && <span className="truncate max-w-[120px]">{rl.description}</span>}
                        </div>
                      </div>
                      <ChevronRight className={`w-4 h-4 shrink-0 ${isSelected ? 'text-accent-2' : 'text-muted'}`} />
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Main Area: Readlist Details & Playlist Chapters */}
          <div className="flex-1 flex flex-col overflow-hidden bg-surface">
            {isCreating ? (
              <form onSubmit={handleCreateReadlist} className="p-6 space-y-4 overflow-y-auto flex-1 text-xs sm:text-sm">
                <div className="space-y-1">
                  <h4 className="text-base font-black text-primary">Create New Story Arc / Readlist</h4>
                  <p className="text-xs text-secondary">
                    Create a custom sequential chapter playlist that can span across multiple series.
                  </p>
                </div>

                <div>
                  <label className="block font-bold text-secondary mb-1">Arc Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. PTJ Universe Master Order, Solo Leveling Complete Arc..."
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="w-full bg-app border border-edge rounded-xl p-3 text-primary font-semibold focus:outline-none focus:ring-2 focus:ring-accent-2/50"
                  />
                </div>

                <div>
                  <label className="block font-bold text-secondary mb-1">Description / Reading Notes</label>
                  <textarea
                    rows={3}
                    placeholder="Provide context, crossover details, or chronological reading tips..."
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    className="w-full bg-app border border-edge rounded-xl p-3 text-primary focus:outline-none focus:ring-2 focus:ring-accent-2/50"
                  />
                </div>

                <div>
                  <label className="block font-bold text-secondary mb-1">Cover Artwork URL (Optional)</label>
                  <input
                    type="url"
                    placeholder="https://..."
                    value={newCover}
                    onChange={(e) => setNewCover(e.target.value)}
                    className="w-full bg-app border border-edge rounded-xl p-3 text-primary focus:outline-none focus:ring-2 focus:ring-accent-2/50"
                  />
                </div>

                <div className="flex items-center justify-end gap-3 pt-4 border-t border-edge">
                  <button
                    type="button"
                    onClick={() => setIsCreating(false)}
                    className="px-4 py-2.5 rounded-xl bg-elevated text-secondary font-bold text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2.5 rounded-xl bg-accent-2 hover:bg-accent-2/90 text-white font-bold text-xs shadow-lg transition-all"
                  >
                    Create Story Arc
                  </button>
                </div>
              </form>
            ) : activeReadlist ? (
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* Readlist Header Details */}
                <div className="p-5 border-b border-edge bg-app/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div className="space-y-1 flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-black text-primary truncate">{activeReadlist.name}</h3>
                      <span className="px-2 py-0.5 rounded-md bg-accent-2/15 text-accent-2 text-[11px] font-black">
                        {activeReadlist.items?.length || 0} Chapters
                      </span>
                    </div>
                    {activeReadlist.description && (
                      <p className="text-xs text-secondary leading-relaxed">{activeReadlist.description}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {activeReadlist.items && activeReadlist.items.length > 0 && onOpenReaderPlaylist && (
                      <button
                        type="button"
                        onClick={() => onOpenReaderPlaylist(activeReadlist, 0)}
                        className="px-4 py-2 rounded-xl bg-gradient-to-r from-accent to-accent-2 hover:from-accent-bright hover:to-accent-2 text-accent-fg font-black text-xs flex items-center gap-1.5 shadow-lg shadow-accent/20 transition-all hover:scale-105"
                      >
                        <Play className="w-4 h-4 fill-accent-fg" />
                        <span>Start Reading Arc</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => setIsAddingItems(true)}
                      className="px-3.5 py-2 rounded-xl bg-accent-2/15 hover:bg-accent-2/25 text-accent-2 border border-accent-2/30 font-bold text-xs flex items-center gap-1.5 transition-all"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Add Chapters</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDeleteReadlist(activeReadlist.id)}
                      className="p-2 rounded-xl text-muted hover:text-danger hover:bg-danger/10 transition-all"
                      title="Delete Story Arc"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Add Chapters Sub-Panel */}
                {isAddingItems && (
                  <form
                    onSubmit={handleAddItemsToReadlist}
                    className="p-4 bg-app/60 border-b border-edge space-y-3 text-xs animate-fade-in"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-primary flex items-center gap-1.5">
                        <Plus className="w-4 h-4 text-accent-2" />
                        Add Chapters from Library
                      </span>
                      <button
                        type="button"
                        onClick={() => setIsAddingItems(false)}
                        className="text-muted hover:text-primary"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block font-bold text-secondary mb-1">Select Series</label>
                        <select
                          required
                          value={selectedMangaId}
                          onChange={(e) => {
                            setSelectedMangaId(e.target.value);
                            const found = mangaList.find((m) => m.id === e.target.value);
                            if (found) {
                              setStartChapter(1);
                              setEndChapter(found.latestChapter || 1);
                            }
                          }}
                          className="w-full bg-surface border border-edge rounded-xl p-2.5 text-primary font-semibold focus:outline-none focus:ring-2 focus:ring-accent-2/50"
                        >
                          <option value="">-- Choose Series --</option>
                          {mangaList.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.title} (Latest: Ch. {m.latestChapter})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <label className="font-bold text-secondary">Chapter Selection</label>
                          <button
                            type="button"
                            onClick={() => setRangeMode(!rangeMode)}
                            className="text-accent-2 text-[11px] font-bold hover:underline"
                          >
                            {rangeMode ? 'Single Chapter Mode' : 'Chapter Range Mode'}
                          </button>
                        </div>

                        {rangeMode ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min="1"
                              value={startChapter}
                              onChange={(e) => setStartChapter(Number(e.target.value))}
                              placeholder="From"
                              className="w-full bg-surface border border-edge rounded-xl p-2 text-primary text-center font-bold"
                            />
                            <span className="text-secondary font-bold">to</span>
                            <input
                              type="number"
                              min="1"
                              value={endChapter}
                              onChange={(e) => setEndChapter(Number(e.target.value))}
                              placeholder="To"
                              className="w-full bg-surface border border-edge rounded-xl p-2 text-primary text-center font-bold"
                            />
                          </div>
                        ) : (
                          <input
                            type="number"
                            min="1"
                            value={startChapter}
                            onChange={(e) => setStartChapter(Number(e.target.value))}
                            placeholder="Chapter Number"
                            className="w-full bg-surface border border-edge rounded-xl p-2 text-primary font-bold"
                          />
                        )}
                      </div>
                    </div>

                    <div>
                      <label className="block font-bold text-secondary mb-1">Chapter Note (Optional)</label>
                      <input
                        type="text"
                        placeholder="e.g. Read after Manager Kim Ch. 50..."
                        value={itemNote}
                        onChange={(e) => setItemNote(e.target.value)}
                        className="w-full bg-surface border border-edge rounded-xl p-2 text-primary"
                      />
                    </div>

                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setIsAddingItems(false)}
                        className="px-3 py-1.5 rounded-lg bg-elevated text-secondary font-bold"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={!selectedMangaId}
                        className="px-4 py-1.5 rounded-lg bg-accent-2 hover:bg-accent-2/90 text-white font-bold disabled:opacity-50"
                      >
                        Add to Playlist
                      </button>
                    </div>
                  </form>
                )}

                {/* Playlist Ordered Items */}
                <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
                  {!activeReadlist.items || activeReadlist.items.length === 0 ? (
                    <div className="py-16 text-center text-secondary text-xs">
                      <Layers className="w-10 h-10 mx-auto text-muted mb-2 opacity-50" />
                      <p className="font-bold text-primary">No Chapters Added Yet</p>
                      <p className="text-muted text-[11px] mt-1 max-w-xs mx-auto">
                        Click "Add Chapters" above to add chapters from different series in sequential reading order.
                      </p>
                    </div>
                  ) : (
                    activeReadlist.items.map((item, idx) => (
                      <div
                        key={item.id}
                        className="p-3 rounded-2xl bg-app/40 border border-edge hover:border-edge-strong transition-all flex items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <span className="w-6 text-center font-mono font-bold text-xs text-muted">
                            #{idx + 1}
                          </span>

                          <div className="w-8 h-12 rounded-lg bg-surface border border-edge shrink-0 overflow-hidden">
                            {item.mangaCover ? (
                              <img
                                src={item.mangaCover}
                                alt={item.mangaTitle}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-[9px] font-bold text-muted">
                                Art
                              </div>
                            )}
                          </div>

                          <div className="min-w-0 flex-1 space-y-0.5">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h5 className="font-bold text-xs text-primary truncate max-w-sm">
                                {item.mangaTitle}
                              </h5>
                              <span className="px-2 py-0.5 rounded bg-accent/15 text-accent text-[10px] font-black">
                                Ch. {item.chapterNumber}
                              </span>
                            </div>
                            {item.notes && (
                              <p className="text-[11px] text-accent-2 italic">{item.notes}</p>
                            )}
                          </div>
                        </div>

                        {/* Order Controls & Actions */}
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() => handleMoveItem(idx, 'up')}
                            className="p-1.5 rounded-lg bg-elevated hover:bg-surface text-secondary hover:text-primary disabled:opacity-30"
                            title="Move Up"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            disabled={idx === (activeReadlist.items?.length || 1) - 1}
                            onClick={() => handleMoveItem(idx, 'down')}
                            className="p-1.5 rounded-lg bg-elevated hover:bg-surface text-secondary hover:text-primary disabled:opacity-30"
                            title="Move Down"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>

                          {onOpenReaderPlaylist && (
                            <button
                              type="button"
                              onClick={() => onOpenReaderPlaylist(activeReadlist, idx)}
                              className="px-2.5 py-1.5 rounded-lg bg-accent/15 hover:bg-accent/25 text-accent text-xs font-bold flex items-center gap-1"
                              title="Read from this chapter"
                            >
                              <Play className="w-3 h-3 fill-accent" />
                              <span className="hidden sm:inline">Play</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => handleRemoveItem(item.id)}
                            className="p-1.5 rounded-lg text-muted hover:text-danger hover:bg-danger/10"
                            title="Remove Chapter"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : (
              <div className="py-24 text-center text-secondary space-y-3">
                <ListOrdered className="w-12 h-12 mx-auto text-muted opacity-40" />
                <div>
                  <p className="font-bold text-primary text-sm">Select or Create a Story Arc</p>
                  <p className="text-xs text-muted max-w-sm mx-auto mt-1">
                    Select an existing reading order from the sidebar, or click "New Arc" to create a new universe playlist.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
