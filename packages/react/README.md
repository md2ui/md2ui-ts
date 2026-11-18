# @md2ui/react

`Md2uiView`: a thin React component over `@md2ui/dom`'s `<md2ui-view>`, which turns a
Markdown document and an optional `THEME.md` into a painted, interactive UI.

**Experimental alpha**; the API may change between any two releases. Part of
[md2ui-ts](https://github.com/md2ui/md2ui-ts), the client for
[md2ui](https://github.com/md2ui/md2ui). Home: [md2ui.org](https://md2ui.org).

## Install

```sh
npm i @md2ui/dom@alpha @md2ui/react@alpha     # or: pnpm add, yarn add, bun add
```

Peer: `react ^18.3 || ^19`. Install `@md2ui/dom` beside it, at the same version. With
Vite, use the settings in `@md2ui/dom`'s README.

## Example

```tsx
import { type FontSource, Md2uiView } from "@md2ui/react";

const FONTS: FontSource[] = [];

export function Reply({ id, markdown }: { id: string; markdown: string }) {
  return (
    <Md2uiView
      markdown={markdown}
      messageId={id}
      fonts={FONTS}
      style={{ height: 480 }}
      onAction={(event) => console.log(event.detail)}
    />
  );
}
```

Keep `fonts` stable (a module constant or `useMemo`): a new array reloads the fonts.
More in the [md2ui-ts README](https://github.com/md2ui/md2ui-ts#react).

## API

| Export | What it is |
|---|---|
| `Md2uiView` | The component. Its `ref` is the `Md2uiViewElement`, with `release(ordinals)` |
| `Md2uiViewProps` | Every `Md2uiViewProperties` property, each optional, plus the props below |
| `FontSource`, `Md2uiAction`, `Md2uiLoadError`, `Md2uiViewElement`, `Md2uiViewProperties` | Re-exported from `@md2ui/dom` |

| Prop | Type |
|---|---|
| `markdown`, `messageId`, `themeSrc`, `themeText`, `assetBase`, `fonts`, `disabled`, `streaming`, `motion` | as the element's properties |
| `onAction` | `(event: CustomEvent<Md2uiAction>) => void`; `event.preventDefault()` cancels what the view would do |
| `onError` | `(event: CustomEvent<Md2uiLoadError>) => void` |
| `className` | `string` |
| `style` | `CSSProperties` |

The component registers `<md2ui-view>` when it mounts. To pass options, call
`defineMd2uiView({ worker })` from `@md2ui/dom` before the first render.

## Requirements

React 18.3 or 19; current Chrome, Edge, Firefox and Safari; an ESM bundler that ships
module Workers.

## Licence

MIT, in [`LICENSE`](LICENSE).
