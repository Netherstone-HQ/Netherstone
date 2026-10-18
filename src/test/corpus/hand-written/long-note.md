# Project Netherstone

> Your knowledge, set in stone.

## Overview

Netherstone is a local-first desktop app for knowledge. Each document is a **shard**, a vault is a folder of Markdown files, and sync is a Git repository the user owns.

### Goals

1. Files stay plain Markdown that other tools can read.
2. Nothing the user writes is ever lost on save.
3. The editor hides Markdown syntax but never fights it.

### Non-goals

- A developer tool
- A hosted service (for now)

## Architecture

| Layer | Technology | Notes |
| ----- | ---------- | ----- |
| UI | React 19, Plate | Rich text editor over Slate |
| Backend | Rust, Tauri v2 | File system, SQLite FTS |
| Sync | Git | Free, user-owned |

The backend exposes commands such as `open_markdown_file` and `save_markdown_file`:

```rust
#[tauri::command]
fn save_markdown_file(file_path: String, content: String) -> Result<(), String> {
    std::fs::write(&file_path, content).map_err(|e| e.to_string())
}
```

## Links

See [the roadmap](./Projects/Roadmap.md), [the website](https://netherstone.app) and the image below.

![Screenshot of the editor](attachments/screenshot.png)

## Math

The weight is $w = \frac{1}{n}$ and the total is:

$$
S = \sum_{i=1}^{n} w_i x_i
$$

---

Last updated in October 2026. Questions go to the maintainer.
