# CODEBUDDY.md

This file guides CodeBuddy Code when working in this repository.

## Project Purpose

This is a research project to **fix a bug in [Ink](https://github.com/vadimdemedes/ink) where the TUI does not redraw correctly when the terminal is resized on Windows**. The repo was scaffolded with `create-ink-app` and serves as a minimal reproduction / testbed for the resize fix.

## Tech Stack

- **Ink 4** + **React 18** — render React components to the terminal (TUI).
- **TypeScript 5** (ESM, `"type": "module"`).
- **meow** — CLI argument parsing.
- **ava** + **ink-testing-library** — testing.
- **xo** + **prettier** — linting/formatting.

## Commands

```bash
npm run build      # tsc -> compiles source/*.tsx to dist/
npm run dev        # tsc --watch
npm test           # prettier --check . && xo && ava (lint + format + tests)

node dist/cli.js   # run the compiled CLI

# Run a single test by title:
npx ava --match='greet unknown user'
```

After editing `.tsx` files, run `npm run build` before executing `dist/cli.js`.

## Structure

- `source/cli.tsx` — entry point (`bin` -> `dist/cli.js`). Contains the interactive `Counter` component that exercises Ink's `useInput`, `Static`, and `Box`/border rendering — this is the surface where the Windows resize bug manifests.
- `source/app.tsx` — simple `App` greeting component (used by tests).
- `test.tsx` — ava tests for `App` via `ink-testing-library`.
- `dist/` — compiled output (gitignored).

## Important Notes

- **No `tsconfig.json` is checked in** even though `build` runs `tsc`. It is expected to extend `@sindresorhus/tsconfig` (a devDependency). If builds fail, create a `tsconfig.json` extending that config with `outDir: dist`, `module/moduleResolution` set for ESM (NodeNext), and `jsx: react`.
- ESM project: imports of local files use the compiled `.js` extension (e.g. `import App from './source/app.js'`), not `.tsx`.
- The actual Ink resize fix will likely require patching the `ink` dependency. `patch-package` is already a devDependency for this purpose — apply fixes via `patches/` and a `postinstall` hook rather than editing `node_modules` directly.
- Platform: development is on Windows. Use forward slashes in paths for shell commands.
