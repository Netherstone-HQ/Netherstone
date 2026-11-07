import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test as base, expect, type Locator, type Page, type Route } from "@playwright/test";

/**
 * Runs the built app in a plain browser against an in-memory vault.
 *
 * The Tauri bridge (`window.__TAURI_INTERNALS__`) is replaced before the app
 * loads, so backend commands answer from the given files and every save is
 * recorded in `window.__saves`. Nothing touches a real file system.
 */

export const VAULT_PATH = "/home/me/Vault";

/**
 * The app's own Content-Security-Policy, as Tauri serves it: the policy from
 * tauri.conf.json plus the hash of each inline script in the page.
 */
function appCsp(html: string) {
  const config = JSON.parse(
    readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
  );
  const csp: Record<string, string> = { ...config.app.security.csp };
  const hashes: string[] = [];
  const lower = html.toLowerCase();
  for (let at = lower.indexOf("<script"); at !== -1; at = lower.indexOf("<script", at)) {
    const start = lower.indexOf(">", at) + 1;
    const end = lower.indexOf("</script", start);
    const script = html.slice(start, end);
    if (script) hashes.push(`'sha256-${createHash("sha256").update(script).digest("base64")}'`);
    at = end;
  }
  csp["script-src"] = [csp["script-src"], ...hashes].join(" ");
  return Object.entries(csp)
    .map(([directive, sources]) => `${directive} ${sources}`)
    .join("; ");
}

/**
 * Every test runs the app under its real security policy and fails on
 * anything the policy blocks, so a policy that is too strict shows up as a
 * broken test rather than as a broken app.
 */
