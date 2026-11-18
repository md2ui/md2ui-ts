# @md2ui/dom

`<md2ui-view>`: a custom element that turns a Markdown document and an optional
`THEME.md` into a painted, interactive UI, with the pipeline running in the browser.

**Experimental alpha**; the API may change between any two releases. Part of
[md2ui-ts](https://github.com/md2ui/md2ui-ts), the client for
[md2ui](https://github.com/md2ui/md2ui). Home: [md2ui.org](https://md2ui.org).

## Install

```sh
npm i @md2ui/dom@alpha     # or: pnpm add, yarn add, bun add
```

No peer dependencies. It brings comlink, flatbush, image-dimensions and shiki; Pretext
and md2ui-ts's internal packages are in its own build.

With Vite, build Workers as ES modules, and with Vite 7 keep the package out of the dev
server's pre-bundling, which would leave the Worker's file behind:

```ts
// vite.config.ts
import { defineConfig } from "vite";

export default defineConfig({
  worker: { format: "es" },
  optimizeDeps: { exclude: ["@md2ui/dom"] }, // Vite 7 only
});
```

With Parcel 2, let it read the package's `exports`, which it does only when the host's
`package.json` asks:

```json
{
  "@parcel/resolver-default": { "packageExports": true }
}
```

webpack 5 needs no setting.

## Example

```html
<md2ui-view style="height: 480px"></md2ui-view>
<script type="module" src="/src/main.ts"></script>
```

```ts
// src/main.ts
import { defineMd2uiView } from "@md2ui/dom";

defineMd2uiView();

const view = document.querySelector("md2ui-view");
if (view === null) throw new Error("no <md2ui-view>");

view.messageId = "m1";
view.markdown = "# Your order\n\nShip it to the office?\n\n[Yes](agent:ship) [No](agent:cancel)";
view.addEventListener("md2ui-action", (event) => console.log(event.detail));
```

Without a theme the view uses md2ui's default one. Themes, fonts, actions, the Worker and
the wire are in the [md2ui-ts README](https://github.com/md2ui/md2ui-ts#readme).

## API

| Export | What it is |
|---|---|
| `defineMd2uiView(options?)` | Registers `<md2ui-view>`; nothing registers on import. A second call does nothing |
| `Md2uiViewOptions` | `{ worker?: false \| (() => Worker) }`: where the pipeline runs |
| `Md2uiViewElement` | The element's type: `Md2uiViewProperties` and `release(ordinals)` |
| `Md2uiViewProperties` | `markdown`, `messageId`, `themeSrc`, `themeText`, `assetBase`, `fonts`, `disabled`, `streaming`, `motion` |
| `Md2uiViewEventMap` | `md2ui-action` (`CustomEvent<Md2uiAction>`, cancelable) and `md2ui-error` (`CustomEvent<Md2uiLoadError>`) |
| `Md2uiAction` | `LinkAction \| AgentAction \| CheckboxAction \| SliderAction` |
| `ForwardedAction` | `AgentAction \| CheckboxAction \| SliderAction`: the ones that go to the agent |
| `SettledValue` | `[ordinal, value]`, an `agent` action's `settled` entry |
| `Md2uiLoadError` | `{ resource: "theme" \| "font" \| "image" \| "pipeline", url, message, family? }` |
| `FontSource` | `{ family, url, weight?, italic? }` |

| `@md2ui/dom/worker` | What it is |
|---|---|
| `exposePipeline()` | Serves the views' pipeline from a Worker you bundle yourself (`defineMd2uiView({ worker })`) |

| Attribute | Property |
|---|---|
| `theme-src` | `themeSrc` |
| `asset-base` | `assetBase` |
| `message-id` | `messageId` |
| `disabled`, `streaming`, `motion` | the same |

## Requirements

Current Chrome, Edge, Firefox and Safari; an ESM bundler that ships module Workers
(without one, the pipeline runs on the main thread).

## Licence

MIT, in [`LICENSE`](LICENSE). The build includes Pretext (MIT), credited in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
