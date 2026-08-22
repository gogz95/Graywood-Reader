import React, { useState } from 'react';
import { apiFetch } from '../utils/api';
import { UserCategory } from '../types';
import {
  X,
  Plus,
  Trash2,
  Edit2,
  Check,
  Bookmark,
  Flame,
  Heart,
  Star,
  Sparkles,
  Book,
  Folder,
  Clock,
  CheckCircle,
  Trophy,
  Coffee,
  Eye,
  Shield,
  Zap,
  Layers,
  ArrowUp,
  ArrowDown,
  Loader2,
} from 'lucide-react';

export const SHELF_ICONS: Record<string, React.ReactNode> = {
  Bookmark: <Bookmark className="w-4 h-4" />,
  Flame: <Flame className="w-4 h-4" />,
  Heart: <Heart className="w-4 h-4" />,
  Star: <Star className="w-4 h-4" />,
  Sparkles: <Sparkles className="w-4 h-4" />,
  Book: <Book className="w-4 h-4" />,
  Folder: <Folder className="w-4 h-4" />,
  Clock: <Clock className="w-4 h-4" />,
  CheckCircle: <CheckCircle className="w-4 h-4" />,
  Trophy: <Trophy className="w-4 h-4" />,
  Coffee: <Coffee className="w-4 h-4" />,
  Eye: <Eye className="w-4 h-4" />,
  Shield: <Shield className="w-4 h-4" />,
  Zap: <Zap className="w-4 h-4" />,
  Layers: <Layers className="w-4 h-4" />,
};

export const SHELF_COLORS = [
  { name: 'Amber', hex: '#f59e0b', bg: 'bg-amber-500' },
  { name: 'Rose', hex: '#f43f5e', bg: 'bg-rose-500' },
  { name: 'Emerald', hex: '#10b981', bg: 'bg-emerald-500' },
  { name: 'Purple', hex: '#a855f7', bg: 'bg-purple-500' },
  { name: 'Sky', hex: '#0ea5e9', bg: 'bg-sky-500' },
  { name: 'Cyan', hex: '#06b6d4', bg: 'bg-cyan-500' },
  { name: 'Indigo', hex: '#6366f1', bg: 'bg-indigo-500' },
  { name: 'Orange', hex: '#f97316', bg: 'bg-orange-500' },
  { name: 'Pink', hex: '#ec4899', bg: 'bg-pink-500' },
  { name: 'Teal', hex: '#14b8a6', bg: 'bg-teal-500' },
];

export function renderCategoryIcon(iconName?: string, className = 'w-4 h-4'): React.ReactNode {
  const IconComponent = iconName && SHELF_ICONS[iconName] ? SHELF_ICONS[iconName] : <Bookmark className={className} />;
  return IconComponent;
}

interface ManageCategoriesModalProps {
  categories: UserCategory[];
  isOpen: boolean;
  onClose: () => void;
  onCategoriesChanged: (updated: UserCategory[]) => void;
}

