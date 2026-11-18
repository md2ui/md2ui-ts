# @md2ui/vue

`Md2uiView`: a thin Vue component over `@md2ui/dom`'s `<md2ui-view>`, which turns a
Markdown document and an optional `THEME.md` into a painted, interactive UI.

**Experimental alpha**; the API may change between any two releases. Part of
[md2ui-ts](https://github.com/md2ui/md2ui-ts), the client for
[md2ui](https://github.com/md2ui/md2ui). Home: [md2ui.org](https://md2ui.org).

## Install

```sh
npm i @md2ui/dom@alpha @md2ui/vue@alpha     # or: pnpm add, yarn add, bun add
```

Peer: `vue ^3.5`. Install `@md2ui/dom` beside it, at the same version. With Vite, use
the settings in `@md2ui/dom`'s README.

## Example

```vue
<script setup lang="ts">
import { type Md2uiAction, Md2uiView } from "@md2ui/vue";

defineProps<{ id: string; markdown: string }>();

function onAction(event: CustomEvent<Md2uiAction>) {
  console.log(event.detail);
}
</script>

<template>
  <Md2uiView :markdown="markdown" :message-id="id" style="height: 480px" @action="onAction" />
</template>
```

More in the [md2ui-ts README](https://github.com/md2ui/md2ui-ts#vue).

## API

| Export | What it is |
|---|---|
| `Md2uiView` | The component. Its root, `$el`, is the `Md2uiViewElement`: through a template ref, `view.value.$el.release(ordinals)` |
| `FontSource`, `Md2uiAction`, `Md2uiLoadError`, `Md2uiViewElement`, `Md2uiViewProperties` | Re-exported from `@md2ui/dom` |

| Prop or event | Type |
|---|---|
| `markdown`, `messageId`, `themeSrc`, `themeText`, `assetBase`, `fonts`, `disabled`, `streaming`, `motion` | as the element's properties, each optional |
| `@action` | `CustomEvent<Md2uiAction>`; `event.preventDefault()` cancels what the view would do |
| `@error` | `CustomEvent<Md2uiLoadError>` |

No `isCustomElement` setting is needed. The component registers `<md2ui-view>` when it
mounts; to pass options, call `defineMd2uiView({ worker })` from `@md2ui/dom` before
mounting the app.

## Requirements

Vue 3.5; current Chrome, Edge, Firefox and Safari; an ESM bundler that ships module
Workers.

## Licence

MIT, in [`LICENSE`](LICENSE).
