import { DuplicateFinderView } from '../components/DuplicateFinderView';
import { useLibraryStore } from '../stores';

export function DuplicatesPage() {
  const { duplicates, isScanningDuplicates, scanDuplicates, executeMerge, dismissDuplicate } = useLibraryStore();

  return (
    <DuplicateFinderView
      candidates={duplicates}
      onScanDuplicates={scanDuplicates}
      isScanning={isScanningDuplicates}
      onExecuteMerge={executeMerge}
      onDismissDuplicate={dismissDuplicate}
    />
  );
}
