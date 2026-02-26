/**
 * ImportDropZone — empty state with drag-and-drop
 */
import { useLibraryStore } from "@/stores/library-store";
import { Upload } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export function ImportDropZone() {
  const { t } = useTranslation();
  const [isDragging, setIsDragging] = useState(false);
  const addBook = useLibraryStore((s) => s.addBook);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const importFromFiles = useCallback(
    (files: FileList | File[]) => {
      const epubFiles = Array.from(files).filter((f) => f.name.endsWith(".epub"));
      for (const file of epubFiles) {
        addBook({
          id: crypto.randomUUID(),
          filePath: (file as File & { path?: string }).path || file.name,
          meta: { title: file.name.replace(".epub", ""), author: "" },
          progress: 0,
          isVectorized: false,
          vectorizeProgress: 0,
          tags: [],
          addedAt: Date.now(),
          lastOpenedAt: Date.now(),
        });
      }
    },
    [addBook],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      importFromFiles(e.dataTransfer.files);
    },
    [importFromFiles],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
        importFromFiles(e.target.files);
        e.target.value = "";
      }
    },
    [importFromFiles],
  );

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="flex h-full flex-col items-center justify-center p-8">
      <input
        ref={fileInputRef}
        type="file"
        accept=".epub"
        multiple
        className="hidden"
        onChange={handleFileSelect}
      />
      <div className="w-full max-w-md text-center">
        <p className="mb-8 text-lg text-muted-foreground">{t("home.emptyLibrary")}</p>

        <div
          className={`rounded-2xl border-2 border-dashed p-12 transition-colors ${
            isDragging ? "border-primary bg-primary/5" : "border-border bg-muted/30"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-neutral-200">
            <Upload className="h-7 w-7 text-neutral-500" />
          </div>
          <p className="mb-1 text-sm font-medium text-neutral-700">{t("home.dropToUpload")}</p>
          <p className="mb-4 text-xs text-muted-foreground">{t("home.supportedFormat")}</p>
          <button
            type="button"
            onClick={handleImportClick}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("home.importBooks")}
          </button>
        </div>
      </div>
    </div>
  );
}
