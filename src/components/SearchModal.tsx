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
import { MagnifyingGlassIcon, FileIcon } from "@phosphor-icons/react";
import { openEditorFile } from "@/lib/open-editor-file";
import { useVaultStore } from "@/store/vault";

// Convert common markdown syntax to HTML for snippets
function markdownToHtml(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>") // Bold
    .replace(/\*(.+?)\*/g, "<em>$1</em>") // Italic
    .replace(/__(.+?)__/g, "<strong>$1</strong>") // Bold (underscore)
    .replace(/_(.+?)_/g, "<em>$1</em>") // Italic (underscore)
    .replace(/~~(.+?)~~/g, "<del>$1</del>") // Strikethrough
    .replace(/`(.+?)`/g, "<code>$1</code>") // Inline code
    .replace(/\[(.+?)\]\(.+?\)/g, "$1") // Links (just show text)
    .replace(/^#+\s+/gm, "") // Headings (strip markers)
    .replace(/^>\s+/gm, ""); // Blockquotes (strip markers)
}

interface SearchResult {
  path: string;
  name: string;
  snippet: string;
  rank: number;
}

interface SearchModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SearchModal({ open, onOpenChange }: SearchModalProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
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
      setSelectedIndex(0);
    }
  }, [open]);

  // Perform search
  const performSearch = useCallback(async (searchQuery: string) => {
    if (searchQuery.trim().length === 0) {
      setResults([]);
      return;
    }

    setIsSearching(true);
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
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to open file:", error);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0" showCloseButton={false}>
        <DialogDescription className="hidden">Search Dialog</DialogDescription>
        <DialogHeader className="px-4 pt-4 pb-0">
          <DialogTitle className="sr-only">Search Files</DialogTitle>
          <div className="relative">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
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
          {isSearching ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              Searching...
            </div>
          ) : results.length === 0 && query.trim().length > 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              No results found
            </div>
          ) : results.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              Type to search your vault
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
                    <FileIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {result.name}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {getRelativePath(result.path)}
                      </div>
                      {result.snippet && (
                        <div
                          className="mt-1 text-xs text-muted-foreground line-clamp-2"
                          dangerouslySetInnerHTML={{
                            __html: markdownToHtml(result.snippet).replace(
                              /<mark>/g,
                              '<mark class="bg-yellow-200 dark:bg-yellow-900">',
                            ),
                          }}
                        />
                      )}
                    </div>
                  </div>
                </Button>
              ))}
            </div>
          )}
        </div>

        <div className="border-t px-4 py-2 text-xs text-muted-foreground">
          <kbd className="rounded bg-muted px-1.5 py-0.5">↑↓</kbd> to navigate,{" "}
          <kbd className="rounded bg-muted px-1.5 py-0.5">Enter</kbd> to open,{" "}
          <kbd className="rounded bg-muted px-1.5 py-0.5">Esc</kbd> to close
        </div>
      </DialogContent>
    </Dialog>
  );
}
