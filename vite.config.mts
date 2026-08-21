import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(process.cwd(), '.'),
      },
    },
    build: {
      target: 'esnext',
      minify: 'esbuild',
      cssMinify: true,
      sourcemap: false,
      reportCompressedSize: true,
      cssCodeSplit: true,
      assetsInlineLimit: 4096,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) {
              return 'react-vendor';
            }
            if (id.includes('node_modules/lucide-react')) {
              return 'lucide-icons';
            }
            if (id.includes('node_modules/motion')) {
              return 'motion-animations';
            }
            // Split heavy view components into their own async chunks
            if (id.includes('src/components/ReaderView')) {
              return 'reader-view';
            }
            if (id.includes('src/components/KotatsuSourcesView')) {
              return 'sources-view';
            }
            if (id.includes('src/components/BrowseView')) {
              return 'browse-view';
            }
            if (id.includes('src/components/SettingsModal')) {
              return 'settings-modal';
            }
            if (id.includes('src/components/MetadataStudioModal')) {
              return 'metadata-studio';
            }
            if (id.includes('src/components/AchievementsModal')) {
              return 'achievements-modal';
            }
            if (id.includes('src/components/AdminPanelModal')) {
              return 'admin-panel-modal';
            }
          },
        },
      },
    },
    server: {
      watch: {
        ignored: ['**/database.json*', '**/*.tmp', '**/*.log', '**/node_modules/**', '**/.git/**'],
      },
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
