# mods-marketplace

Claude Code mods (function-hook plugins). Each mod is in `plugins/<mod>/`. `.claude-plugin/marketplace.json` lists them.

## Release a change to a mod

1. Bump the version in `plugins/<mod>/.claude-plugin/plugin.json`.
2. Bump the `BUILD` constant in the mod's hooks module, if it has one.
3. Add an entry to `plugins/<mod>/CHANGELOG.md`.
4. Run `claude plugin validate plugins/<mod>` and `claude plugin test plugins/<mod>`.

`marketplace.json` has no version field. Do not change it for a version bump.

## Gotchas

### The API types are not always correct about surfaces

The comments in the plugin API types can be out of date. For example, build 2.1.310 says that `AbovePrompt` is "Raised on the terminal and desktop surfaces only". That is not true: the VS Code extension raises `AbovePrompt` under the surface name `"vscode"`, and it draws `Svg` (as an image, because it does not use `isInteractive`).

When the types and the behaviour that the user sees do not agree, search the installed host bundle:

```sh
grep -oE ".{100}AbovePrompt.{150}" ~/.vscode/extensions/anthropic.claude-code-*/extension.js
grep -oE ".{100}case\"Svg\".{100}" ~/.vscode/extensions/anthropic.claude-code-*/webview/index.js
```

### A passing test does not prove that the host draws a component

In `claude plugin test`, `$.ui.mount({ surface, component })` raises any component on any surface that the test names. It only validates the tree against the element table of that surface.

- For a change that applies to one surface, make sure that the real host raises the component (see the gotcha above).
- Do a mutation check: undo the fix and make sure that the test fails.
- An assertion such as "the terminal draws 0 `Svg`" can never fail, because the terminal has no `Svg` element. Do not use it as proof.

### `tsc -p plugins/<mod>` fails on a fresh checkout

Each mod's `tsconfig.json` extends `./.claude-plugin/types/tsconfig.json`. That folder is not in git, because the engine writes it only when it loads the mod from a folder that the user owns.

To type-check without it, write a scratch `tsconfig.json` outside the repo:

- Copy the `compilerOptions` from the header of the bundled `claude-code.d.ts` (in the `plugin-authoring` skill's `types/` folder).
- In `include`, put the path of that `.d.ts` and the absolute paths of the mod's `hooks` and `types` folders.
- Run `npx -y -p typescript@5.6.3 tsc -p <scratch tsconfig>`.

### Visual check of a remote surface without the live host

A session cannot reload an installed marketplace plugin, and it cannot take a screenshot of the Desktop or VS Code UI. To see what a mod draws for a surface:

1. Add a temporary test that mounts each view and prints `console.log('@@DUMP <name> ' + JSON.stringify(await ui.drawn()))`.
2. Run `claude plugin test plugins/<mod> | grep @@DUMP > dump.txt`. Then remove the temporary test.
3. Use a small Node script to render the trees as HTML: `Box` as a flex `div`, `Text` as a `span`, `Svg` as an `<img>` with a base64 `data:image/svg+xml` source.
4. Take a screenshot with headless Chrome:
   `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --window-size=820,1000 --screenshot=out.png file://<path>.html`

This shows the tree that the mod draws, not the live host. Say so when you report the result.
