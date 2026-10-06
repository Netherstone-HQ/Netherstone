import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleNotchIcon, FileDocIcon, FileHtmlIcon, FilePdfIcon, XIcon } from "@phosphor-icons/react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { isSamePath } from "@/lib/drawing-files";
import { shardNameOf, useExportDialogStore, type ExportFormat } from "@/lib/export";
import {
  defaultExportOptions,
  loadExportOptions,
  saveExportOptions,
  type ExportOptions,
} from "@/lib/export/options";
import { prepareExport, previewLook, renderPreview, type PreparedExport } from "@/lib/export/pipeline";
import { saveExport } from "@/lib/export/save";
import { cn } from "@/lib/utils";
import { useEditorStore, useSettingsStore, useVaultStore } from "@/store";

const FORMATS: ExportFormat[] = ["pdf", "docx", "html"];

const FORMAT_LABELS: Record<ExportFormat, string> = {
  pdf: "PDF",
  docx: "Word",
  html: "Web page",
};

const FORMAT_ICONS: Record<ExportFormat, typeof FilePdfIcon> = {
  pdf: FilePdfIcon,
  docx: FileDocIcon,
  html: FileHtmlIcon,
};

const EXPORT_LABELS: Record<ExportFormat, string> = {
  pdf: "Export PDF",
  docx: "Export Word document",
  html: "Export web page",
};

type Choice<T extends string> = { value: T; label: string; className?: string };

