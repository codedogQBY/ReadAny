import { Input } from "@/components/ui/input";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
/**
 * SearchBar — in-book search
 */
import { useState } from "react";

interface SearchBarProps {
  onSearch: (query: string) => void;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
  resultCount: number;
  currentIndex: number;
}

export function SearchBar({
  onSearch,
  onNext,
  onPrev,
  onClose,
  resultCount,
  currentIndex,
}: SearchBarProps) {
  const [query, setQuery] = useState("");

  return (
    <div className="flex items-center gap-2 border-b border-border bg-background px-4 py-2">
      <Search className="h-4 w-4 text-muted-foreground" />
      <Input
        placeholder="Search in book..."
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          onSearch(e.target.value);
        }}
        className="h-7 flex-1"
        autoFocus
      />
      {resultCount > 0 && (
        <span className="text-xs text-muted-foreground">
          {currentIndex + 1} / {resultCount}
        </span>
      )}
      <button onClick={onPrev} className="p-1 hover:bg-muted rounded">
        <ChevronUp className="h-4 w-4" />
      </button>
      <button onClick={onNext} className="p-1 hover:bg-muted rounded">
        <ChevronDown className="h-4 w-4" />
      </button>
      <button onClick={onClose} className="p-1 hover:bg-muted rounded">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
