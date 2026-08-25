import React, { useState } from 'react';
import { DuplicateCandidate, DatabaseSyncConfig } from '../../types';
import { DuplicateFinderView } from '../DuplicateFinderView';
import { Globe, Check } from 'lucide-react';

interface DuplicatesSubdomainTabProps {
  isAdmin: boolean;
  activeSubTab: 'duplicates' | 'subdomain';
  renderAdminLockNotice: (feature: string) => React.ReactNode;
  // Duplicate Merger Props
  duplicateCandidates: DuplicateCandidate[];
  onScanDuplicates: () => void;
  isScanningDuplicates: boolean;
  onExecuteMerge: (
    primaryId: string,
    secondaryId: string,
    newTitle: string,
    newAltTitles: string[],
    newGenres: string[],
    newDescription: string
  ) => void;
  // Subdomain Props
  dbConfig: DatabaseSyncConfig;
  onUpdateSubdomain: (subdomain: string) => void;
}

export const DuplicatesSubdomainTab: React.FC<DuplicatesSubdomainTabProps> = ({
  isAdmin,
  activeSubTab,
  renderAdminLockNotice,
  duplicateCandidates,
  onScanDuplicates,
  isScanningDuplicates,
  onExecuteMerge,
  dbConfig,
  onUpdateSubdomain,
}) => {
  const [subdomainInput, setSubdomainInput] = useState(dbConfig.subdomain);
  const [subdomainSaved, setSubdomainSaved] = useState(false);

  const handleSaveSubdomain = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateSubdomain(subdomainInput);
    setSubdomainSaved(true);
    setTimeout(() => setSubdomainSaved(false), 2500);
  };

  if (!isAdmin) {
    return <>{renderAdminLockNotice(activeSubTab === 'duplicates' ? 'Duplicate Series Merger' : 'Tracker Subdomain Routing')}</>;
  }

  if (activeSubTab === 'duplicates') {
    return (
      <DuplicateFinderView
        candidates={duplicateCandidates}
        onScanDuplicates={onScanDuplicates}
        isScanning={isScanningDuplicates}
        onExecuteMerge={onExecuteMerge}
      />
    );
  }

  // Subdomain Tab
  return (
    <div className="space-y-6 text-xs sm:text-sm">
      <div className="p-5 bg-app rounded-2xl border border-edge space-y-4">
        <div>
          <div className="font-bold text-primary text-sm flex items-center gap-2 mb-1">
            <Globe className="w-4 h-4 text-info" />
            Custom Subdomain Configuration
          </div>
          <p className="text-secondary text-xs">Set the custom tracker domain for your personal reader deployment.</p>
        </div>
        <form onSubmit={handleSaveSubdomain} className="flex gap-3">
          <input
            type="text"
            value={subdomainInput}
            onChange={(e) => setSubdomainInput(e.target.value)}
            placeholder="tracker.yoursite.app"
            className="flex-1 bg-surface border border-edge-strong rounded-xl px-4 py-2.5 text-sm text-primary font-mono focus:outline-none focus:ring-2 focus:ring-info/50 transition-all"
          />
          <button
            type="submit"
            className="px-5 sm:px-6 py-2.5 sm:py-3 rounded-xl bg-info hover:bg-info text-white font-bold text-xs sm:text-sm flex items-center gap-2 shadow-lg transition-all hover:scale-105 cursor-pointer"
          >
            <Check className="w-4 h-4 sm:w-5 sm:h-5 stroke-[3]" />
            Save Domain
          </button>
        </form>
        {subdomainSaved && (
          <div className="flex items-center gap-2 text-success font-bold text-xs animate-pulse">
            <Check className="w-3.5 h-3.5" />
            Subdomain updated successfully!
          </div>
        )}
      </div>
    </div>
  );
};
