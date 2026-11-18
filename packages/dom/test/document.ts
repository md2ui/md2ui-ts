// The document the host tests run through the real core: one target of every kind, a
// code block that scrolls sideways, and an anchor further down, under a theme whose
// fonts exist in every engine and whose link colours make a pending action visible.

/** Ordinal by name, so a test reads `ORDINAL.agent`. */
export const ORDINAL = { link: 0, anchor: 1, agent: 2, checkbox: 3, slider: 4, save: 5 } as const;

/** What the code block holds, and what its copy button copies. */
export const CODE = `npm i md2ui && echo ${"a very long line that runs past the block ".repeat(3).trim()}`;

/** Paragraphs enough to make the document taller than the test window. */
export const FILLER_PARAGRAPHS = 24;

const FILLER = Array.from(
  { length: FILLER_PARAGRAPHS },
  (_, i) => `Paragraph ${i + 1} keeps the end of the document below the first screen.`,
).join("\n\n");

export const MARKDOWN = `# Title

[Docs](https://other.example/docs) [Jump](#end)

[Yes](agent:confirm)

- [ ] Milk

Volume: [50/100]

[Save](agent:save?md2ui.commit=1)

## Code
\`\`\`sh
${CODE}
\`\`\`

## Filler
${FILLER}

## The end {#end}
The end.
`;

/** A link's fill, and the fill a pending action shows (its disabled paint). */
export const LINK_COLOR = "#3355ccff";
export const PENDING_COLOR = "#ff0000ff";

export const PADDING = 16;

export const THEME = `## Text Styles
Text
- Font Name: sans-serif
- Font size: 15
Heading1
- Font Name: sans-serif
- Font size: 26
Heading2
- Font Name: sans-serif
- Font size: 20

## Styling & Spacing
### Root
Background color: #FFFFFF
Padding: ${PADDING}
Spacing: 12
Stack sections: yes

## Links
Fill color: #3355CC
Disabled fill color: #FF0000
Padding: 10
`;

/** Decodes on the page, as a registration with `worker: false` does. */
export const decodeOnPage = (blob: Blob, options: ImageBitmapOptions): Promise<ImageBitmap> =>
  createImageBitmap(blob, options);
