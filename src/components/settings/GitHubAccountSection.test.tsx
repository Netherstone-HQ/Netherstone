// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGitHubStore } from "@/store/github";
import { GitHubAccountSection } from "./GitHubAccountSection";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(async () => {}),
}));

const ACCOUNT = { login: "octocat", name: "The Octocat", avatarUrl: null };
const CODE = {
  userCode: "WDJB-MJHT",
  verificationUri: "https://github.com/login/device",
  expiresIn: 900,
};

type Handlers = Record<string, () => Promise<unknown>>;

function mockCommands(handlers: Handlers) {
  vi.mocked(invoke).mockImplementation(async (command: string) => {
    const handler = handlers[command];
    return handler ? handler() : undefined;
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("GitHubAccountSection", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(openUrl).mockClear();
    useGitHubStore.setState({
      account: null,
      loaded: false,
      signIn: { kind: "idle" },
      error: null,
      installation: null,
      installationError: null,
      tokenStorage: null,
    });
  });

  afterEach(cleanup);

  it("signs in with a device code and shows the account", async () => {
    const approval = deferred<typeof ACCOUNT | null>();
    mockCommands({
      github_get_account: async () => null,
      github_start_sign_in: async () => CODE,
      github_finish_sign_in: () => approval.promise,
    });
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn(async () => {}) },
    });

    render(<GitHubAccountSection />);
    fireEvent.click(
      await screen.findByRole("button", { name: /connect github/i }),
    );

    expect(await screen.findByText("WDJB-MJHT")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: /copy code and open github/i }),
    );
    await vi.waitFor(() =>
      expect(openUrl).toHaveBeenCalledWith(CODE.verificationUri),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("WDJB-MJHT");

    await act(async () => approval.resolve(ACCOUNT));
    expect(await screen.findByText("The Octocat")).toBeTruthy();
    expect(screen.getByText("@octocat")).toBeTruthy();
  });

  it("asks to install the GitHub App until it is installed", async () => {
    let installed = false;
    mockCommands({
      github_get_account: async () => ACCOUNT,
      github_get_installation: async () => ({
        installed,
        installedOn: installed ? ["octocat"] : [],
        installUrl: "https://github.com/apps/netherstone-app/installations/new",
      }),
    });

    render(<GitHubAccountSection />);
    fireEvent.click(
      await screen.findByRole("button", { name: /install on github/i }),
    );
    expect(openUrl).toHaveBeenCalledWith(
      "https://github.com/apps/netherstone-app/installations/new",
    );

    installed = true;
    await act(async () => window.dispatchEvent(new Event("focus")));
    await vi.waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /install on github/i }),
      ).toBeNull(),
    );
  });

  it("opens the app install page right after signing in when it isn't installed", async () => {
    mockCommands({
      github_get_account: async () => null,
      github_start_sign_in: async () => CODE,
      github_finish_sign_in: async () => ACCOUNT,
      github_get_installation: async () => ({
        installed: false,
        installedOn: [],
        installUrl: "https://github.com/apps/netherstone-app/installations/new",
      }),
    });

    render(<GitHubAccountSection />);
    fireEvent.click(
      await screen.findByRole("button", { name: /connect github/i }),
    );
    await vi.waitFor(() =>
      expect(openUrl).toHaveBeenCalledWith(
        "https://github.com/apps/netherstone-app/installations/new",
      ),
    );
    expect(await screen.findByText(/continues on its own/i)).toBeTruthy();
  });

  it("returns to signed out when the sign-in is cancelled", async () => {
    const approval = deferred<typeof ACCOUNT | null>();
    mockCommands({
      github_get_account: async () => null,
      github_start_sign_in: async () => CODE,
      github_finish_sign_in: () => approval.promise,
    });

    render(<GitHubAccountSection />);
    fireEvent.click(
      await screen.findByRole("button", { name: /connect github/i }),
    );
    fireEvent.click(await screen.findByRole("button", { name: /cancel/i }));

    expect(invoke).toHaveBeenCalledWith("github_cancel_sign_in");
    await act(async () => approval.resolve(null));
    expect(
      screen.getByRole("button", { name: /connect github/i }),
    ).toBeTruthy();
  });

  it("shows sign-in errors and signs out", async () => {
    mockCommands({
      github_get_account: async () => null,
      github_start_sign_in: async () => {
        throw "Couldn't reach GitHub. Check your internet connection and try again.";
      },
    });

    render(<GitHubAccountSection />);
    fireEvent.click(
      await screen.findByRole("button", { name: /connect github/i }),
    );
    expect(await screen.findByText(/couldn't reach github/i)).toBeTruthy();

    cleanup();
    mockCommands({
      github_get_account: async () => ACCOUNT,
      github_sign_out: async () => undefined,
    });
    render(<GitHubAccountSection />);
    fireEvent.click(await screen.findByRole("button", { name: /disconnect/i }));
    expect(
      await screen.findByRole("button", { name: /connect github/i }),
    ).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith("github_sign_out");
  });

  // Some Linux desktops have no keyring to keep the sign-in in.
  describe("without a keyring", () => {
    const NO_KEYRING = { keyringAvailable: false, current: null };

    it("offers to remember the sign-in, and can sign in without saving it", async () => {
      mockCommands({
        github_get_account: async () => null,
        github_token_storage: async () => NO_KEYRING,
        github_start_sign_in: async () => CODE,
        github_finish_sign_in: async () => ACCOUNT,
      });

      render(<GitHubAccountSection />);
      const remember = await screen.findByRole("checkbox", {
        name: /remember this sign-in/i,
      });
      expect(remember.getAttribute("aria-checked")).toBe("true");
      expect(
        screen.getByText(/saved in a file only your account/i),
      ).toBeTruthy();

      fireEvent.click(remember);
      expect(remember.getAttribute("aria-checked")).toBe("false");
      expect(screen.getByText(/connect again each time/i)).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: /connect github/i }));
      await vi.waitFor(() =>
        expect(invoke).toHaveBeenCalledWith("github_finish_sign_in", {
          remember: false,
        }),
      );
    });

    it("says where the sign-in is kept once connected", async () => {
      mockCommands({
        github_get_account: async () => ACCOUNT,
        github_token_storage: async () => ({
          keyringAvailable: false,
          current: "file",
        }),
      });
      render(<GitHubAccountSection />);
      expect(
        await screen.findByText(/install gnome keyring or kwallet/i),
      ).toBeTruthy();

      cleanup();
      mockCommands({
        github_get_account: async () => ACCOUNT,
        github_token_storage: async () => ({
          keyringAvailable: false,
          current: "memory",
        }),
      });
      render(<GitHubAccountSection />);
      expect(
        await screen.findByText(/isn't saved on this computer/i),
      ).toBeTruthy();
    });
  });

  it("asks nothing about remembering when there is a keyring", async () => {
    mockCommands({
      github_get_account: async () => null,
      github_token_storage: async () => ({
        keyringAvailable: true,
        current: null,
      }),
      github_start_sign_in: async () => CODE,
      github_finish_sign_in: async () => ACCOUNT,
    });

    render(<GitHubAccountSection />);
    fireEvent.click(
      await screen.findByRole("button", { name: /connect github/i }),
    );
    expect(screen.queryByRole("checkbox")).toBeNull();
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("github_finish_sign_in", {
        remember: true,
      }),
    );
  });
});
