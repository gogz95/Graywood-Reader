import { useState, useCallback, useMemo, useEffect } from 'react';
import { apiFetch } from '../utils/api';
import { PageStickyNote } from '../types';

interface UseReaderStickyNotesProps {
  mangaId: string;
  currentChapterNum: number;
  triggerToast: (msg: string) => void;
}

export function useReaderStickyNotes({
  mangaId,
  currentChapterNum,
  triggerToast,
}: UseReaderStickyNotesProps) {
  const [stickyNotes, setStickyNotes] = useState<PageStickyNote[]>([]);
  const [showNotesDrawer, setShowNotesDrawer] = useState<boolean>(false);
  const [activeNoteModal, setActiveNoteModal] = useState<{
    pageIndex: number;
    noteId?: string;
    initialText?: string;
    color?: 'yellow' | 'blue' | 'purple' | 'green';
  } | null>(null);
  const [noteInputText, setNoteInputText] = useState<string>('');
  const [noteInputColor, setNoteInputColor] = useState<'yellow' | 'blue' | 'purple' | 'green'>('yellow');

  // Group sticky notes by pageIndex for fast O(1) in-panel lookup
  const stickyNotesByPage = useMemo(() => {
    const map: Record<number, PageStickyNote[]> = {};
    for (const note of stickyNotes) {
      if (Number(note.chapterNumber) === Number(currentChapterNum)) {
        if (!map[note.pageIndex]) map[note.pageIndex] = [];
        map[note.pageIndex].push(note);
      }
    }
    return map;
  }, [stickyNotes, currentChapterNum]);

  const currentChapterNotes = useMemo(() => {
    return stickyNotes.filter((n) => Number(n.chapterNumber) === Number(currentChapterNum));
  }, [stickyNotes, currentChapterNum]);

  const handleOpenAddNote = useCallback((pageIdx: number) => {
    setNoteInputText('');
    setNoteInputColor('yellow');
    setActiveNoteModal({ pageIndex: pageIdx });
  }, []);

  const handleOpenEditNote = useCallback((note: PageStickyNote) => {
    setNoteInputText(note.noteText);
    setNoteInputColor(note.color || 'yellow');
    setActiveNoteModal({
      pageIndex: note.pageIndex,
      noteId: note.id,
      initialText: note.noteText,
      color: note.color,
    });
  }, []);

  const fetchNotes = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/notes/${encodeURIComponent(mangaId)}`);
      if (res.ok) {
        const data = await res.json();
        setStickyNotes(data || []);
      }
    } catch (_) {}
  }, [mangaId]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  const handleSaveNote = useCallback(async () => {
    if (!activeNoteModal || !noteInputText.trim()) return;
    try {
      const res = await apiFetch('/api/notes', {
        method: 'POST',
        body: JSON.stringify({
          id: activeNoteModal.noteId,
          mangaId,
          chapterNumber: currentChapterNum,
          pageIndex: activeNoteModal.pageIndex,
          noteText: noteInputText.trim(),
          color: noteInputColor,
        }),
      });
      if (res.ok) {
        fetchNotes();
        setActiveNoteModal(null);
        setNoteInputText('');
        triggerToast('Sticky note pinned to page!');
      }
    } catch (err: any) {
      triggerToast(`Failed to save note: ${err?.message || String(err)}`);
    }
  }, [activeNoteModal, noteInputText, noteInputColor, mangaId, currentChapterNum, fetchNotes, triggerToast]);

  const handleDeleteNote = useCallback(async (noteId: string) => {
    try {
      const res = await apiFetch(`/api/notes/${encodeURIComponent(noteId)}`, { method: 'DELETE' });
      if (res.ok) {
        setStickyNotes((prev) => prev.filter((n) => n.id !== noteId));
        triggerToast('Note deleted');
      }
    } catch (err: any) {
      triggerToast(`Failed to delete: ${err?.message || String(err)}`);
    }
  }, [triggerToast]);

  return {
    stickyNotes,
    setStickyNotes,
    showNotesDrawer,
    setShowNotesDrawer,
    activeNoteModal,
    setActiveNoteModal,
    noteInputText,
    setNoteInputText,
    noteInputColor,
    setNoteInputColor,
    stickyNotesByPage,
    currentChapterNotes,
    handleOpenAddNote,
    handleOpenEditNote,
    fetchNotes,
    handleSaveNote,
    handleDeleteNote,
  };
}
