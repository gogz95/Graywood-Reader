import React from 'react';
import { X, StickyNote, Plus, Trash2, Edit2 } from 'lucide-react';
import { PageStickyNote } from '../../types';

export interface StickyNotesDrawerProps {
  showDrawer: boolean;
  stickyNotes: PageStickyNote[];
  currentChapterNum: number;
  currentPageIndex: number;
  activeNoteModal: {
    pageIndex: number;
    noteId?: string;
    initialText?: string;
    color?: 'yellow' | 'blue' | 'purple' | 'green';
  } | null;
  noteInputText: string;
  noteInputColor: 'yellow' | 'blue' | 'purple' | 'green';
  onCloseDrawer: () => void;
  onOpenAddModal: (pageIndex: number) => void;
  onOpenEditModal: (note: PageStickyNote) => void;
  onCloseModal: () => void;
  onChangeNoteText: (text: string) => void;
  onChangeNoteColor: (color: 'yellow' | 'blue' | 'purple' | 'green') => void;
  onSaveNote: () => void;
  onDeleteNote: (id: string) => void;
  onJumpToNote: (note: PageStickyNote) => void;
}

export const StickyNotesDrawer: React.FC<StickyNotesDrawerProps> = React.memo(({
  showDrawer,
  stickyNotes,
  currentChapterNum,
  currentPageIndex,
  activeNoteModal,
  noteInputText,
  noteInputColor,
  onCloseDrawer,
  onOpenAddModal,
  onOpenEditModal,
  onCloseModal,
  onChangeNoteText,
  onChangeNoteColor,
  onSaveNote,
  onDeleteNote,
  onJumpToNote,
}) => {
  return (
    <>
      {/* SLIDE-OUT DRAWER */}
      {showDrawer && (
        <div className="fixed inset-0 z-50 bg-app/80 backdrop-blur-md flex justify-end">
          <div className="bg-surface border-l border-edge w-full max-w-md h-full flex flex-col shadow-2xl p-5 space-y-4 animate-in slide-in-from-right duration-200">
            <div className="flex items-center justify-between border-b border-edge pb-3">
              <div className="font-black text-primary text-base flex items-center gap-2">
                <StickyNote className="w-5 h-5 text-amber-400" />
                <span>Chapter Notes & Annotations</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-400/20 text-amber-400">
                  {stickyNotes.length} Total
                </span>
              </div>
              <button
                onClick={onCloseDrawer}
                className="p-1.5 rounded-full bg-elevated text-secondary hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center justify-between">
              <button
                onClick={() => onOpenAddModal(currentPageIndex)}
                className="px-3.5 sm:px-4 py-1.5 sm:py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-extrabold text-xs sm:text-sm flex items-center gap-1.5 shadow-md"
              >
                <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[3]" />
                <span>Pin Note to Page {currentPageIndex + 1}</span>
              </button>
            </div>

            {/* Notes List */}
            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
              {stickyNotes.length === 0 ? (
                <div className="h-64 flex flex-col items-center justify-center text-center p-4 text-secondary">
                  <StickyNote className="w-10 h-10 text-muted mb-2 opacity-50" />
                  <p className="font-bold text-xs">No sticky notes yet</p>
                  <p className="text-[11px] text-muted">Press 'N' or tap Pin Note to bookmark thoughts, theories, or favorite panels!</p>
                </div>
              ) : (
                stickyNotes.map((note) => {
                  const isCurrentCh = Number(note.chapterNumber) === Number(currentChapterNum);
                  const colorClass =
                    note.color === 'blue'
                      ? 'bg-blue-950/40 border-blue-500/40 text-blue-200'
                      : note.color === 'purple'
                      ? 'bg-purple-950/40 border-purple-500/40 text-purple-200'
                      : note.color === 'green'
                      ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
                      : 'bg-amber-950/40 border-amber-500/40 text-amber-200';

                  return (
                    <div
                      key={note.id}
                      className={`p-3.5 rounded-xl border space-y-2 transition-all ${colorClass}`}
                    >
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2 font-bold">
                          <span className="px-2 py-0.5 rounded bg-black/40 text-[10px] font-mono">
                            Ch. {note.chapterNumber} • Page {note.pageIndex + 1}
                          </span>
                          {isCurrentCh && (
                            <span className="text-[10px] text-accent font-extrabold">Current Chapter</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => onOpenEditModal(note)}
                            className="p-1 rounded bg-black/30 hover:bg-black/60 text-secondary hover:text-white"
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => onDeleteNote(note.id)}
                            className="p-1 rounded bg-black/30 hover:bg-red-950 text-secondary hover:text-danger"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>

                      <p className="text-xs leading-relaxed font-sans whitespace-pre-wrap">
                        {note.noteText}
                      </p>

                      <div className="pt-1 flex items-center justify-between text-[10px] opacity-70">
                        <span>{new Date(note.updatedAt || note.createdAt).toLocaleDateString()}</span>
                        <button
                          onClick={() => onJumpToNote(note)}
                          className="font-bold underline hover:opacity-100"
                        >
                          Jump to Page →
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* ADD / EDIT MODAL */}
      {activeNoteModal && (
        <div className="fixed inset-0 z-50 bg-app/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface border border-edge rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-edge pb-2.5">
              <div className="font-bold text-primary text-sm flex items-center gap-2">
                <StickyNote className="w-4 h-4 text-amber-400" />
                <span>
                  {activeNoteModal.noteId
                    ? 'Edit Sticky Note'
                    : `Add Sticky Note (Page ${activeNoteModal.pageIndex + 1})`}
                </span>
              </div>
              <button onClick={onCloseModal} className="text-secondary hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <textarea
              rows={4}
              value={noteInputText}
              onChange={(e) => onChangeNoteText(e.target.value)}
              placeholder="Type your notes, impressions, character theories, or key plot points..."
              className="w-full bg-app border border-edge rounded-xl p-3 text-primary text-xs focus:outline-none focus:border-accent resize-none font-sans"
              autoFocus
            />

            {/* Color Selector */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold text-secondary">Color:</span>
                {[
                  { id: 'yellow', bg: 'bg-amber-400' },
                  { id: 'blue', bg: 'bg-blue-400' },
                  { id: 'purple', bg: 'bg-purple-400' },
                  { id: 'green', bg: 'bg-emerald-400' },
                ].map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onChangeNoteColor(c.id as any)}
                    className={`w-6 h-6 rounded-full ${c.bg} transition-all ${
                      noteInputColor === c.id
                        ? 'ring-2 ring-white scale-110 shadow-lg'
                        : 'opacity-60 hover:opacity-100'
                    }`}
                  />
                ))}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onCloseModal}
                  className="px-3.5 sm:px-4 py-1.5 sm:py-2 rounded-xl bg-elevated hover:bg-elevated text-secondary text-xs sm:text-sm font-bold"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={onSaveNote}
                  disabled={!noteInputText.trim()}
                  className="px-4 sm:px-5 py-1.5 sm:py-2 rounded-xl bg-accent hover:bg-accent-bright text-accent-fg text-xs sm:text-sm font-bold shadow-md disabled:opacity-50"
                >
                  Save Note
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
});