export const test = base.extend<{ securityPolicy: void }>({
  securityPolicy: [
    async ({ page }, use) => {
      const blocked: string[] = [];
      await page.route("**/*", async (route) => {
        if (route.request().resourceType() !== "document" || !route.request().url().startsWith("http://localhost")) {
          return route.fallback();
        }
        const response = await route.fetch();
        const body = await response.text();
        await route.fulfill({
          response,
          body,
          headers: { ...response.headers(), "content-security-policy": appCsp(body) },
        });
      });
      await page.exposeFunction("__reportBlocked", (entry: string) => blocked.push(entry));
      await page.addInitScript(() => {
        document.addEventListener("securitypolicyviolation", (event) => {
          (window as unknown as { __reportBlocked: (entry: string) => void }).__reportBlocked(
            `${event.effectiveDirective} blocked ${event.blockedURI || "inline"}`,
          );
        });
      });
      page.on("console", (message) => {
        if (/Content Security Policy/i.test(message.text())) blocked.push(message.text());
      });
      page.on("worker", (worker) => {
        worker.on("console", (message) => {
          if (/Content Security Policy/i.test(message.text())) blocked.push(message.text());
        });
      });

      await use();

      expect(blocked, "the security policy blocked something").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

type VaultFiles = Record<string, string>;

export type Save = { filePath: string; content: string };

declare global {
  interface Window {
    __saves: Save[];
    /** The first bytes of each file an export wrote. */
    __exports: string[];
    /** Every backend command the app sent, in order. */
    __commands: { command: string; args: unknown }[];
    /** Binary files by vault-relative (or, outside the vault, absolute) path, in base64. */
    __binaries: Record<string, string>;
    /** What the asset protocol may serve, as the desktop app's scope does. */
    __assetScope: { folders: string[]; files: string[] };
    __vaultFiles: VaultFiles;
    __emit: (event: string, payload: unknown) => void;
    /** Runs the animation frames a test held back, and stops holding them. */
    __releaseFrames: () => void;
  }
}

export type MockVaultOptions = {
  files: VaultFiles;
  /** Attachments and other binary files, relative to the vault. */
  assets?: Record<string, Buffer>;
  /** Empty folders shown in the sidebar. */
  folders?: string[];
  /** The shard open when the app starts, relative to the vault. None when left out. */
  open?: string;
  /** The drawing open on the canvas when the app starts, relative to the vault. */
  drawing?: string;
  /** Starts with no vault open. */
  noVault?: boolean;
  /** Vaults opened before, besides this one. */
  otherVaults?: string[];
  theme?: "light" | "dark";
  /** Earlier versions of files, newest first, by vault-relative path. */
  versions?: Record<string, MockVersion[]>;
  /** The versions files as they are now were saved as. */
  current?: Record<string, Omit<MockVersion, "content">>;
  /** Turns the assistant on, set up as given. Off when left out. */
  assistant?: MockAssistant;
  /** Shows the companion, as once he's been found. */
  companion?: boolean;
};

type MockAssistant = {
  /** Whether a provider has a key saved. */
  provider?: boolean;
  /** Whether the vault is on for AI. */
  vaultAllowed?: boolean;
  /** Whether a model is picked. */
  picked?: boolean;
  /** Whether the picked model takes images. */
  images?: boolean;
  sendFiles?: boolean;
  /** The answer to every message, in the pieces it streams in. */
  answer?: string[];
  /** The shards every answer reads. */
  reads?: string[];
  /** The short title a new chat gets after its answer, if any. */
  title?: string;
  /**
   * A change every answer proposes, by its vault-relative path: to a shard
   * unless `kind` says otherwise.
   */
  change?: {
    path: string;
    after: string;
    kind?: "shard" | "newShard" | "drawing" | "newDrawing" | "move";
    moving?: { folder: string | null; name: string | null };
  };
  /** An item every answer offers to add to memory. */
  remember?: string;
  /** What's in memory to start with. */
  memory?: string[];
  /** The answer to every inline Ask, in the pieces it streams in. */
  inline?: string[];
  /** Inline Asks get no answer until they're stopped. */
  holdInline?: boolean;
};

declare global {
  interface Window {
    /** Every message sent to the assistant. */
    __sent: { chat: string | null; text: string; shards: string[] }[];
    __memory: string[];
    /** Every inline Ask sent. */
    __asked: { shard: string; selection: string; whole: boolean; prompt: string }[];
  }
}

export type MockVersion = {
  /** Unix seconds. */
  time: number;
  content: string;
  kind?:
    | "created"
    | "edited"
    | "outsideChange"
    | "restored"
    | "synced"
    | "renamed";
  /** The vault-relative path it had before, for a rename or move. */
  renamedFrom?: string;
  added?: number;
  removed?: number;
};

export async function mockVault(page: Page, options: MockVaultOptions) {
  const {
    files,
    assets = {},
    folders = [],
    open,
    drawing,
    noVault = false,
    otherVaults = [],
    theme = "dark",
    versions = {},
    current = {},
    assistant = null,
    companion = false,
  } = options;

  await page.addInitScript(
    ({ vaultPath, files, binaries, folders, theme, open, drawing, noVault, otherVaults, versions, current, assistant, companion }) => {
      const now = Date.now();
      const seconds = Math.floor(now / 1000);
      const relative = (filePath: string) =>
        filePath.replace(`${vaultPath}/`, "");

      window.__saves = [];
      window.__exports = [];
      window.__commands = [];
      window.__binaries = binaries;
      window.__assetScope = { folders: [], files: [] };
      const allowFolder = (folder: string) => {
        if (!window.__assetScope.folders.includes(folder)) window.__assetScope.folders.push(folder);
      };
      window.__vaultFiles = files;

      localStorage.setItem(
        "netherstone-vault",
        JSON.stringify({
          state: {
            currentVaultPath: noVault ? null : vaultPath,
            recentVaults: noVault ? otherVaults : [vaultPath, ...otherVaults],
          },
          version: 0,
        }),
      );
      localStorage.setItem(
        "netherstone-settings",
        JSON.stringify({
          state: {
            onboardingCompletedAt: now - 86_400_000,
            theme,
            companionUnlocked: companion,
            showCompanion: companion,
          },
          version: 2,
        }),
      );
      localStorage.setItem(
        "netherstone-ui",
        JSON.stringify({
          state: {
            isSidebarOpen: true,
            isSidebarOpenOutsideCanvas: true,
            isRightSidebarOpen: false,
            activeNavItem: "notes",
            recentFiles: open
              ? [{ path: `${vaultPath}/${open}`, name: open.replace(/\.md$/, "") }]
              : [],
            pinnedFiles: [],
            ...(drawing
              ? { appMode: "canvas", activeDrawingPath: `${vaultPath}/${drawing}` }
              : {}),
          },
          version: 0,
        }),
      );

      const tree = [
        ...folders.map((name) => ({
          name,
          path: `${vaultPath}/${name}`,
          kind: "directory",
          children: [],
        })),
        ...Object.keys(files).map((name) => ({
          name,
          path: `${vaultPath}/${name}`,
          kind: "file",
        })),
      ];

      type Args = Record<string, string>;
      type Options = { headers?: Record<string, string> };
      const handlers: Record<string, (args: Args, options?: Options) => unknown> = {
        scan_vault: ({ vaultPath }) => {
          allowFolder(vaultPath);
          return tree;
        },
        start_vault_watcher: ({ vaultPath }) => {
          allowFolder(vaultPath);
          return null;
        },
        // As the desktop app: pictures, sound and video are let through.
        show_linked_file: ({ filePath }) => {
          const exists = relative(filePath) in binaries;
          if (exists && /\.(png|jpe?g|gif|webp|svg|wav|mp3|mp4|webm)$/i.test(filePath)) {
            window.__assetScope.files.push(filePath);
          }
          return exists;
        },
        index_vault: () => "ok",
        open_markdown_file: ({ filePath }) => ({
          file_path: filePath,
          markdown: files[relative(filePath)] ?? "",
          content_hash: `hash-${relative(filePath)}`,
          cache_hit: false,
          plate_value: null,
        }),
        read_markdown_file: ({ filePath }) => files[relative(filePath)] ?? "",
        save_markdown_file: ({ filePath, content, expectedContent }) => {
          // As the desktop app: a save never writes over an outside change.
          const current = files[relative(filePath)];
          if (expectedContent !== undefined && current !== undefined && current !== expectedContent) {
            throw "The shard changed on disk";
          }
          files[relative(filePath)] = content;
          window.__saves.push({ filePath, content });
          return null;
        },
        file_exists: ({ path, filePath }) => {
          const name = relative(path ?? filePath ?? "");
          return name in files || name in binaries;
        },
        read_drawing_file: ({ filePath }) => files[relative(filePath)] ?? "",
        save_drawing_file: ({ filePath, content, expectedContent }) => {
          // As the desktop app: a save never writes over an outside change.
          const current = files[relative(filePath)];
          if (expectedContent !== undefined && current !== undefined && current !== expectedContent) {
            throw "The shard changed on disk";
          }
          files[relative(filePath)] = content;
          window.__saves.push({ filePath, content });
          return null;
        },
        // Attachments are kept with the test's other binary files.
        persist_attachment_bytes: (bytes, options) => {
          allowFolder(decodeURIComponent(options!.headers!["x-vault-path"]));
          const assetPath = `_attachments/${decodeURIComponent(options!.headers!["x-file-name"])}`;
          binaries[assetPath] = btoa(
            String.fromCharCode(...(bytes as unknown as Uint8Array)),
          );
          return {
            assetPath,
            absolutePath: `${vaultPath}/${assetPath}`,
            syncStatus: "syncable",
          };
        },
        append_markdown_to_file: ({ filePath, markdown }) => {
          files[relative(filePath)] = `${files[relative(filePath)] ?? ""}\n${markdown}`;
          window.__saves.push({ filePath, content: files[relative(filePath)] });
          return null;
        },
        take_launch: () => ({ vault: null, files: [], waiting: [] }),
        integrations_get: () => ({ openWith: null, folderMenu: null, terminal: null }),
        choose_export_path: ({ defaultName, format }) =>
          `/home/me/${defaultName}.${format}`,
        write_export_file: (bytes) => {
          const head = (bytes as unknown as Uint8Array).subarray(0, 16);
          window.__exports.push(String.fromCharCode(...head));
          return null;
        },
        // Importing: the picker returns every binary file, read as bytes.
        open_import_dialog: () => Object.keys(binaries).map((name) => `${vaultPath}/${name}`),
        list_import_sources: ({ paths }) =>
          (paths as unknown as string[]).map((path) => ({
            path,
            relativePath: relative(path),
            size: atob(binaries[relative(path)]).length,
          })),
        vault_free_space: () => Number.MAX_SAFE_INTEGER,
        read_import_file: ({ path }) =>
          Uint8Array.from(atob(binaries[relative(path)]), (c) => c.charCodeAt(0)).buffer,
        read_import_file_range: ({ path, offset, length }) =>
          Uint8Array.from(atob(binaries[relative(path)]), (c) => c.charCodeAt(0)).slice(
            Number(offset),
            Number(offset) + Number(length),
          ).buffer,
        reserve_import_paths: ({ targetDir, relativePaths }) =>
          (relativePaths as unknown as string[]).map(
            (path) => `${targetDir}/${path.replace(/\.[^./]+$/, "")}.md`,
          ),
        save_imported_shard: ({ filePath, content }) => {
          files[relative(filePath)] = content;
          window.__saves.push({ filePath, content });
          return filePath;
        },
        import_attachment: ({ path }) => {
          const assetPath = `_attachments/${path.slice(path.lastIndexOf("/") + 1)}`;
          binaries[assetPath] = binaries[relative(path)];
          return {
            assetPath,
            absolutePath: `${vaultPath}/${assetPath}`,
            syncStatus: "syncable",
          };
        },
        get_file_metadata: ({ filePath }) => {
          const content = files[relative(filePath)] ?? "";
          return {
            created_at: seconds,
            last_modified: seconds,
            word_count: 1,
            character_count: content.length,
            file_size: content.length,
            tags: [],
          };
        },
        get_backlinks: () => [],
        get_backlinks_count: () => 0,
        get_tagged_files: () => [],
        search_files: () => [],
        find_shards_containing: () => [],
        stale_drawing_pictures: () => [],
        sync_get_vault_record: () => null,
        // Versions are named by file and position: "Note.md#0" is the newest.
        history_list_versions: ({ filePath }) => {
          const path = relative(filePath);
          const listed = (
            version: Omit<MockVersion, "content">,
            id: string,
          ) => ({
            id,
            blob: id,
            time: version.time,
            kind: version.kind ?? "edited",
            restoredFrom: null,
            path,
            renamedFrom: version.renamedFrom ?? null,
            added: version.added ?? 0,
            removed: version.removed ?? 0,
            changed: 0,
            counted: true,
          });
          return {
            current: current[path] ? listed(current[path], `${path}#now`) : null,
            versions: (versions[path] ?? []).map((version, index) =>
              listed(version, `${path}#${index}`),
            ),
          };
        },
        history_read_version: ({ blob }) => {
          const [path, index] = blob.split("#");
          return versions[path][Number(index)].content;
        },
        history_restore: ({ filePath, blob, versionTime }) => {
          const [path, index] = blob.split("#");
          const name = relative(filePath);
          const before = files[name];
          versions[name].unshift({ time: Math.floor(Date.now() / 1000), content: before });
          const content = versions[path][Number(index) + 1].content;
          files[name] = content;
          window.__saves.push({ filePath, content });
          return { content, undo: { blob: `${name}#0`, time: Number(versionTime) } };
        },
        github_get_account: () => null,
        ...assistantHandlers(),
      };

      function assistantHandlers(): Record<string, (args: Args) => unknown> {
        const setup = { ...assistant };
        const model = {
          id: "claude-sonnet-5-5",
          name: "Claude Sonnet 5.5",
          reasoning: true,
          tools: true,
          images: setup.images ?? true,
          pdfs: true,
          caching: true,
          responsesOnly: false,
        };
        type Shown = { seq: number; role: string; text: string; shards?: string[]; sources?: string[] };
        type Change = { id: string; turn: number; kind: string; path: string; count: number; state: string; before?: string; moving?: unknown };
        type Offer = { id: string; turn: number; text: string; state: string };
        const chats: { id: string; title: string; vault: string; created: number; updated: number; messages: Shown[]; changes: Change[]; memories: Offer[] }[] = [];
        const memory = [...(setup.memory ?? [])];
        window.__memory = memory;
        const findOffer = (id: string) => {
          for (const chat of chats) {
            const found = chat.memories.find((offer) => offer.id === id);
            if (found) return { chat, offer: found };
          }
          throw "That memory item isn't there anymore";
        };
        const shownMemory = () => ({ items: [...memory], maxItems: 30, maxLength: 200 });
        const findChange = (id: string) => {
          for (const chat of chats) {
            const found = chat.changes.find((change) => change.id === id);
            if (found) return { chat, change: found };
          }
          throw "That change isn't there anymore";
        };
        let changes = 0;
        window.__sent = [];
        window.__asked = [];
        const held: Record<string, () => void> = {};
        return {
          assistant_status: () => ({
            enabled: assistant !== null,
            sendFiles: setup.sendFiles ?? true,
            keyringAvailable: true,
            model: setup.picked
              ? { provider: "anthropic", server: null, model: model.id }
              : null,
            providers: [
              {
                id: "anthropic",
                name: "Anthropic",
                setup: "key",
                keyPage: null,
                key: setup.provider ? "keyring" : null,
                servers: [],
                custom: null,
              },
            ],
          }),
          assistant_picked: () =>
            setup.picked
              ? { id: model.id, name: model.name, provider: "Anthropic", local: false, images: model.images }
              : null,
          assistant_models: () => [model],
          assistant_set_model: () => {
            setup.picked = true;
            return null;
          },
          mcp_vaults: () => [{ path: vaultPath, name: "Vault", allowed: setup.vaultAllowed ?? false }],
          mcp_set_vault_allowed: (args) => {
            setup.vaultAllowed = (args as unknown as { allowed: boolean }).allowed;
            return null;
          },
          assistant_send: (args) => {
            const { chat, text, shards, events } = args as unknown as {
              chat: string | null;
              text: string;
              shards: string[];
              events: { id: number };
            };
            window.__sent.push({ chat, text, shards });
            let index = 0;
            const send = (message: unknown) => callbacks[events.id]?.({ index: index++, message });
            const now = Date.now();
            let found = chats.find((c) => c.id === chat);
            if (!found) {
              found = { id: `chat-${chats.length + 1}`, title: text, vault: vaultPath, created: now, updated: now, messages: [], changes: [], memories: [] };
              chats.unshift(found);
            }
            const answer = setup.answer ?? ["Done."];
            const reads = setup.reads ?? [];
            found.messages.push({ seq: found.messages.length + 1, role: "user", text, shards });
            const turn = found.messages.length;
            send({ type: "chat", id: found.id });
            for (const path of reads) send({ type: "tool", name: "read", paths: [path] });
            if (setup.change) {
              send({ type: "tool", name: "edit_shard", paths: [setup.change.path] });
              const { kind = "shard", moving } = setup.change;
              found.changes.push({ id: `change-${++changes}`, turn, kind, path: setup.change.path, count: 1, state: "pending", ...(moving ? { moving } : {}) });
            }
            if (setup.remember) {
              send({ type: "tool", name: "remember", paths: [] });
              found.memories.push({ id: `offer-${++changes}`, turn, text: setup.remember, state: "pending" });
            }
            if (reads.length) send({ type: "sources", shards: reads });
            for (const piece of answer) send({ type: "text", text: piece });
            send({ type: "done", stop: "done", usage: { input: 1, output: 1 } });
            found.messages.push({ seq: found.messages.length + 1, role: "assistant", text: answer.join(""), sources: reads });
            found.updated = now;
            return found.id;
          },
          assistant_ask_inline: (args) => {
            const { id, shard, selection, whole, prompt, events } = args as unknown as {
              id: string;
              shard: string;
              selection: string;
              whole: boolean;
              prompt: string;
              events: { id: number };
            };
            window.__asked.push({ shard, selection, whole, prompt });
            let index = 0;
            const send = (message: unknown) => callbacks[events.id]?.({ index: index++, message });
            if (setup.holdInline) {
              return new Promise((resolve) => {
                held[id] = () => {
                  send({ type: "stopped" });
                  resolve(null);
                };
              });
            }
            for (const piece of setup.inline ?? ["Done."]) send({ type: "text", text: piece });
            send({ type: "done", stop: "done", usage: { input: 1, output: 1 } });
            return null;
          },
          assistant_stop: (args) => {
            const id = (args as unknown as { chat: string }).chat;
            held[id]?.();
            delete held[id];
            return null;
          },
          assistant_chats: () => chats.map(({ messages: _, ...info }) => info),
          assistant_chat: (args) => {
            const found = chats.find((c) => c.id === (args as unknown as { chat: string }).chat);
            if (!found) throw { kind: "noChat" };
            // A copy, as the app's answer is: changes made later don't reach it.
            return structuredClone(found);
          },
          assistant_retitle: (args) => {
            const found = chats.find((c) => c.id === (args as unknown as { chat: string }).chat);
            if (!found || !setup.title) throw { kind: "failed" };
            found.title = setup.title;
            return setup.title;
          },
          assistant_delete_chat: (args) => {
            const at = chats.findIndex((c) => c.id === (args as unknown as { chat: string }).chat);
            if (at !== -1) chats.splice(at, 1);
            return null;
          },
          assistant_delete_chats: () => {
            chats.length = 0;
            return null;
          },
          assistant_change_preview: (args) => {
            const { change } = findChange((args as unknown as { change: string }).change);
            return { path: change.path, before: files[change.path] ?? "", after: setup.change?.after };
          },
          assistant_apply: (args) => {
            const { change } = findChange((args as unknown as { change: string }).change);
            const after = setup.change?.after ?? "";
            change.before = files[change.path];
            files[change.path] = after;
            window.__saves.push({ filePath: `${vaultPath}/${change.path}`, content: after });
            change.state = "applied";
            return { path: change.path, content: after };
          },
          assistant_undo: (args) => {
            const { change } = findChange((args as unknown as { change: string }).change);
            const before = change.before ?? "";
            files[change.path] = before;
            window.__saves.push({ filePath: `${vaultPath}/${change.path}`, content: before });
            change.state = "pending";
            return { path: change.path, content: before };
          },
          assistant_discard: (args) => {
            const { chat, change } = findChange((args as unknown as { change: string }).change);
            chat.changes = chat.changes.filter((c) => c !== change);
            return null;
          },
          // Off drops every change and memory item not applied yet, as the app does.
          assistant_set_enabled: (args) => {
            if (!(args as unknown as { enabled: boolean }).enabled) {
              for (const chat of chats) {
                chat.changes = chat.changes.filter((c) => c.state !== "pending");
                chat.memories = chat.memories.filter((m) => m.state !== "pending");
              }
            }
            return null;
          },
          assistant_memory: () => shownMemory(),
          assistant_memory_edit: (args) => {
            const { item, text } = args as unknown as { item: string; text: string };
            memory[memory.indexOf(item)] = text.trim();
            return shownMemory();
          },
          assistant_memory_delete: (args) => {
            const at = memory.indexOf((args as unknown as { item: string }).item);
            if (at !== -1) memory.splice(at, 1);
            return shownMemory();
          },
          assistant_memory_delete_all: () => {
            memory.length = 0;
            return null;
          },
          assistant_remember: (args) => {
            const { offer } = findOffer((args as unknown as { offer: string }).offer);
            memory.push(offer.text);
            offer.state = "applied";
            return null;
          },
          assistant_forget: (args) => {
            const { offer } = findOffer((args as unknown as { offer: string }).offer);
            memory.splice(memory.indexOf(offer.text), 1);
            offer.state = "pending";
            return null;
          },
          assistant_discard_offer: (args) => {
            const { chat, offer } = findOffer((args as unknown as { offer: string }).offer);
            chat.memories = chat.memories.filter((m) => m !== offer);
            return null;
          },
        };
      }

      let callbackId = 0;
      const callbacks: Record<number, (event: unknown) => void> = {};
      const listeners: Record<string, number[]> = {};
      // Sends an event from the "backend" to the app's listeners.
      window.__emit = (event, payload) => {
        for (const id of listeners[event] ?? []) callbacks[id]?.({ event, id, payload });
      };
      (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { windowLabel: "main", label: "main" },
        },
        transformCallback: (callback: (event: unknown) => void) => {
          callbacks[++callbackId] = callback;
          return callbackId;
        },
        unregisterCallback: () => {},
        // As on Windows; the route below serves these from `assets`.
        convertFileSrc: (path: string) =>
          `http://asset.localhost/${encodeURIComponent(path)}`,
        invoke: async (command: string, args: Args = {}, options?: Options) => {
          window.__commands.push({ command, args });
          if (handlers[command]) return handlers[command](args, options);
          if (command.startsWith("plugin:event|listen")) {
            const { event, handler } = args as unknown as { event: string; handler: number };
            (listeners[event] ??= []).push(handler);
            return ++callbackId;
          }
          if (command === "plugin:app|version") return "0.0.0-e2e";
          return null;
        },
      };
      (window as unknown as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ =
        { unregisterListener: () => {} };
    },
    {
      vaultPath: VAULT_PATH,
      files,
      binaries: Object.fromEntries(
        Object.entries(assets).map(([name, bytes]) => [name, bytes.toString("base64")]),
      ),
      folders,
      theme,
      open,
      drawing,
      noVault,
      otherVaults,
      versions,
      current,
      assistant,
      companion,
    },
  );

  // The desktop app sends no network requests; a browser does (favicons,
  // fonts the bundle already carries). Let nothing leave the page.
  await page.route(/^(?!http:\/\/(localhost|127\.0\.0\.1))/, (route: Route) =>
    route.abort(),
  );
  // The asset protocol, which shows the vault's files in shards. Like the
  // desktop app, it refuses files outside what it was allowed to serve.
  await page.route("http://asset.localhost/**", async (route: Route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname.slice(1));
    const found = await page.evaluate(
      ({ path, vaultPath }) => {
        const { folders, files } = window.__assetScope;
        const allowed =
          files.includes(path) || folders.some((folder) => path.startsWith(`${folder}/`));
        return { allowed, data: window.__binaries[path.replace(`${vaultPath}/`, "")] ?? null };
      },
      { path, vaultPath: VAULT_PATH },
    );
    if (!found.allowed) return route.fulfill({ status: 403 });
    if (!found.data) return route.fulfill({ status: 404 });
    const extension = path.split(".").pop() ?? "";
    const types: Record<string, string> = { png: "image/png", wav: "audio/wav", mp4: "video/mp4", pdf: "application/pdf" };
    return route.fulfill({
      body: Buffer.from(found.data, "base64"),
      contentType: types[extension] ?? "application/octet-stream",
    });
  });

  await page.goto("/");
  if (open) await page.locator("[data-slate-editor]").first().waitFor();
}

export const editor = (page: Page) => page.locator("[data-slate-editor]").first();

/** Opens a shard from the sidebar by its name (without `.md`). */
export async function openShard(page: Page, name: string) {
  await page.getByText(name, { exact: true }).first().click();
  await editor(page).waitFor();
}

/** Places the caret at the end of the block holding `text`. */
export async function caretAfter(page: Page, text: string) {
  const block = editor(page)
    .locator("[data-slate-node='element']")
    .filter({ hasText: text })
    .last();
  await block.scrollIntoViewIfNeeded();
  // One click on the end of the text, so the editor sees a single caret
  // move, as when someone clicks there.
  const end = await block.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let last: Text | null = null;
    while (walker.nextNode()) {
      if ((walker.currentNode as Text).length > 0) last = walker.currentNode as Text;
    }
    const range = document.createRange();
    range.selectNodeContents(last!);
    const rects = range.getClientRects();
    const rect = rects[rects.length - 1];
    return { x: rect.right - 1, y: rect.top + rect.height / 2 };
  });
  await page.mouse.click(end.x, end.y);
}

/** The cells of a table's first row (the row handle column is not a cell). */
export const cellsOf = (row: Locator) =>
  row.locator("> [data-slate-node='element']");

/**
 * Changes a file the way another app would, and reports it as the vault
 * watcher does.
 */
export async function changeOutside(page: Page, name: string, content: string) {
  await page.evaluate(
    ({ filePath, name, content }) => {
      window.__vaultFiles[name] = content;
      window.__emit("vault:changed", { paths: [filePath] });
    },
    { filePath: `${VAULT_PATH}/${name}`, name, content },
  );
}

/**
 * Picks an option in an open / or @ menu with Enter, once it is the
 * highlighted one. The menu filters as you type, so an option can show
 * before Enter would pick it.
 */
export async function pickOption(page: Page, option: Locator) {
  await expect(option).toHaveAttribute("data-active-item", "true");
  await page.keyboard.press("Enter");
  await menuClosed(page);
}

/**
 * Waits for the editor to take focus back from a closed / or @ menu. Until
 * then, keys go nowhere.
 */
export async function menuClosed(page: Page) {
  await expect(editor(page)).toBeFocused();
}

/** Waits for autosave and returns the content it wrote for the shard. */
export async function lastSave(page: Page, name: string): Promise<string> {
  const filePath = `${VAULT_PATH}/${name}`;
  // Autosave is debounced, so a save can still be pending after the first
  // one lands. The top bar shows "Saved" only once nothing is left to write.
  await page.waitForFunction(
    (filePath) =>
      window.__saves.some((save) => save.filePath === filePath) &&
      document.querySelector('[aria-label="Saved"]') !== null,
    filePath,
    { timeout: 10_000 },
  );
  return page.evaluate(
    (filePath) =>
      window.__saves.filter((save) => save.filePath === filePath).at(-1)!
        .content,
    filePath,
  );
}

export async function savesFor(page: Page, name: string): Promise<Save[]> {
  const filePath = `${VAULT_PATH}/${name}`;
  return page.evaluate(
    (filePath) => window.__saves.filter((save) => save.filePath === filePath),
    filePath,
  );
}

/** Pastes through the real clipboard, so the app's paste handlers run. */
export async function paste(
  page: Page,
  data: { html?: string; text?: string },
) {
  await page.evaluate(async ({ html, text }) => {
    const items: Record<string, Blob> = {};
    if (html) items["text/html"] = new Blob([html], { type: "text/html" });
    if (text) items["text/plain"] = new Blob([text], { type: "text/plain" });
    await navigator.clipboard.write([new ClipboardItem(items)]);
  }, data);
  await page.keyboard.press("Control+V");
}

export type TableMeasure = {
  editorWidth: number;
  tableWidth: number;
  height: number;
  columns: number[];
};

export async function measureTables(page: Page): Promise<TableMeasure[]> {
  return page.evaluate(() => {
    const root = document.querySelector("[data-slate-editor]")!;
    // The text column: the editor's width without the gutters around it.
    const rootStyle = getComputedStyle(root);
    const editorWidth = Math.round(
      root.getBoundingClientRect().width -
        parseFloat(rootStyle.paddingLeft) -
        parseFloat(rootStyle.paddingRight),
    );
    return [...root.querySelectorAll("table")].map((table) => ({
      editorWidth,
      tableWidth: Math.round(table.getBoundingClientRect().width),
      height: Math.round(table.getBoundingClientRect().height),
      columns: [
        ...(table.querySelector("tr")?.querySelectorAll(
          ":scope > [data-slate-node='element']",
        ) ?? []),
      ].map((cell) => Math.round(cell.getBoundingClientRect().width)),
    }));
  });
}
