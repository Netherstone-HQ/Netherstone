import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FileIcon, SearchIcon } from "lucide-react";
import { openEditorFile } from "@/lib/open-editor-file";
import { useUIStore } from "@/store/ui";
import { useVaultStore } from "@/store/vault";
import { HighlightedText, type TextPart } from "./HighlightedText";

interface SearchResult {
  path: string;
  name: string;
  /** The text around the words searched for, which are highlighted. */
  snippet: TextPart[];
  rank: number;
}

/** What the dialog says when a search fails, by the reason the backend gives. */
const SEARCH_ERRORS = {
  unavailable: "Couldn't open the search index. Restart Netherstone and try again.",
  failed: "Search couldn't finish. Try again.",
};

type SearchError = keyof typeof SEARCH_ERRORS;

interface SearchModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SearchModal({ open, onOpenChange }: SearchModalProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<SearchError | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const currentVaultPath = useVaultStore((s) => s.currentVaultPath);

  // Get relative path from vault root, including vault folder name
  const getRelativePath = (absolutePath: string) => {
    if (!currentVaultPath) return absolutePath;

    // Normalize paths for comparison
    const vaultPath = currentVaultPath.replace(/\\/g, "/");
    const filePath = absolutePath.replace(/\\/g, "/");

    if (filePath.startsWith(vaultPath)) {
      // Get vault folder name
      const vaultName = vaultPath.split("/").pop() || "";
      const relativePath = filePath.substring(vaultPath.length + 1);
      return `${vaultName}/${relativePath}`;
    }

    return absolutePath;
  };

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      setSearchError(null);
      setSelectedIndex(0);
    }
  }, [open]);

  // Perform search
  const performSearch = useCallback(async (searchQuery: string) => {
    if (searchQuery.trim().length === 0) {
      setResults([]);
      setSearchError(null);
      return;
    }

    setIsSearching(true);
    setSearchError(null);
    try {
      const searchResults = await invoke<SearchResult[]>("search_files", {
        query: searchQuery,
        limit: 20,
      });
      setResults(searchResults);
      setSelectedIndex(0);
    } catch (error) {
      console.error("Search failed:", error);
      setResults([]);
      setSearchError(error === "unavailable" ? "unavailable" : "failed");
    } finally {
      setIsSearching(false);
    }
  }, []);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      performSearch(query);
    }, 300);

    return () => clearTimeout(timer);
  }, [query, performSearch]);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter" && results[selectedIndex]) {
      e.preventDefault();
      handleSelectFile(results[selectedIndex]);
    }
  };

  // Handle file selection
  const handleSelectFile = async (result: SearchResult) => {
    try {
      await openEditorFile(result.path);
      useUIStore.getState().openMode("editor");
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to open file:", error);
    }
  };

  let message: string | null = null;
  if (isSearching) message = "Searching...";
  else if (searchError) message = SEARCH_ERRORS[searchError];
  else if (results.length === 0)
    message = query.trim() ? "No results found" : "Type to search your vault";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0" showCloseButton={false}>
        <DialogDescription className="hidden">Search dialog</DialogDescription>
        <DialogHeader className="px-4 pt-4 pb-0">
          <DialogTitle className="sr-only">Search files</DialogTitle>
          <div className="relative">
            <SearchIcon className="absolute left-3 top-1/2 size-icon -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search your vault..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              className="pl-10"
              autoFocus
            />
          </div>
        </DialogHeader>

        <div className="max-h-100 overflow-y-auto border-t">
          {message ? (
            <div className="p-4 text-center text-ui text-muted-foreground">
              {message}
            </div>
          ) : (
            <div className="py-2">
              {results.map((result, index) => (
                <Button
                  key={result.path}
                  type="button"
                  variant="ghost"
                  onClick={() => handleSelectFile(result)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={`h-auto w-full justify-start rounded-none px-4 py-3 text-left transition-colors ${
                    index === selectedIndex ? "bg-accent" : "hover:bg-accent/50"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <FileIcon className="mt-0.5 size-icon shrink-0 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <div className="text-ui font-medium truncate">
                        {result.name}
                      </div>
                      <div className="text-ui-sm text-muted-foreground truncate">
                        {getRelativePath(result.path)}
                      </div>
                      {result.snippet.length > 0 && (
                        <div className="mt-1 text-ui-sm text-muted-foreground line-clamp-2">
                          <HighlightedText parts={result.snippet} />
                        </div>
                      )}
                    </div>
                  </div>
                </Button>
              ))}
            </div>
          )}
        </div>

        <div className="border-t px-4 py-2 text-ui-sm text-muted-foreground">
          <kbd className="rounded bg-muted px-1.5 py-0.5">↑↓</kbd> to navigate,{" "}
          <kbd className="rounded bg-muted px-1.5 py-0.5">Enter</kbd> to open,{" "}
          <kbd className="rounded bg-muted px-1.5 py-0.5">Esc</kbd> to close
        </div>
      </DialogContent>
    </Dialog>
  );
}
