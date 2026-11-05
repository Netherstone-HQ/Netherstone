// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { useUIStore } from "@/store/ui";
import {
  canShowInBrowserPanel,
  fileUrlFromPath,
  openFileInBrowserPanel,
} from "./browser-panel-files";

afterEach(() => {
  useUIStore.setState({
    isBrowserPanelOpen: false,
    browserLastUrl: null,
    browserUrlRequest: null,
  });
});

describe("fileUrlFromPath", () => {
  it("turns Windows, network and Unix paths into file URLs", () => {
    expect(fileUrlFromPath("C:\\Users\\Ana\\Vault\\_attachments\\Q3 plan#2.pdf")).toBe(
      "file:///C:/Users/Ana/Vault/_attachments/Q3%20plan%232.pdf",
    );
    expect(fileUrlFromPath("C:/Vault/_attachments/a.pdf")).toBe(
      "file:///C:/Vault/_attachments/a.pdf",
    );
    expect(fileUrlFromPath("\\\\server\\share\\é.pdf")).toBe(
      "file://server/share/%C3%A9.pdf",
    );
    expect(fileUrlFromPath("/home/ana/Vault/_attachments/a b.pdf")).toBe(
      "file:///home/ana/Vault/_attachments/a%20b.pdf",
    );
  });
});

describe("canShowInBrowserPanel", () => {
  it("allows files a webview shows, not ones it would download", () => {
    expect(canShowInBrowserPanel("C:/Vault/_attachments/Packet.PDF")).toBe(true);
    expect(canShowInBrowserPanel("/v/_attachments/clip.webm")).toBe(true);
    expect(canShowInBrowserPanel("/v/_attachments/report.docx")).toBe(false);
    expect(canShowInBrowserPanel("/v/_attachments/pdf")).toBe(false);
    expect(canShowInBrowserPanel(null)).toBe(false);
  });
});

describe("openFileInBrowserPanel", () => {
  it("opens the panel on the file", () => {
    openFileInBrowserPanel("C:\\Vault\\_attachments\\a.pdf");

    const ui = useUIStore.getState();
    expect(ui.isBrowserPanelOpen).toBe(true);
    expect(ui.browserLastUrl).toBe("file:///C:/Vault/_attachments/a.pdf");
  });
});
