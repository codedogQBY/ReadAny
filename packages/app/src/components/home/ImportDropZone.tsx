/**
 * ImportDropZone — empty state with import button and drag-drop
 */
import { useLibraryStore } from "@/stores/library-store";
import { open } from "@tauri-apps/plugin-dialog";
import { Upload } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

export function ImportDropZone() {
  const { t } = useTranslation();
  const [isDragging, setIsDragging] = useState(false);
  const importBooks = useLibraryStore((s) => s.importBooks);

  const handleImportClick = useCallback(async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [{ name: "Books", extensions: ["epub", "pdf"] }],
      } as const);
      if (selected) {
        const paths = Array.isArray(selected) ? selected : [selected];
        if (paths.length > 0) {
          await importBooks(paths);
        }
      }
    } catch {
      // User cancelled
    }
  }, [importBooks]);

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
          if (ext === "epub" || ext === "pdf") {
            paths.push(f.path);
          }
        }
      }
      if (paths.length > 0) {
        await importBooks(paths);
      }
    },
    [importBooks],
  );

  return (
    <div className="flex h-full flex-col items-center justify-center p-8">
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
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center">
            <img src="/logo.svg" alt="" className="h-16 w-16" />
          </div>
          <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-neutral-200">
            <Upload className="h-5 w-5 text-neutral-500" />
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
