import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
/**
 * VectorTestDialog — 4-tab dialog for testing vectorization quality
 * Tabs: Chunks, Vector Search, BM25 Search, Hybrid Search
 */
import { useState } from "react";

type TestTab = "chunks" | "vector" | "bm25" | "hybrid";

interface VectorTestDialogProps {
  bookId: string;
  open: boolean;
  onClose: () => void;
}

export function VectorTestDialog({ bookId: _bookId, open, onClose }: VectorTestDialogProps) {
  const [activeTab, setActiveTab] = useState<TestTab>("chunks");
  const [query, setQuery] = useState("");

  if (!open) return null;

  const tabs: Array<{ id: TestTab; label: string }> = [
    { id: "chunks", label: "Chunks" },
    { id: "vector", label: "Vector" },
    { id: "bm25", label: "BM25" },
    { id: "hybrid", label: "Hybrid" },
  ];

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
          <h3 className="font-medium">Vector Test</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            ✕
          </button>
        </div>

        <div className="flex border-b border-border">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`flex-1 py-2 text-center text-sm transition-colors ${
                activeTab === tab.id
                  ? "border-b-2 border-primary font-medium"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab !== "chunks" && (
          <div className="flex gap-2 border-b border-border p-3">
            <Input
              placeholder="Enter search query..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1"
            />
            <Button size="sm">Search</Button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4">
          <p className="text-sm text-muted-foreground">
            {activeTab === "chunks"
              ? "Showing all chunks for this book..."
              : `${activeTab} search results will appear here.`}
          </p>
        </div>
      </div>
    </div>
  );
}