export const ManageCategoriesModal: React.FC<ManageCategoriesModalProps> = ({
  categories,
  isOpen,
  onClose,
  onCategoriesChanged,
}) => {
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form State
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedColor, setSelectedColor] = useState(SHELF_COLORS[0].hex);
  const [selectedIcon, setSelectedIcon] = useState('Bookmark');
  const [isDynamic, setIsDynamic] = useState(false);
  const [ruleType, setRuleType] = useState<UserCategory['ruleType']>('unread');
  const [ruleValue, setRuleValue] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const resetForm = () => {
    setName('');
    setDescription('');
    setSelectedColor(SHELF_COLORS[0].hex);
    setSelectedIcon('Bookmark');
    setIsDynamic(false);
    setRuleType('unread');
    setRuleValue('');
    setIsCreating(false);
    setEditingId(null);
    setErrorMsg(null);
  };

  const handleStartEdit = (cat: UserCategory) => {
    setEditingId(cat.id);
    setName(cat.name);
    setDescription(cat.description || '');
    setSelectedColor(cat.color || SHELF_COLORS[0].hex);
    setSelectedIcon(cat.icon || 'Bookmark');
    setIsDynamic(Boolean(cat.isDynamic));
    setRuleType(cat.ruleType || 'unread');
    setRuleValue(cat.ruleValue !== undefined ? String(cat.ruleValue) : '');
    setIsCreating(false);
    setErrorMsg(null);
  };

  const handleApplyPreset = (presetName: string, icon: string, color: string, rType: UserCategory['ruleType'], rVal: string = '') => {
    setName(presetName);
    setDescription(`Smart Dynamic Shelf: ${presetName}`);
    setSelectedIcon(icon);
    setSelectedColor(color);
    setIsDynamic(true);
    setRuleType(rType);
    setRuleValue(rVal);
    setIsCreating(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrorMsg('Please enter a shelf name.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      if (editingId) {
        // Update existing category
        const res = await apiFetch(`/api/categories/${editingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            description: description.trim() || undefined,
            color: selectedColor,
            icon: selectedIcon,
            isDynamic,
            ruleType: isDynamic ? ruleType : undefined,
            ruleValue: isDynamic && ruleValue ? ruleValue : undefined,
          }),
        });

        if (res.ok) {
          const updatedCat = await res.json();
          const newList = categories.map((c) => (c.id === editingId ? { ...c, ...updatedCat } : c));
          onCategoriesChanged(newList);
          resetForm();
        } else {
          const err = await res.json().catch(() => ({}));
          setErrorMsg(err.error || 'Failed to update category');
        }
      } else {
        // Create new category
        const res = await apiFetch('/api/categories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            description: description.trim() || undefined,
            color: selectedColor,
            icon: selectedIcon,
            sortOrder: categories.length,
            isDynamic,
            ruleType: isDynamic ? ruleType : undefined,
            ruleValue: isDynamic && ruleValue ? ruleValue : undefined,
          }),
        });

        if (res.ok) {
          const newCat = await res.json();
          onCategoriesChanged([...categories, newCat]);
          resetForm();
        } else {
          const err = await res.json().catch(() => ({}));
          setErrorMsg(err.error || 'Failed to create category');
        }
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Network error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this custom shelf? (Manga series will not be deleted).')) {
      return;
    }

    try {
      const res = await apiFetch(`/api/categories/${id}`, { method: 'DELETE' });
      if (res.ok) {
        onCategoriesChanged(categories.filter((c) => c.id !== id));
        if (editingId === id) resetForm();
      }
    } catch (err: any) {
      alert(`Failed to delete category: ${err.message}`);
    }
  };

  const handleMoveOrder = async (index: number, direction: 'up' | 'down') => {
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= categories.length) return;

    const reordered = [...categories];
    const temp = reordered[index];
    reordered[index] = reordered[targetIdx];
    reordered[targetIdx] = temp;

    // Update sortOrder on client
    const updated = reordered.map((c, idx) => ({ ...c, sortOrder: idx }));
    onCategoriesChanged(updated);

    // Sync to server
    for (const cat of updated) {
      apiFetch(`/api/categories/${cat.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sortOrder: cat.sortOrder }),
      }).catch(() => {});
    }
  };

  if (!isOpen) return null;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[110] bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto animate-in fade-in duration-200"
    >
      <div className="relative bg-surface border border-edge rounded-t-3xl sm:rounded-3xl max-w-xl w-full max-h-[90vh] overflow-hidden shadow-2xl flex flex-col my-0 sm:my-auto">
        
        {/* Header */}
        <div className="p-5 bg-gradient-to-r from-app via-surface to-app border-b border-edge flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-accent/15 text-accent border border-accent/20 shadow-md">
              <Folder className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-black text-primary flex items-center gap-2">
                Custom Shelves & Categories
              </h3>
              <p className="text-xs text-secondary">
                Organize your library with custom shelves, colors, and icons
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-elevated/80 text-secondary hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {errorMsg && (
            <div className="p-3 bg-danger/10 border border-danger/30 rounded-xl text-xs text-danger">
              {errorMsg}
            </div>
          )}

          {/* Form when Creating or Editing */}
          {(isCreating || editingId) ? (
            <form onSubmit={handleSave} className="p-4 bg-app/80 border border-edge rounded-2xl space-y-4 shadow-inner">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wider text-primary">
                  {editingId ? 'Edit Shelf' : 'Create New Shelf'}
                </h4>
                <button
                  type="button"
                  onClick={resetForm}
                  className="text-xs text-muted hover:text-primary transition-colors"
                >
                  Cancel
                </button>
              </div>

              <div>
                <label className="block text-xs font-bold text-secondary mb-1">
                  Shelf Name *
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Currently Reading, Weekend Binge, Masterpieces..."
                  className="w-full bg-surface border border-edge rounded-xl px-3.5 py-2 text-xs sm:text-sm text-primary placeholder-muted focus:outline-none focus:border-accent shadow-inner"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-secondary mb-1">
                  Description (Optional)
                </label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Short description for this shelf..."
                  className="w-full bg-surface border border-edge rounded-xl px-3.5 py-2 text-xs sm:text-sm text-primary placeholder-muted focus:outline-none focus:border-accent shadow-inner"
                />
              </div>

              {/* Color Picker */}
              <div>
                <label className="block text-xs font-bold text-secondary mb-1.5">
                  Shelf Color
                </label>
                <div className="flex flex-wrap gap-2">
                  {SHELF_COLORS.map((c) => (
                    <button
                      key={c.hex}
                      type="button"
                      onClick={() => setSelectedColor(c.hex)}
                      className={`w-7 h-7 rounded-xl ${c.bg} flex items-center justify-center transition-transform ${
                        selectedColor === c.hex ? 'scale-110 ring-2 ring-white ring-offset-2 ring-offset-surface' : 'opacity-70 hover:opacity-100'
                      }`}
                      title={c.name}
                    >
                      {selectedColor === c.hex && <Check className="w-3.5 h-3.5 text-white" />}
                    </button>
                  ))}
                </div>
              </div>

              {/* Icon Picker */}
              <div>
                <label className="block text-xs font-bold text-secondary mb-1.5">
                  Shelf Icon
                </label>
                <div className="grid grid-cols-5 sm:grid-cols-8 gap-2">
                  {Object.entries(SHELF_ICONS).map(([iconKey, iconNode]) => (
                    <button
                      key={iconKey}
                      type="button"
                      onClick={() => setSelectedIcon(iconKey)}
                      className={`p-2.5 rounded-xl border flex items-center justify-center transition-all ${
                        selectedIcon === iconKey
                          ? 'bg-accent/20 border-accent text-accent shadow-sm'
                          : 'bg-surface border-edge text-secondary hover:text-primary hover:bg-elevated'
                      }`}
                      title={iconKey}
                    >
                      {iconNode}
                    </button>
                  ))}
                </div>
              </div>

              {/* Smart Dynamic Shelf Toggle & Rules */}
              <div className="p-3 bg-surface/90 border border-edge rounded-xl space-y-3">
                <label className="flex items-center justify-between cursor-pointer">
                  <div className="space-y-0.5">
                    <div className="text-xs font-bold text-primary flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-accent" />
                      Smart Dynamic Shelf (Auto-Filter Rule)
                    </div>
                    <div className="text-[10px] text-secondary">
                      Automatically populates series based on rules rather than manual assignment
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={isDynamic}
                    onChange={(e) => setIsDynamic(e.target.checked)}
                    className="w-4 h-4 accent-accent"
                  />
                </label>

                {isDynamic && (
                  <div className="pt-2 border-t border-edge space-y-2">
                    <label className="block text-xs font-bold text-secondary">
                      Filter Rule
                    </label>
                    <select
                      value={ruleType}
                      onChange={(e) => setRuleType(e.target.value as any)}
                      className="w-full bg-app border border-edge rounded-xl px-3 py-2 text-xs text-primary focus:outline-none focus:border-accent"
                    >
                      <option value="unread">⚡ Unread Catch-Up (Chapters Ahead &gt; 0)</option>
                      <option value="in_progress">📖 In Progress (Currently Reading &amp; Ch &gt; 0)</option>
                      <option value="completed">🏆 Completed Masterpieces (Status = Completed)</option>
                      <option value="rating">⭐ Top Tier Series (Rating &gt;= 9.0)</option>
                      <option value="updated_recently">🔥 Updated This Week (Active in past 7 days)</option>
                      <option value="favorites">💖 Star Favorites</option>
                    </select>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-edge">
                <button
                  type="button"
                  onClick={resetForm}
                  className="px-4 py-2 rounded-xl bg-surface hover:bg-elevated text-secondary text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-accent to-accent-2 hover:from-accent-bright hover:to-accent-2 text-accent-fg font-black text-xs flex items-center gap-1.5 shadow-md disabled:opacity-50"
                >
                  {isSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  <span>{editingId ? 'Save Changes' : 'Create Shelf'}</span>
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => {
                  resetForm();
                  setIsCreating(true);
                }}
                className="w-full py-3 rounded-2xl border-2 border-dashed border-edge hover:border-accent/50 text-secondary hover:text-accent font-bold text-xs flex items-center justify-center gap-2 transition-all bg-app/40 hover:bg-app/80"
              >
                <Plus className="w-4 h-4" />
                <span>Create New Custom Shelf</span>
              </button>

              {/* Quick Preset Generators */}
              <div className="p-3 bg-app/60 border border-edge rounded-2xl space-y-2">
                <div className="text-[11px] font-bold text-secondary flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-accent" />
                  Quick-Add Smart Dynamic Shelves:
                </div>
                <div className="flex flex-wrap gap-1.5 text-xs">
                  <button
                    type="button"
                    onClick={() => handleApplyPreset('Unread Catch-Up', 'Zap', '#f97316', 'unread')}
                    className="px-2.5 py-1 rounded-lg bg-surface border border-edge hover:border-accent/40 text-primary hover:text-accent font-semibold transition-all flex items-center gap-1"
                  >
                    <Zap className="w-3 h-3 text-accent" /> Unread Catch-Up
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyPreset('Top Tier Gems', 'Star', '#f59e0b', 'rating', '9.0')}
                    className="px-2.5 py-1 rounded-lg bg-surface border border-edge hover:border-accent/40 text-primary hover:text-accent font-semibold transition-all flex items-center gap-1"
                  >
                    <Star className="w-3 h-3 text-amber-400" /> Top Tier (&gt;=9.0)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyPreset('Updated This Week', 'Flame', '#ef4444', 'updated_recently')}
                    className="px-2.5 py-1 rounded-lg bg-surface border border-edge hover:border-accent/40 text-primary hover:text-accent font-semibold transition-all flex items-center gap-1"
                  >
                    <Flame className="w-3 h-3 text-red-400" /> Updated This Week
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyPreset('Completed Archive', 'Trophy', '#10b981', 'completed')}
                    className="px-2.5 py-1 rounded-lg bg-surface border border-edge hover:border-accent/40 text-primary hover:text-accent font-semibold transition-all flex items-center gap-1"
                  >
                    <Trophy className="w-3 h-3 text-emerald-400" /> Completed
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Shelves List */}
          <div className="space-y-2 pt-2">
            <div className="flex items-center justify-between text-xs text-secondary px-1 font-bold">
              <span>Your Custom Shelves ({categories.length})</span>
            </div>

            {categories.length === 0 ? (
              <div className="py-8 text-center bg-app/30 rounded-2xl border border-edge p-6 space-y-1">
                <Folder className="w-8 h-8 text-muted mx-auto" />
                <p className="text-xs font-bold text-primary">No custom shelves created yet</p>
                <p className="text-[11px] text-secondary">
                  Create custom shelves to organize your series beyond default reading status tabs.
                </p>
              </div>
            ) : (
              categories.map((cat, idx) => (
                <div
                  key={cat.id}
                  className="p-3 bg-app hover:bg-elevated/40 border border-edge rounded-2xl flex items-center justify-between gap-3 transition-all"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 shadow-sm"
                      style={{ backgroundColor: `${cat.color || '#f59e0b'}25`, color: cat.color || '#f59e0b' }}
                    >
                      {renderCategoryIcon(cat.icon)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="text-xs sm:text-sm font-bold text-primary truncate">
                          {cat.name}
                        </h4>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-surface border border-edge text-secondary">
                          {cat.seriesCount || 0} series
                        </span>
                      </div>
                      {cat.description && (
                        <p className="text-[11px] text-muted truncate">
                          {cat.description}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleMoveOrder(idx, 'up')}
                      disabled={idx === 0}
                      className="p-1.5 rounded-lg text-secondary hover:text-primary disabled:opacity-30 transition-colors"
                      title="Move Up"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMoveOrder(idx, 'down')}
                      disabled={idx === categories.length - 1}
                      className="p-1.5 rounded-lg text-secondary hover:text-primary disabled:opacity-30 transition-colors"
                      title="Move Down"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleStartEdit(cat)}
                      className="p-1.5 rounded-lg text-secondary hover:text-accent transition-colors"
                      title="Edit Shelf"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(cat.id)}
                      className="p-1.5 rounded-lg text-secondary hover:text-danger transition-colors"
                      title="Delete Shelf"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-app border-t border-edge flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs shadow-md transition-all hover:bg-accent-bright"
          >
            Done
          </button>
        </div>

      </div>
    </div>
  );
};
