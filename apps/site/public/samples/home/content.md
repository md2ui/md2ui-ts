<!-- Wording proposal for content.md: same structure and spellings, new words. Source: Page.png. Reproduced at 1440px. -->

... Try the samples ⬆️


# {#hero-1}

![md2ui logo](samples/home/md2ui-logo.png?md2ui.max_width=200&md2ui.aspect_ratio=1:1&md2ui.fit=contain&md2ui.content_align=center)

+++

_Note: md2ui is an experiment, still in active development._

::: 1 >

___UI generated from plain Markdown, no ~~`code required`~~.___

`Python` `TypeScript` `Wire protocol`

+++

An agent answers in Markdown, and md2ui turns that answer into a real, interactive UI, in your app's own design. Shaped by patterns observed in real LLM answers, common patterns in UI design, and a few Gestalt principles.

+++

*[Edit this page ✏️](agent:edit-source)* - ⬅️ This page is Markdown too.

:::3


# {#feature-band-1}

___Fully customizable design, no `~~components needed~~`.___

The model writes the structure. The theme owns the look.

## {#feature-card-1}

🤖

__LLM first__

\> LLMs already answer in `Markdown`. md2ui renders what they write_

+++

[⬇️ See more](#boundaries-1)

## {#feature-card-2}

🖽

__Automatic layout__

\> `Responsive by design`. Designers style it, md2ui lays it out_

+++

[💡 Learn more](#adaptive-1)

## {#feature-card-3}

⇄

__Live feed__

\> Built for agents. Change one section, move a value like an order's status, or fill a part from live data, all without an `agent turn`_

+++

[🔗 Visit repo](https://github.com/md2ui/md2ui)


# {#feature-band-3}

___What it can draw, `out of the box`.___

Stats, bars, charts, sliders, toggles, tables and cards. Each one is a spelling the agent already knows.

## {#feature-card-11}

📊

__Charts__

- Mon: 40%
- Tue: 65%
- Wed: 90%

## {#feature-card-12}

🎚️

__Controls__

Volume: [65%]

Notifications ... [x]

## {#feature-card-13}

📈

__Stats and progress__

_Orders today_
1,284

Elapsed: 45%


# {#workflow-1}

__How it works__ ... [Visit repo](https://github.com/md2ui/md2ui)

## {#terminal-1}

`•` One pipeline, five stages.

### 

"`1.`"
+----------------+
`•` LLM
+----------------+

"`The agent writes Markdown, with a few extra spellings.`"

### 

"`2.`"
+----------------+
`•` Wire
+----------------+

"`A two-way live stream: Markdown goes out, taps and prompts come back.`"


### 

"`3.`"
+----------------+
`•` Processing
+----------------+

"`The Markdown is grouped into sections, rows and cards.`"


### 

"`4.`"
+----------------+
`•` Layout
+----------------+

"`The layout is solved on the fly, for any width.`"


### 

"`5.`"
+----------------+
`•` Rendering
+----------------+

"`The screen is painted and styled by THEME.md.`"


# {#quick-start-1}

___Start `here`.___

Pick a way in.

[## Burger Shop demo {#quick-card-1}

A food delivery `demo app` where every page is an agent's reply.

++++

"[`Try it`](https://github.com/md2ui/md2ui)"](https://github.com/md2ui/md2ui)

[## Claude & ChatGPT plugins {#quick-card-2}

Let `Claude` or `ChatGPT` answer you in md2ui.

++++

"[`Install`](https://github.com/md2ui/plugins)"](https://github.com/md2ui/plugins)

[## Python package {#quick-card-3}

The backend library, `CLI tools`, a live desktop window and MCP servers for agents.

++++

"[`Visit repo`](https://github.com/md2ui/md2ui)"](https://github.com/md2ui/md2ui)

[## TypeScript package {#quick-card-4}

Built over [Pretext](https://github.com/chenglou/pretext). One element runs the whole pipeline in the browser, with React and Vue components on top, and native apps through a webview.

++++

"[`Visit repo`](https://github.com/md2ui/md2ui-ts)"](https://github.com/md2ui/md2ui-ts)


# {#boundaries-1}

___Three clear `boundaries`.___

The model controls the structure. The theme owns the look. The renderer solves the layout.

## {#boundary-column-1}

### {#boundary-title-1}

___01.___

__Content shaping__
***

\> The `LLM` shapes the content from skills, patterns and a design vocabulary, written in extended Markdown.

## {#boundary-column-2}

### {#boundary-title-2}

___02.___

__Design styling__
***

\> The `designer` writes THEME.md for the renderer, and patterns and MEANINGS.md for agents.

## {#boundary-column-3}

### {#boundary-title-3}

___03.___

__Adaptive layout__

***

\> md2ui's `pipeline` adapts the components and solves the layout for any screen size, following THEME.md.


# {#adaptive-1}

___Adaptive by design, drop the `~~responsive layout burden~~`.___

LLM answers are unpredictable, so designing every layout by hand is impossible. md2ui keeps any answer safe to lay out, with fallback rules for wrapping content.

## {#feature-card-4}

📱

__Adaptive components__

+++

_ Rows, cards and grids reflow to fit the width they get.

## {#feature-card-5}

🍱

__Bento layout__

+++

_ One line in THEME.md packs the sections into a mosaic.

## {#feature-card-6}

🎨

__Customizable__

++++

_ Colours, fonts, spacing and motion all live in THEME.md.



# {#feature-band-2}

___Safe by construction, no `~~code to run~~`.___

Markdown is text. Nothing in it runs, a link does nothing until the user taps it, and a hosted server never fetches a URL the model wrote.

## {#feature-card-7}

💬

__Actions are data__

\> A tap comes back to the agent as a `sentence`, built from its own Markdown_

+++

[Visit repo](https://github.com/md2ui/md2ui)

## {#feature-card-8}

🔒

__Verified on the wire__

\> The server checks every tap against its own copy of the page. The client `never edits` the Markdown_

+++

[Read the protocol](https://github.com/md2ui/md2ui/blob/main/protocol/README.md)

## {#feature-card-9}

✅

__Checked before it ships__

\> Agents `check` and `preview` their answer with md2ui's MCP tools before anyone sees it_

+++

[Visit repo](https://github.com/md2ui/md2ui)

# {#footer-1}

---

"[`Back to top.`](#hero-1)" ... md2ui_ "[@alexrvarela](https://github.com/alexrvarela)"

***
