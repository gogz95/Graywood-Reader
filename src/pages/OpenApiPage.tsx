import { OpenApiFinderView } from '../components/OpenApiFinderView';
import { useLibraryStore } from '../stores';

export function OpenApiPage() {
  const { mangaList, addFromOpenApi } = useLibraryStore();

  return (
    <OpenApiFinderView
      existingIds={mangaList.map((m) => m.id)}
      existingTitles={mangaList.map((m) => m.title)}
      onAddFromOpenApi={addFromOpenApi}
    />
  );
}
