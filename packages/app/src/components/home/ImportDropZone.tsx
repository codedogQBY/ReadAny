/**
 * ImportDropZone — empty state with import button and drag-drop
 */
import { DesktopImportActions } from "@/components/home/DesktopImportActions";
import { useLibraryStore } from "@/stores/library-store";
import { Loader2, Plus } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

export function ImportDropZone() {
  const { t } = useTranslation();
  const [isDragging, setIsDragging] = useState(false);
  const importBooks = useLibraryStore((s) => s.importBooks);
  const isImporting = useLibraryStore((s) => s.isImporting);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      // In Tauri, drag-and-drop provides file paths via the dataTransfer
      const files = e.dataTransfer.files;
      const paths: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i] as File & { path?: string };
        if (f.path) {
          const ext = f.name.split(".").pop()?.toLowerCase();
          if (
            ext === "epub" ||
            ext === "pdf" ||
            ext === "mobi" ||
            ext === "azw" ||
            ext === "azw3" ||
            ext === "fb2" ||
            ext === "fbz" ||
            ext === "txt" ||
            ext === "cbz"
          ) {
            paths.push(f.path);
          }
        }
      }
      if (paths.length > 0) {
        const result = await importBooks(paths);
        toast.success(
          t("library.importResultSummary", {
            imported: result.imported.length,
            skipped: result.skippedDuplicates.length,
            failed: result.failures.length,
          }),
        );
      }
    },
    [importBooks, t],
  );

  return (
    <div className="flex h-full flex-col items-center justify-center p-8">
      <div className="w-full max-w-md text-center">
        <div
          className={`rounded-2xl border-2 border-dashed p-8 transition-colors ${
            isDragging ? "border-primary bg-primary/5" : "border-border bg-muted/30"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          <div className="mx-auto mb-6">
            <img src="/book.svg" alt="" className="h-40 w-40 mx-auto dark:invert" />
          </div>
          <p className="mb-1 text-base font-medium text-foreground">{t("home.emptyLibrary")}</p>
          <p className="mb-4 text-sm text-muted-foreground">{t("home.dropToUpload")}</p>
          <p className="mb-4 text-xs text-muted-foreground/70">{t("home.supportedFormat")}</p>
          <DesktopImportActions align="center">
            <button
              type="button"
              disabled={isImporting}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <span className="flex items-center gap-1.5">
                {isImporting ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                {isImporting ? t("library.importing", "导入中...") : t("home.importBooks")}
              </span>
            </button>
          </DesktopImportActions>
        </div>
      </div>
    </div>
  );
}
