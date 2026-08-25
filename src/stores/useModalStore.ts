import { create } from 'zustand';
import type { MangaItem } from '../types';
import type { BugReportInitialData } from '../components/SubmitBugModal';

// ============================================================================
// useModalStore — Centralized modal visibility management (Zustand)
// Replaces ~15 individual boolean useState togglers from App.tsx
// ============================================================================

export type ModalName =
  | 'addEdit'
  | 'settings'
  | 'auth'
  | 'userProfile'
  | 'adminPanel'
  | 'submitBug'
  | 'analytics'
  | 'achievements'
  | 'extensionManager'
  | 'commandPalette'
  | 'setupWizard'
  | 'bulkScrape'
  | 'downloadManager'
  | 'readlists'
  | 'challenges';

interface ModalData {
  /** Manga being edited in AddEditModal */
  editingManga: MangaItem | null;
  /** Pre-filled data for SubmitBugModal */
  bugReportInitialData: BugReportInitialData | undefined;
  /** Auth modal mode */
  authModalMode: 'login' | 'register';
}

interface ModalStore {
  /** Set of currently open modal names */
  openModals: Set<ModalName>;
  /** Typed data bag associated with specific modals */
  data: ModalData;

  /** Open a modal by name */
  openModal: (name: ModalName) => void;
  /** Close a modal by name */
  closeModal: (name: ModalName) => void;
  /** Check if a modal is open */
  isOpen: (name: ModalName) => boolean;
  /** Update modal data fields */
  setModalData: (updates: Partial<ModalData>) => void;
}

export const useModalStore = create<ModalStore>((set, get) => ({
  openModals: new Set(),
  data: {
    editingManga: null,
    bugReportInitialData: undefined,
    authModalMode: 'login',
  },

  openModal: (name) =>
    set((state) => {
      const next = new Set(state.openModals);
      next.add(name);
      return { openModals: next };
    }),

  closeModal: (name) =>
    set((state) => {
      const next = new Set(state.openModals);
      next.delete(name);
      return { openModals: next };
    }),

  isOpen: (name) => get().openModals.has(name),

  setModalData: (updates) =>
    set((state) => ({
      data: { ...state.data, ...updates },
    })),
}));
