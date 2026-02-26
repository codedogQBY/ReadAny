import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
/**
 * VectorTestDialog — 4-tab dialog for testing vectorization quality
 * Tabs: Chunks, Vector Search, BM25 Search, Hybrid Search
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";

type TestTab = "chunks" | "vector" | "bm25" | "hybrid";

interface VectorTestDialogProps {
  bookId: string;
  open: boolean;
  onClose: () => void;
}

const TAB_IDS: TestTab[] = ["chunks", "vector", "bm25", "hybrid"];
const TAB_KEYS: Record<TestTab, string> = {
  chunks: "vectorize.chunks",
  vector: "vectorize.vector",
  bm25: "vectorize.bm25",
  hybrid: "vectorize.hybrid",
};

export function VectorTestDialog({ bookId: _bookId, open, onClose }: VectorTestDialogProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TestTab>("chunks");
  const [query, setQuery] = useState("");

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="flex h-[80vh] w-[800px] flex-col overflow-hidden rounded-lg border border-border bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="font-medium">{t("vectorize.title")}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            ✕
          </button>
        </div>

        <div className="flex border-b border-border">
          {TAB_IDS.map((id) => (
            <button
              key={id}
              className={`flex-1 py-2 text-center text-sm transition-colors ${
                activeTab === id
                  ? "border-b-2 border-primary font-medium"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setActiveTab(id)}
            >
              {t(TAB_KEYS[id])}
            </button>
          ))}
        </div>

        {activeTab !== "chunks" && (
          <div className="flex gap-2 border-b border-border p-3">
            <Input
              placeholder={t("vectorize.searchPlaceholder")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1"
            />
            <Button size="sm">{t("vectorize.search")}</Button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4">
          <p className="text-sm text-muted-foreground">
            {activeTab === "chunks"
              ? t("vectorize.showingChunks")
              : t("vectorize.searchResults", { tab: activeTab })}
          </p>
        </div>
      </div>
    </div>
  );
}
