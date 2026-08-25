import { createBrowserRouter } from 'react-router';
import { AppLayout } from './layouts/AppLayout';
import { LibraryPage } from './pages/LibraryPage';
import { BrowsePage } from './pages/BrowsePage';
import { SourcesPage } from './pages/SourcesPage';
import { AutoUpdatePage } from './pages/AutoUpdatePage';
import { DuplicatesPage } from './pages/DuplicatesPage';
import { OpenApiPage } from './pages/OpenApiPage';
import { ReaderPage } from './pages/ReaderPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <LibraryPage /> },
      { path: 'browse', element: <BrowsePage /> },
      { path: 'sources', element: <SourcesPage /> },
      { path: 'autoupdate', element: <AutoUpdatePage /> },
      { path: 'duplicates', element: <DuplicatesPage /> },
      { path: 'openapi', element: <OpenApiPage /> },
      { path: 'reader/:id/:chapter?', element: <ReaderPage /> },
    ],
  },
]);
