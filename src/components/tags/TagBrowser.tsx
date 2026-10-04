import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  TagIcon,
  FileIcon,
  HashIcon,
  XIcon,
  InfoIcon,
} from "@phosphor-icons/react";
import { openEditorFile } from "@/lib/open-editor-file";
import { useVaultStore } from "@/store/vault";
import { useUIStore } from "@/store/ui";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface TagInfo {
  tag: string;
  count: number;
}

interface FileInfo {
  path: string;
  name: string;
}

export function TagBrowser() {
  const [tags, setTags] = useState<TagInfo[]>([]);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const currentVaultPath = useVaultStore((s) => s.currentVaultPath);
  const setActiveNavItem = useUIStore((s) => s.setActiveNavItem);

  // Load all tags when component mounts or vault changes
  useEffect(() => {
    if (!currentVaultPath) {
      setTags([]);
      setSelectedTag(null);
      setFiles([]);
      return;
    }

    loadTags();
  }, [currentVaultPath]);

  // Load files when a tag is selected
  useEffect(() => {
    if (selectedTag) {
      loadFilesByTag(selectedTag);
    } else {
      setFiles([]);
    }
  }, [selectedTag]);

  const loadTags = async () => {
    setIsLoading(true);
    try {
      const allTags = await invoke<TagInfo[]>("get_all_tags");
      setTags(allTags);
    } catch (error) {
      console.error("Failed to load tags:", error);
      setTags([]);
    } finally {
      setIsLoading(false);
    }
  };

  const loadFilesByTag = async (tag: string) => {
    setIsLoading(true);
    try {
      const tagFiles = await invoke<FileInfo[]>("get_files_by_tag", { tag });
      setFiles(tagFiles);
    } catch (error) {
      console.error("Failed to load files by tag:", error);
      setFiles([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTagClick = (tag: string) => {
    if (selectedTag === tag) {
      setSelectedTag(null);
    } else {
      setSelectedTag(tag);
    }
  };

  const handleFileClick = async (file: FileInfo) => {
    try {
      await openEditorFile(file.path);
      setActiveNavItem(null);
    } catch (error) {
      console.error("Failed to open file:", error);
    }
  };

  // Filter tags based on search query
  const filteredTags = tags.filter((tag) =>
    tag.tag.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  if (!currentVaultPath) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <div className="text-center text-sm text-muted-foreground">
          <TagIcon className="mx-auto mb-2 h-8 w-8 opacity-50" />
          <p>Open a vault to browse tags</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b p-4">
        <div className="mb-3 flex items-center gap-2">
          <TagIcon className="h-5 w-5" />
          <h2 className="text-lg font-semibold">Tags</h2>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground"
                aria-label="How tags work"
              >
                <InfoIcon className="h-4 w-4 text-muted-foreground" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80">
              <div className="space-y-2">
                <h4 className="font-medium leading-none">How Tags Work</h4>
                <p className="text-sm text-muted-foreground">
                  Tags are automatically extracted from your shards. Simply type{" "}
                  <code className="rounded bg-muted px-1 py-0.5">#tagname</code>{" "}
                  anywhere in your notes.
                </p>
                <p className="text-xs text-muted-foreground">
                  Changes appear after saving and re-indexing.
                </p>
              </div>
            </PopoverContent>
          </Popover>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setActiveNavItem(null)}
            className="ml-auto"
            aria-label="Close tags view"
          >
            <XIcon className="h-4 w-4" />
          </Button>
        </div>
        <Input
          placeholder="Search tags..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-8"
        />
      </div>

      {/* Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Tags List */}
        <ScrollArea className="flex-1 border-r">
          <div className="p-2">
            {isLoading && tags.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                Loading tags...
              </div>
            ) : filteredTags.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                {searchQuery ? "No tags found" : "No tags in vault"}
              </div>
            ) : (
              <div className="space-y-1">
                {filteredTags.map((tag) => (
                  <Button
                    key={tag.tag}
                    type="button"
                    variant="ghost"
                    onClick={() => handleTagClick(tag.tag)}
                    className={`h-auto w-full justify-between px-3 py-2 text-left text-sm font-normal transition-colors hover:bg-accent ${
                      selectedTag === tag.tag ? "bg-accent" : ""
                    }`}
                  >
                    <div className="flex items-center gap-2 overflow-hidden">
                      <HashIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{tag.tag}</span>
                    </div>
                    <Badge variant="secondary" className="ml-2 shrink-0">
                      {tag.count}
                    </Badge>
                  </Button>
                ))}
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Files List */}
        <ScrollArea className="flex-1">
          <div className="p-2">
            {selectedTag ? (
              <>
                {isLoading ? (
                  <div className="p-4 text-center text-sm text-muted-foreground">
                    Loading files...
                  </div>
                ) : files.length === 0 ? (
                  <div className="p-4 text-center text-sm text-muted-foreground">
                    No files found
                  </div>
                ) : (
                  <>
                    <div className="mb-2 px-2 text-xs font-medium text-muted-foreground">
                      {files.length} {files.length === 1 ? "file" : "files"}{" "}
                      with #{selectedTag}
                    </div>
                    <div className="space-y-1">
                      {files.map((file) => (
                        <Button
                          key={file.path}
                          type="button"
                          variant="ghost"
                          onClick={() => handleFileClick(file)}
                          className="h-auto w-full justify-start gap-2 px-3 py-2 text-left text-sm font-normal transition-colors hover:bg-accent"
                        >
                          <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="truncate">{file.name}</span>
                        </Button>
                      ))}
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="flex h-full items-center justify-center p-4">
                <div className="text-center text-sm text-muted-foreground">
                  <HashIcon className="mx-auto mb-2 h-6 w-6 opacity-50" />
                  <p>Select a tag to view files</p>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
