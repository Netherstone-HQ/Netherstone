"use client";

import * as React from "react";

import type { DropdownMenuProps } from "@radix-ui/react-dropdown-menu";

import { MarkdownPlugin } from "@platejs/markdown";
import { ArrowDownToLineIcon } from "lucide-react";
import { useEditorRef } from "platejs/react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { ToolbarButton } from "./toolbar";
import {
  finalizeSerializedMarkdown,
  prepareSerializableMarkdownValue,
} from "@/lib/editor-markdown";

export function ExportToolbarButton(props: DropdownMenuProps) {
  const editor = useEditorRef();
  const [open, setOpen] = React.useState(false);

  const getCanvas = async () => {
    const { default: html2canvas } = await import("html2canvas-pro");

    const style = document.createElement("style");
    document.head.append(style);

    const canvas = await html2canvas(editor.api.toDOMNode(editor)!, {
      onclone: (document: Document) => {
        const editorElement = document.querySelector(
          '[contenteditable="true"]',
        );
        if (editorElement) {
          Array.from(editorElement.querySelectorAll("*")).forEach((element) => {
            const existingStyle = element.getAttribute("style") || "";
            element.setAttribute(
              "style",
              `${existingStyle}; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important`,
            );
          });
        }
      },
    });
    style.remove();

    return canvas;
  };

  const downloadFile = async (url: string, filename: string) => {
    const response = await fetch(url);

    const blob = await response.blob();
    const blobUrl = window.URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();

    // Clean up the blob URL
    window.URL.revokeObjectURL(blobUrl);
  };

  const exportToPdf = async () => {
    const canvas = await getCanvas();

    const PDFLib = await import("pdf-lib");
    const pdfDoc = await PDFLib.PDFDocument.create();
    const page = pdfDoc.addPage([canvas.width, canvas.height]);
    const imageEmbed = await pdfDoc.embedPng(canvas.toDataURL("PNG"));
    const { height, width } = imageEmbed.scale(1);
    page.drawImage(imageEmbed, {
      height,
      width,
      x: 0,
      y: 0,
    });
    const pdfBase64 = await pdfDoc.saveAsBase64({ dataUri: true });

    await downloadFile(pdfBase64, "plate.pdf");
  };

  const exportToImage = async () => {
    const canvas = await getCanvas();
    await downloadFile(canvas.toDataURL("image/png"), "plate.png");
  };

  const exportToMarkdown = async () => {
    const preparation = prepareSerializableMarkdownValue(editor.children);
    const md = finalizeSerializedMarkdown(
      editor.getApi(MarkdownPlugin).markdown.serialize({
        value: preparation.value as any,
      }),
    );
    const url = `data:text/markdown;charset=utf-8,${encodeURIComponent(md)}`;
    await downloadFile(url, "plate.md");
  };

  // const exportToWord = async () => {
  //   const [{ exportToDocx }, { DocxExportKit }] = await Promise.all([
  //     import("@platejs/docx-io"),
  //     import("@/components/editor/kits/docx-export-kit"),
  //   ]);

  //   const blob = await exportToDocx(editor.children, {
  //     editorPlugins: [...EditorKit, ...DocxExportKit] as SlatePlugin[],
  //   });

  //   const url = URL.createObjectURL(blob);
  //   const link = document.createElement("a");
  //   link.href = url;
  //   link.download = "plate.docx";
  //   document.body.append(link);
  //   link.click();
  //   link.remove();
  //   URL.revokeObjectURL(url);
  // };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false} {...props}>
      <DropdownMenuTrigger asChild>
        <ToolbarButton pressed={open} tooltip="Export" isDropdown>
          <ArrowDownToLineIcon className="size-4" />
        </ToolbarButton>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start">
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={exportToPdf}>
            Export as PDF
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={exportToImage}>
            Export as Image
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={exportToMarkdown}>
            Export as Markdown
          </DropdownMenuItem>
          {/* <DropdownMenuItem onSelect={exportToWord}>
            Export as Word
          </DropdownMenuItem> */}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
