import { AutoUpdateView } from '../components/AutoUpdateView';
import {
  useLibraryStore,
  useDisplayMangaList,
} from '../stores';

export function AutoUpdatePage() {
  const { logs, config, isUpdating, runAutoUpdate } = useLibraryStore();
  const displayMangaList = useDisplayMangaList();

  return (
    <AutoUpdateView
      logs={logs}
      config={config}
      mangaList={displayMangaList}
      onRunAutoUpdate={runAutoUpdate}
      isUpdating={isUpdating}
    />
  );
}
