import React from 'react';
import { ReadingStatus, UserCategory } from '../../types';
import { apiFetch } from '../../utils/api';
import { Check, Trash2 } from 'lucide-react';

interface LibraryBatchBarProps {
  selectedIds: Set<string>;
  totalCount: number;
  categories: UserCategory[];
  onSelectAll: () => void;
  onClearSelection: () => void;
  onBulkUpdateStatus?: (ids: string[], status: ReadingStatus) => void;
  onBulkDelete?: (ids: string[]) => void;
  onRefreshCategories: () => void;
}

export const LibraryBatchBar: React.FC<LibraryBatchBarProps> = ({
  selectedIds,
  totalCount,
  categories,
  onSelectAll,
  onClearSelection,
  onBulkUpdateStatus,
  onBulkDelete,
  onRefreshCategories,
}) => {
  if (selectedIds.size === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-surface/95 backdrop-blur-md border border-edge-strong rounded-2xl shadow-2xl p-3 px-5 flex flex-wrap items-center justify-center gap-3">
      <div className="flex items-center gap-2 pr-3 border-r border-edge">
        <span className="w-6 h-6 rounded-full bg-accent text-accent-fg font-black text-xs flex items-center justify-center">
          {selectedIds.size}
        </span>
        <span className="text-xs font-bold text-primary">Selected</span>
      </div>

      <button
        onClick={onSelectAll}
        className="px-3 py-1.5 rounded-xl bg-elevated hover:bg-elevated text-secondary hover:text-primary font-bold text-xs transition-all cursor-pointer"
      >
        {selectedIds.size === totalCount ? 'Deselect All' : 'Select All'}
      </button>

      {/* Bulk Mark Read */}
      <button
        onClick={() => {
          if (onBulkUpdateStatus) {
            onBulkUpdateStatus(Array.from(selectedIds), 'completed');
            onClearSelection();
          }
        }}
        className="px-3.5 py-1.5 rounded-xl bg-success/20 hover:bg-success/30 text-success border border-success/30 font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer"
      >
        <Check className="w-3.5 h-3.5" />
        <span>Mark as Read</span>
      </button>

      {/* Bulk Status Select */}
      <select
        onChange={(e) => {
          if (e.target.value && onBulkUpdateStatus) {
            onBulkUpdateStatus(Array.from(selectedIds), e.target.value as any);
            onClearSelection();
          }
        }}
        defaultValue=""
        className="bg-app border border-edge rounded-xl px-3 py-1.5 text-xs text-primary font-bold focus:outline-none"
      >
        <option value="" disabled>Set Status...</option>
        <option value="reading">Reading</option>
        <option value="completed">Completed</option>
        <option value="plan_to_read">Plan to Read</option>
        <option value="on_hold">On Hold</option>
        <option value="dropped">Dropped</option>
      </select>

      {/* Bulk Shelf Assignment */}
      {categories.length > 0 && (
        <select
          onChange={async (e) => {
            const catId = e.target.value;
            if (catId) {
              try {
                await apiFetch('/api/categories/bulk-assign', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    mangaIds: Array.from(selectedIds),
                    categoryId: catId,
                    action: 'add',
                  }),
                });
                onRefreshCategories();
                onClearSelection();
              } catch {}
            }
          }}
          defaultValue=""
          className="bg-app border border-edge rounded-xl px-3 py-1.5 text-xs text-primary font-bold focus:outline-none"
        >
          <option value="" disabled>Add to Shelf...</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id}>
              📁 {cat.name}
            </option>
          ))}
        </select>
      )}

      {/* Bulk Delete */}
      <button
        onClick={() => {
          if (onBulkDelete) {
            onBulkDelete(Array.from(selectedIds));
            onClearSelection();
          }
        }}
        className="px-3.5 py-1.5 rounded-xl bg-danger/20 hover:bg-danger/30 text-danger border border-danger/30 font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer"
      >
        <Trash2 className="w-3.5 h-3.5" />
        <span>Delete Selected</span>
      </button>

      {/* Done */}
      <button
        onClick={onClearSelection}
        className="px-3 py-1.5 rounded-xl bg-elevated hover:bg-elevated text-secondary hover:text-white text-xs font-bold cursor-pointer"
      >
        Done
      </button>
    </div>
  );
};
