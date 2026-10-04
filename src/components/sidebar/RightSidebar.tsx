import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openEditorFile } from "@/lib/open-editor-file";
import { useUIStore, useVaultStore } from "@/store";
import { useEditorStore } from "@/store/editor";
import { BacklinksSection } from "./right-sidebar/BacklinksSection";
import { DocumentLinksSection } from "./right-sidebar/DocumentLinksSection";
import { MetadataSection } from "./right-sidebar/MetadataSection";
import { TableOfContentsSection } from "./right-sidebar/TableOfContentsSection";
import {
  areDocumentLinksEqual,
  buildLinkSections,
  buildMetadataRows,
  extractDocumentLinksFromValue,
  flattenShardFiles,
  LINK_VALIDATION_DEBOUNCE_MS,
  METADATA_REFRESH_DEBOUNCE_MS,
  METADATA_WATCHER_SUPPRESS_AFTER_SAVE_MS,
  resolveInternalTargetPath,
  resolveShardReferencePath,
  stripLinkDecorators,
} from "./right-sidebar/link-utils";
import type {
  Backlink,
  DocumentLink,
  FileMetadata,
} from "./right-sidebar/types";

export function RightSidebar() {
  const isRightSidebarOpen = useUIStore((s) => s.isRightSidebarOpen);
  const currentFilePath = useEditorStore((s) => s.currentFilePath);
  const plateEditor = useEditorStore((s) => s.plateEditor);
  const tocHeadings = useEditorStore((s) => s.tocHeadings);
  const isDirty = useEditorStore((s) => s.isDirty);
  const currentVaultPath = useVaultStore((s) => s.currentVaultPath);
  const fileTree = useVaultStore((s) => s.fileTree);

  const [documentLinks, setDocumentLinks] = useState<DocumentLink[]>([]);
  const [isLoadingLinks, setIsLoadingLinks] = useState(false);
  const [fileMetadata, setFileMetadata] = useState<FileMetadata | null>(null);
  const [isLoadingMetadata, setIsLoadingMetadata] = useState(false);
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [isLoadingBacklinks, setIsLoadingBacklinks] = useState(false);

  const validationTimeoutRef = useRef<number | null>(null);
  const validationRequestIdRef = useRef(0);
  const metadataTimeoutRef = useRef<number | null>(null);
  const metadataRequestIdRef = useRef(0);
  const metadataWatcherSuppressUntilRef = useRef(0);
  const backlinksTimeoutRef = useRef<number | null>(null);
  const backlinksRequestIdRef = useRef(0);
  const latestContextRef = useRef({
    currentFilePath,
    currentVaultPath,
    isRightSidebarOpen,
    plateEditor,
    fileTree,
  });

  const clearScheduledValidation = useCallback(() => {
    if (validationTimeoutRef.current !== null) {
      clearTimeout(validationTimeoutRef.current);
      validationTimeoutRef.current = null;
    }
  }, []);

  const clearLinksState = useCallback(() => {
    validationRequestIdRef.current += 1;
    clearScheduledValidation();
    setDocumentLinks([]);
    setIsLoadingLinks(false);
  }, [clearScheduledValidation]);

  const clearScheduledMetadataRefresh = useCallback(() => {
    if (metadataTimeoutRef.current !== null) {
      clearTimeout(metadataTimeoutRef.current);
      metadataTimeoutRef.current = null;
    }
  }, []);

  const clearMetadataState = useCallback(() => {
    metadataRequestIdRef.current += 1;
    clearScheduledMetadataRefresh();
    setFileMetadata(null);
    setIsLoadingMetadata(false);
  }, [clearScheduledMetadataRefresh]);

  const clearScheduledBacklinksRefresh = useCallback(() => {
    if (backlinksTimeoutRef.current !== null) {
      clearTimeout(backlinksTimeoutRef.current);
      backlinksTimeoutRef.current = null;
    }
  }, []);

  const clearBacklinksState = useCallback(() => {
    backlinksRequestIdRef.current += 1;
    clearScheduledBacklinksRefresh();
    setBacklinks([]);
    setIsLoadingBacklinks(false);
  }, [clearScheduledBacklinksRefresh]);

  const validateLinks = useCallback(async () => {
    const {
      isRightSidebarOpen: sidebarOpen,
      currentFilePath: filePath,
      currentVaultPath: vaultPath,
      plateEditor: editor,
      fileTree: latestFileTree,
    } = latestContextRef.current;

    if (!sidebarOpen || !filePath || !vaultPath || !editor) {
      setDocumentLinks([]);
      setIsLoadingLinks(false);
      return;
    }

    const requestId = ++validationRequestIdRef.current;
    setIsLoadingLinks(true);

    const extractedLinks = extractDocumentLinksFromValue(editor.children);
    const latestShardFiles = flattenShardFiles(latestFileTree);

    if (extractedLinks.length === 0) {
      if (requestId !== validationRequestIdRef.current) return;
      setDocumentLinks([]);
      setIsLoadingLinks(false);
      return;
    }

    const validatedLinks = await Promise.all(
      extractedLinks.map(async (link) => {
        if (link.kind === "shard-mention") {
          const resolvedPath = resolveShardReferencePath(
            link.target,
            latestShardFiles,
          );

          return {
            ...link,
            isValid: Boolean(resolvedPath),
            resolvedPath,
          } satisfies DocumentLink;
        }

        if (link.kind === "internal") {
          const normalizedTarget = stripLinkDecorators(link.target);
          const resolvedPath = resolveInternalTargetPath(
            normalizedTarget,
            filePath,
            vaultPath,
            latestShardFiles,
          );

          return {
            ...link,
            isValid: Boolean(resolvedPath),
            resolvedPath: resolvedPath ?? null,
          } satisfies DocumentLink;
        }

        return {
          ...link,
          isValid: true,
          resolvedPath: null,
        } satisfies DocumentLink;
      }),
    );

    if (requestId !== validationRequestIdRef.current) {
      return;
    }

    setDocumentLinks((previousLinks) =>
      areDocumentLinksEqual(previousLinks, validatedLinks)
        ? previousLinks
        : validatedLinks,
    );
    setIsLoadingLinks(false);
  }, []);

  const scheduleValidation = useCallback(
    (delayMs = LINK_VALIDATION_DEBOUNCE_MS) => {
      clearScheduledValidation();

      const {
        isRightSidebarOpen: sidebarOpen,
        currentFilePath: filePath,
        currentVaultPath: vaultPath,
        plateEditor: editor,
      } = latestContextRef.current;

      if (!sidebarOpen || !filePath || !vaultPath || !editor) {
        setDocumentLinks([]);
        setIsLoadingLinks(false);
        return;
      }

      if (delayMs <= 0) {
        void validateLinks();
        return;
      }

      validationTimeoutRef.current = window.setTimeout(() => {
        validationTimeoutRef.current = null;
        void validateLinks();
      }, delayMs);
    },
    [clearScheduledValidation, validateLinks],
  );

  const loadMetadata = useCallback(async () => {
    const { isRightSidebarOpen: sidebarOpen, currentFilePath: filePath } =
      latestContextRef.current;

    if (!sidebarOpen || !filePath) {
      setFileMetadata(null);
      setIsLoadingMetadata(false);
      return;
    }

    const requestId = ++metadataRequestIdRef.current;
    setIsLoadingMetadata(true);

    try {
      const metadata = await invoke<FileMetadata | null>("get_file_metadata", {
        filePath,
      });

      if (requestId !== metadataRequestIdRef.current) {
        return;
      }

      setFileMetadata(metadata);
    } catch (error) {
      if (requestId !== metadataRequestIdRef.current) {
        return;
      }

      console.error("Failed to load file metadata:", filePath, error);
      setFileMetadata(null);
    } finally {
      if (requestId === metadataRequestIdRef.current) {
        setIsLoadingMetadata(false);
      }
    }
  }, []);

  const scheduleMetadataRefresh = useCallback(
    (delayMs = METADATA_REFRESH_DEBOUNCE_MS) => {
      clearScheduledMetadataRefresh();

      const { isRightSidebarOpen: sidebarOpen, currentFilePath: filePath } =
        latestContextRef.current;

      if (!sidebarOpen || !filePath) {
        setFileMetadata(null);
        setIsLoadingMetadata(false);
        return;
      }

      if (delayMs <= 0) {
        void loadMetadata();
        return;
      }

      metadataTimeoutRef.current = window.setTimeout(() => {
        metadataTimeoutRef.current = null;
        void loadMetadata();
      }, delayMs);
    },
    [clearScheduledMetadataRefresh, loadMetadata],
  );

  const loadBacklinks = useCallback(async () => {
    const { isRightSidebarOpen: sidebarOpen, currentFilePath: filePath } =
      latestContextRef.current;

    if (!sidebarOpen || !filePath) {
      setBacklinks([]);
      setIsLoadingBacklinks(false);
      return;
    }

    const requestId = ++backlinksRequestIdRef.current;
    setIsLoadingBacklinks(true);

    try {
      const fetchedBacklinks = await invoke<Backlink[]>("get_backlinks", {
        filePath,
      });

      if (requestId !== backlinksRequestIdRef.current) {
        return;
      }

      setBacklinks(fetchedBacklinks);
    } catch (error) {
      if (requestId !== backlinksRequestIdRef.current) {
        return;
      }

      console.error("Failed to load backlinks:", filePath, error);
      setBacklinks([]);
    } finally {
      if (requestId === backlinksRequestIdRef.current) {
        setIsLoadingBacklinks(false);
      }
    }
  }, []);

  const scheduleBacklinksRefresh = useCallback(
    (delayMs = METADATA_REFRESH_DEBOUNCE_MS) => {
      clearScheduledBacklinksRefresh();

      const { isRightSidebarOpen: sidebarOpen, currentFilePath: filePath } =
        latestContextRef.current;

      if (!sidebarOpen || !filePath) {
        setBacklinks([]);
        setIsLoadingBacklinks(false);
        return;
      }

      if (delayMs <= 0) {
        void loadBacklinks();
        return;
      }

      backlinksTimeoutRef.current = window.setTimeout(() => {
        backlinksTimeoutRef.current = null;
        void loadBacklinks();
      }, delayMs);
    },
    [clearScheduledBacklinksRefresh, loadBacklinks],
  );

  useEffect(() => {
    latestContextRef.current = {
      currentFilePath,
      currentVaultPath,
      isRightSidebarOpen,
      plateEditor,
      fileTree,
    };

    if (
      !isRightSidebarOpen ||
      !currentFilePath ||
      !currentVaultPath ||
      !plateEditor
    ) {
      clearLinksState();
      return;
    }

    scheduleValidation(0);
  }, [
    clearLinksState,
    currentFilePath,
    currentVaultPath,
    fileTree,
    isRightSidebarOpen,
    plateEditor,
    scheduleValidation,
  ]);

  useEffect(() => {
    latestContextRef.current = {
      ...latestContextRef.current,
      currentFilePath,
      currentVaultPath,
      isRightSidebarOpen,
    };

    if (!isRightSidebarOpen || !currentFilePath) {
      clearMetadataState();
      clearBacklinksState();
      return;
    }

    scheduleMetadataRefresh(0);
    scheduleBacklinksRefresh(0);
  }, [
    clearMetadataState,
    clearBacklinksState,
    currentFilePath,
    currentVaultPath,
    isRightSidebarOpen,
    scheduleMetadataRefresh,
    scheduleBacklinksRefresh,
  ]);

  useEffect(() => {
    if (!currentVaultPath || !isRightSidebarOpen || !currentFilePath) {
      return;
    }

    let unlistenFn: (() => void) | undefined;
    let cancelled = false;

    listen("vault:changed", () => {
      if (cancelled) return;
      if (metadataWatcherSuppressUntilRef.current > window.performance.now()) {
        return;
      }
      scheduleMetadataRefresh();
      scheduleBacklinksRefresh();
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
      } else {
        unlistenFn = unlisten;
      }
    });

    return () => {
      cancelled = true;
      unlistenFn?.();
    };
  }, [
    currentFilePath,
    currentVaultPath,
    isRightSidebarOpen,
    scheduleMetadataRefresh,
    scheduleBacklinksRefresh,
  ]);

  useEffect(() => {
    const unsubscribe = useEditorStore.subscribe((state, previousState) => {
      latestContextRef.current = {
        ...latestContextRef.current,
        currentFilePath: state.currentFilePath,
        plateEditor: state.plateEditor,
      };

      if (state.editTick !== previousState.editTick) {
        scheduleValidation();
      }

      if (previousState.isDirty && !state.isDirty) {
        metadataWatcherSuppressUntilRef.current =
          window.performance.now() + METADATA_WATCHER_SUPPRESS_AFTER_SAVE_MS;
        scheduleMetadataRefresh();
        scheduleBacklinksRefresh();
      }
    });

    return () => {
      unsubscribe();
    };
  }, [scheduleMetadataRefresh, scheduleBacklinksRefresh, scheduleValidation]);

  useEffect(() => {
    return () => {
      validationRequestIdRef.current += 1;
      metadataRequestIdRef.current += 1;
      backlinksRequestIdRef.current += 1;
      clearScheduledValidation();
      clearScheduledMetadataRefresh();
      clearScheduledBacklinksRefresh();
    };
  }, [
    clearScheduledMetadataRefresh,
    clearScheduledValidation,
    clearScheduledBacklinksRefresh,
  ]);

  const linkSections = useMemo(
    () => buildLinkSections(documentLinks),
    [documentLinks],
  );
  const metadataRows = useMemo(
    () => buildMetadataRows(fileMetadata),
    [fileMetadata],
  );

  const handleOpenResolvedLink = useCallback((resolvedPath: string) => {
    void openEditorFile(resolvedPath).catch((error) => {
      console.error("Failed to open linked shard:", resolvedPath, error);
    });
  }, []);

  return (
    <div
      className={`relative shrink-0 overflow-hidden transition-[width] duration-200 ease-linear ${
        isRightSidebarOpen ? "w-72" : "w-0"
      }`}
      aria-hidden={!isRightSidebarOpen}
    >
      <aside
        className={`absolute inset-y-0 right-0 flex w-72 flex-col border-l bg-sidebar transition-[right] duration-200 ease-linear ${
          isRightSidebarOpen ? "right-0" : "-right-72"
        }`}
      >
        <div className="flex-1 overflow-auto p-4">
          <TableOfContentsSection
            currentFilePath={currentFilePath}
            plateEditor={plateEditor}
            tocHeadings={tocHeadings}
          />

          <DocumentLinksSection
            currentFilePath={currentFilePath}
            isLoadingLinks={isLoadingLinks}
            documentLinks={documentLinks}
            linkSections={linkSections}
            onOpenResolvedLink={handleOpenResolvedLink}
          />

          <BacklinksSection
            currentFilePath={currentFilePath}
            isLoadingBacklinks={isLoadingBacklinks}
            backlinks={backlinks}
            onOpenResolvedLink={handleOpenResolvedLink}
          />

          <MetadataSection
            currentFilePath={currentFilePath}
            isLoadingMetadata={isLoadingMetadata}
            fileMetadata={fileMetadata}
            isDirty={isDirty}
            metadataRows={metadataRows}
          />
        </div>
      </aside>
    </div>
  );
}
