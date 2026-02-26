/**
 * ImportDropZone — drag-and-drop area for importing EPUB files
 */
import { Upload } from "lucide-react";
import { useCallback, useState } from "react";

export function ImportDropZone() {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    // TODO: Handle dropped files — extract paths, call importBooks
    const _files = Array.from(e.dataTransfer.files);
    void _files;
  }, []);

  return (
    <div
      className={`flex flex-1 flex-col items-center justify-center rounded-lg border-2 border-dashed transition-colors ${
        isDragging ? "border-primary bg-primary/5" : "border-border"
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <Upload className="mb-4 h-12 w-12 text-muted-foreground" />
      <p className="mb-2 text-lg font-medium">Drop EPUB files here</p>
      <p className="text-sm text-muted-foreground">or click to browse</p>
    </div>
  );
}
