// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { named, pickFiles } from "./pick-files";

describe("named", () => {
  it("names a file the photo picker numbered by what it is", () => {
    const picked = named(new File(["x"], "1000000018.png", { type: "image/png" }), "image");
    expect(picked.name).toBe("picture.png");
    expect(picked.type).toBe("image/png");
  });

  it("keeps a file's own name", () => {
    const file = new File(["x"], "Trip 2024.jpg");
    expect(named(file, "image")).toBe(file);
  });

  it("names a picture from the camera a photo", () => {
    const shot = new File(["x"], "JPEG_20261124_194322_80871.jpg", { type: "image/jpeg" });
    expect(named(shot, "image", true).name).toBe("photo.jpg");
  });

  it("names a numbered file without an extension too", () => {
    expect(named(new File(["x"], "42"), "audio").name).toBe("sound");
  });
});

describe("pickFiles", () => {
  /** The file input pickFiles makes, caught as it opens. */
  function nextInput(): Promise<HTMLInputElement> {
    return new Promise((resolve) => {
      const click = HTMLInputElement.prototype.click;
      HTMLInputElement.prototype.click = function (this: HTMLInputElement) {
        HTMLInputElement.prototype.click = click;
        resolve(this);
      };
    });
  }

  it("asks for the camera only when told to", async () => {
    const opened = nextInput();
    const picked = pickFiles("image", { camera: true });
    const input = await opened;
    expect(input.accept).toBe("image/*");
    expect(input.getAttribute("capture")).toBe("environment");
    input.dispatchEvent(new Event("cancel"));
    expect(await picked).toEqual([]);
  });

  it("resolves with the chosen files, named", async () => {
    const opened = nextInput();
    const picked = pickFiles("video", { multiple: true });
    const input = await opened;
    expect(input.multiple).toBe(true);
    expect(input.hasAttribute("capture")).toBe(false);
    const files = [new File(["v"], "77.mp4", { type: "video/mp4" })];
    Object.defineProperty(input, "files", { value: files });
    input.dispatchEvent(new Event("change"));
    expect((await picked).map((file) => file.name)).toEqual(["video.mp4"]);
  });
});
