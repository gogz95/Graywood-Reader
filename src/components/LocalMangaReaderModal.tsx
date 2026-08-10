import React, { useState } from 'react';
import { MangaItem } from '../types';
import { X, Upload, FileArchive, Folder, Image, Play, CheckCircle, Sparkles } from 'lucide-react';

interface LocalMangaReaderModalProps {
  onClose: () => void;
  onOpenCustomPagesReader: (title: string, pages: string[]) => void;
}

export const LocalMangaReaderModal: React.FC<LocalMangaReaderModalProps> = ({
  onClose,
  onOpenCustomPagesReader,
}) => {
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [extractedPages, setExtractedPages] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setLoading(true);
    const fileList: File[] = Array.from(files);
    setSelectedFileName(fileList.length === 1 ? fileList[0].name : `${fileList.length} image files`);

    const imageUrls: string[] = [];
    let processed = 0;

    fileList.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          imageUrls.push(event.target.result as string);
        }
        processed++;
        if (processed === fileList.length) {
          // Sort filenames numerically if possible
          setExtractedPages(imageUrls);
          setLoading(false);
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const handleLaunchReader = () => {
    if (extractedPages.length > 0) {
      onOpenCustomPagesReader(selectedFileName || 'Local Manga Archive', extractedPages);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-xl w-full p-6 space-y-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="font-black text-slate-100 text-base flex items-center gap-2">
            <FileArchive className="w-5 h-5 text-amber-400" />
            Local Offline CBZ / ZIP / Folder Reader
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4 text-xs text-slate-300">
          <p className="text-slate-400">
            Select or drag and drop your local <strong className="text-slate-200">.cbz, .zip, or image folders</strong> to read directly inside the Kotatsu reader canvas offline.
          </p>

          {/* Upload Dropzone */}
          <label className="border-2 border-dashed border-slate-700 hover:border-amber-500 rounded-2xl p-8 flex flex-col items-center justify-center gap-3 cursor-pointer bg-slate-950/60 hover:bg-slate-950 transition-all text-center">
            <div className="p-3 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <Upload className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <div className="font-bold text-slate-100 text-sm">
                Click to browse or drop local manga files
              </div>
              <div className="text-slate-400">
                Supports CBZ archives, ZIP files, JPG, PNG, WEBP images
              </div>
            </div>
            <input
              type="file"
              multiple
              accept="image/*,.cbz,.zip"
              onChange={handleFileUpload}
              className="hidden"
            />
          </label>

          {/* Processing Status */}
          {loading && (
            <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 flex items-center gap-3">
              <div className="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
              <span className="font-semibold text-slate-300">Extracting local manga pages...</span>
            </div>
          )}

          {extractedPages.length > 0 && !loading && (
            <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl space-y-2 text-emerald-300">
              <div className="flex items-center gap-2 font-bold text-sm">
                <CheckCircle className="w-4 h-4" />
                <span>Ready: {selectedFileName} ({extractedPages.length} Pages Extracted)</span>
              </div>
              <p className="text-[11px] text-emerald-400/80">
                All pages processed into memory. Ready to launch with full auto-scroll, color filters, and OLED mode.
              </p>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 border-t border-slate-800 pt-4">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs"
          >
            Cancel
          </button>

          <button
            disabled={extractedPages.length === 0}
            onClick={handleLaunchReader}
            className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 disabled:opacity-30 text-slate-950 font-black text-xs flex items-center gap-2 shadow-lg transition-all"
          >
            <Play className="w-4 h-4 fill-slate-950" />
            <span>Open in Kotatsu Reader</span>
          </button>
        </div>
      </div>
    </div>
  );
};
