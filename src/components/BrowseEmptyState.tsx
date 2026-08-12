import React from 'react';
import { BookOpen } from 'lucide-react';

interface Props {
  onReset: () => void;
}

export const BrowseEmptyState: React.FC<Props> = ({ onReset }) => (
  <div className="bg-surface border border-edge rounded-3xl p-12 text-center space-y-3">
    <div className="w-12 h-12 rounded-2xl bg-app border border-edge text-muted flex items-center justify-center mx-auto">
      <BookOpen className="w-6 h-6" />
    </div>
    <h3 className="text-base font-extrabold text-primary">No Matching Series Found</h3>
    <p className="text-xs text-secondary max-w-sm mx-auto">
      No series in your catalog match the current filters. Try resetting filters or adding new series!
    </p>
    <button
      onClick={onReset}
      className="px-4 py-2 rounded-xl bg-accent hover:bg-accent-bright text-accent-fg font-bold text-xs"
    >
      Reset Filters
    </button>
  </div>
);
