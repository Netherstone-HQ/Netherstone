# Contributing

Thanks for helping with Netherstone. Bug reports, ideas and pull requests
are all welcome. Everyone taking part is expected to follow the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Reporting a problem

Open an [issue](https://github.com/Netherstone-HQ/Netherstone/issues/new/choose)
and pick Bug report or Feature request. For a security problem, don't open
an issue: follow [SECURITY.md](SECURITY.md) instead.

## Making a change

For anything bigger than a small fix, open an issue first so we can agree
on the approach before you spend time on it.

1. Set up the app with the steps in
   [Building from source](../README.md#building-from-source).
2. Make a branch named `fix/…` for a fix or `feat/…` for something new,
   for example `fix/rename-false-error`.
3. Before you open a pull request, check that these pass:

   ```sh
   pnpm exec tsc --noEmit   # typecheck
   pnpm test                # frontend tests
   mkdir -p dist && (cd src-tauri && cargo test)   # Rust tests
   ```

   Add or update tests for what you changed.

## Pull requests

Keep each pull request to one change. Name it after what changes for the
user, in plain words, for example "Keep focus in the rename field after
choosing Rename from a menu". In the description:

- **Before:** what happened until now.
- **After:** what happens with this change.
- **How:** how the change works, and how it was tested.

The [architecture docs](../docs/ARCHITECTURE.md) explain how the app fits
together.

## License

By contributing, you agree that your contributions are licensed under the
[GNU GPL-3.0](../LICENSE), like the rest of the project.