function Segments<T extends string>({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: T;
  choices: Choice<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col rounded-lg bg-muted/60 p-0.5">
        {choices.map((choice) => {
          const checked = choice.value === value;
          return (
            <button
              key={choice.value}
              type="button"
              role="radio"
              aria-checked={checked}
              onClick={() => onChange(choice.value)}
              className={cn(
                "h-7 rounded-md px-2 text-muted-foreground text-xs transition-colors hover:text-foreground",
                checked && "bg-background text-foreground shadow-xs",
                choice.className,
              )}
            >
              {choice.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

type PreviewMessage = { type: "netherstone-export-preview"; pages?: number | null; ready?: boolean };

function isPreviewMessage(data: unknown): data is PreviewMessage {
  return typeof data === "object" && data !== null && (data as PreviewMessage).type === "netherstone-export-preview";
}

/** The export window: format and options on the right, the result on the left. */
export function ExportDialog() {
  const filePath = useExportDialogStore((s) => s.filePath);
  const close = useExportDialogStore((s) => s.close);

  return (
    <Dialog open={filePath !== null} onOpenChange={(open) => !open && close()}>
      {filePath !== null ? <ExportWindow key={filePath} filePath={filePath} onClose={close} /> : null}
    </Dialog>
  );
}

function ExportWindow({ filePath, onClose }: { filePath: string; onClose: () => void }) {
  const shardName = shardNameOf(filePath);
  const [options, setOptions] = useState<ExportOptions>(() => {
    const { readingFont, textSize } = useSettingsStore.getState();
    return loadExportOptions(defaultExportOptions({ readingFont, textSize }));
  });
  const [prepared, setPrepared] = useState<PreparedExport | null>(null);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPreviewReady, setIsPreviewReady] = useState(false);
  const [pages, setPages] = useState<number | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const previewRef = useRef<HTMLElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const update = useCallback(<K extends keyof ExportOptions>(key: K, value: ExportOptions[K]) => {
    setOptions((current) => {
      const next = { ...current, [key]: value };
      saveExportOptions(next);
      return next;
    });
  }, []);

  // Read the shard once: the open editor's text, unsaved edits included.
  useEffect(() => {
    let cancelled = false;
    const { currentFilePath, plateEditor } = useEditorStore.getState();
    const isOpen = !!plateEditor && !!currentFilePath && isSamePath(currentFilePath, filePath);

    prepareExport({
      filePath,
      fileName: shardName,
      value: isOpen ? (plateEditor.children as unknown[]) : undefined,
      vaultPath: useVaultStore.getState().currentVaultPath,
    })
      .then((result) => !cancelled && setPrepared(result))
      .catch((error) => {
        console.error("[Netherstone] Couldn't prepare export:", error);
        if (!cancelled) setPrepareError(error instanceof Error ? error.message : String(error));
      });

    return () => {
      cancelled = true;
    };
  }, [filePath, shardName]);

  // The preview document is built once. Later changes restyle it in place.
  useEffect(() => {
    if (!prepared) return;
    let cancelled = false;
    let url: string | null = null;

    renderPreview(prepared, optionsRef.current).then((html) => {
      if (cancelled) return;
      url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
      // The preview takes the window's backdrop and scrollbar colors.
      const backdrop = previewRef.current ? getComputedStyle(previewRef.current).backgroundColor : "";
      const thumb = getComputedStyle(document.documentElement).getPropertyValue("--scrollbar-thumb").trim();
      setPreviewUrl(`${url}#bg=${encodeURIComponent(backdrop)}&thumb=${encodeURIComponent(thumb)}`);
    });

    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [prepared]);

  const sendLook = useCallback(() => {
    frameRef.current?.contentWindow?.postMessage(
      { type: "netherstone-export-preview-look", ...previewLook(optionsRef.current) },
      "*",
    );
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow || !isPreviewMessage(event.data)) return;
      if (event.data.pages !== undefined) setPages(event.data.pages);
      if (event.data.ready) {
        // Options may have changed while the preview loaded.
        sendLook();
        setIsPreviewReady(true);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [sendLook]);

  useEffect(() => {
    if (isPreviewReady) sendLook();
  }, [options, isPreviewReady, sendLook]);

  const handleExport = async () => {
    if (!prepared) return;
    setIsExporting(true);
    try {
      const saved = await saveExport(prepared, options, shardName);
      if (saved) onClose();
    } catch (error) {
      console.error("[Netherstone] Export failed:", error);
      toast.error(`Couldn't export ${shardName}`, {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsExporting(false);
    }
  };

  const isPaged = options.format !== "html";
  const pageLabel = useMemo(() => {
    if (!isPaged || pages === null) return null;
    const count = pages === 1 ? "1 page" : `${pages} pages`;
    return options.format === "docx" ? `About ${count}` : count;
  }, [isPaged, pages, options.format]);

  return (
    <DialogContent
      showCloseButton={false}
      className="grid h-[min(760px,calc(100vh-3rem))] w-[min(1120px,calc(100vw-3rem))] max-w-none grid-cols-[minmax(0,1fr)_19rem] gap-0 overflow-hidden p-0 sm:max-w-none"
      onEscapeKeyDown={(event) => isExporting && event.preventDefault()}
      onPointerDownOutside={(event) => event.preventDefault()}
    >
      <section ref={previewRef} aria-label="Preview" className="relative min-w-0 overflow-hidden bg-muted">
        {previewUrl ? (
          <iframe
            ref={frameRef}
            title={`Preview of ${shardName}`}
            src={previewUrl}
            sandbox="allow-scripts"
            className={cn(
              "absolute inset-0 size-full border-0 transition-opacity duration-200",
              isPreviewReady ? "opacity-100" : "opacity-0",
            )}
          />
        ) : null}

        {!isPreviewReady ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground text-sm">
            {prepareError ? (
              <>
                <span className="font-medium text-foreground">Couldn't read this shard</span>
                <span className="max-w-sm text-center text-xs">{prepareError}</span>
              </>
            ) : (
              <>
                <CircleNotchIcon className="size-5 animate-spin" />
                Preparing preview…
              </>
            )}
          </div>
        ) : null}

        {pageLabel && isPreviewReady ? (
          <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-background/90 px-2 py-1 text-muted-foreground text-xs shadow-xs ring-1 ring-foreground/10">
            {pageLabel}
          </div>
        ) : null}
      </section>

      <aside className="flex min-h-0 flex-col border-l bg-popover">
        <header className="flex items-start gap-3 px-5 pt-5 pb-4">
          <div className="min-w-0 flex-1 space-y-1">
            <DialogTitle className="font-medium text-base">Export</DialogTitle>
            <DialogDescription className="truncate text-muted-foreground text-sm" title={shardName}>
              {shardName}
            </DialogDescription>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} disabled={isExporting} aria-label="Close">
            <XIcon />
          </Button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 pb-5">
          <div role="radiogroup" aria-label="Format" className="grid grid-cols-3 gap-2">
            {FORMATS.map((format) => {
              const Icon = FORMAT_ICONS[format];
              const checked = options.format === format;
              return (
                <button
                  key={format}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  onClick={() => update("format", format)}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-lg border px-2 py-3 text-xs transition-colors",
                    checked
                      ? "border-primary/50 bg-accent text-foreground"
                      : "border-border text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  )}
                >
                  <Icon className="size-6" weight={checked ? "duotone" : "regular"} />
                  {FORMAT_LABELS[format]}
                </button>
              );
            })}
          </div>

          <Segments
            label="Typeface"
            value={options.typeface}
            onChange={(value) => update("typeface", value)}
            choices={[
              { value: "newsreader", label: "Newsreader", className: "[font-family:'Newsreader_Variable',serif] text-[13px]" },
              { value: "geist", label: "Geist", className: "font-sans" },
            ]}
          />

          <Segments
            label="Text size"
            value={options.textSize}
            onChange={(value) => update("textSize", value)}
            choices={[
              { value: "small", label: "Small" },
              { value: "default", label: "Default" },
              { value: "large", label: "Large" },
            ]}
          />

          {isPaged ? (
            <>
              <Segments
                label="Paper"
                value={options.pageSize}
                onChange={(value) => update("pageSize", value)}
                choices={[
                  { value: "a4", label: "A4" },
                  { value: "letter", label: "US Letter" },
                ]}
              />

              <Segments
                label="Margins"
                value={options.margins}
                onChange={(value) => update("margins", value)}
                choices={[
                  { value: "narrow", label: "Narrow" },
                  { value: "normal", label: "Normal" },
                  { value: "wide", label: "Wide" },
                ]}
              />

              <label className="flex cursor-pointer items-center justify-between gap-3">
                <span className="space-y-0.5">
                  <span className="block text-sm">Page numbers</span>
                  <span className="block text-muted-foreground text-xs">The title and page number at the foot of each page.</span>
                </span>
                <Switch checked={options.pageNumbers} onCheckedChange={(checked) => update("pageNumbers", checked)} />
              </label>
            </>
          ) : (
            <Segments
              label="Appearance"
              value={options.theme}
              onChange={(value) => update("theme", value)}
              choices={[
                  { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
              ]}
            />
          )}

          {options.format === "docx" ? (
            <p className="text-muted-foreground text-xs leading-5">
              Word lays out the pages itself, so breaks can fall a little differently. Where Newsreader or Geist
              isn't installed, Word shows Georgia or Arial instead.
            </p>
          ) : null}

          {prepared?.missingImages ? (
            <p className="text-muted-foreground text-xs leading-5">
              {prepared.missingImages === 1
                ? "1 image couldn't be found. The export marks where it goes."
                : `${prepared.missingImages} images couldn't be found. The export marks where they go.`}
            </p>
          ) : null}
        </div>

        <footer className="flex justify-end gap-2 border-t px-5 py-4">
          <Button variant="ghost" onClick={onClose} disabled={isExporting}>
            Cancel
          </Button>
          <Button onClick={handleExport} disabled={!prepared || isExporting}>
            {isExporting ? <CircleNotchIcon className="animate-spin" /> : null}
            {isExporting ? "Exporting…" : EXPORT_LABELS[options.format]}
          </Button>
        </footer>
      </aside>
    </DialogContent>
  );
}
