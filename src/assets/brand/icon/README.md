# Windows icon sources

Each SVG here is the stone drawn for one pixel size, with its edges on that
size's pixel grid. `netherstone-icon-48.svg` is the master mark cropped to its
48 px box. These cover the bare-stone sizes in `src-tauri/icons/icon.ico`. The
64 and 256 px entries use the tiled app icon (`../netherstone-app-icon.svg`).

## Rebuilding icon.ico

Render each size with `tauri icon` (resvg):

```sh
pnpm tauri icon src/assets/brand/icon/netherstone-icon-16.svg -o out/16 -p 16
# ...the same for 20, 24, 30, 32, 40 and 48
pnpm tauri icon src/assets/brand/netherstone-app-icon.svg -o out/tile -p 64 -p 256
```

Then build the .ico with ImageMagick, keeping 32 px first. Tauri uses the first
entry as the window icon until `window_icon.rs` replaces it with the size
that matches the DPI:

```sh
magick out/32/32x32.png out/16/16x16.png out/20/20x20.png out/24/24x24.png \
  out/30/30x30.png out/40/40x40.png out/48/48x48.png out/tile/64x64.png \
  out/tile/256x256.png -define icon:png-compression-size=256 src-tauri/icons/icon.ico
```

icon-gen and png-to-ico can't be used here: both reorder the entries, and
icon-gen drops the 20, 30 and 40 px sizes.

After changing the icon, run `cargo clean -p Netherstone` so the new one is
embedded in the exe.
