// What the playground's server says: a welcome with one control of each kind, the
// replies each action gets, and a theme. Every reply re-sends the whole message, as an
// agent changes state (ADR-003). The theme draws in Arial, md2ui's default family: the
// platform's face, so the playground gives the views no fonts.
import type { Script } from "./server.ts";

export const THEME = `## Text Styles
Text
- Font Name: Arial
- Font size: 15
Heading1
- Font Name: Arial
- Font size: 26
Heading2
- Font Name: Arial
- Font size: 19
Links
- Font Name: Arial
- Font size: 14
- Font color: #FFFFFF
Links Secondary
- Font color: #26262B

## Styling & Spacing
### Root
Background color: #F6F6F8
Padding: 20
Spacing: 14

### Heading 2
Background color: #FFFFFF
Corner radius: 16
Padding: 16
Spacing: 10

## Links
Segmented: yes
Fill color: #26262B
Corner radius: 20
Padding top: 8
Padding bottom: 8
Padding left: 16
Padding right: 16
Disabled fill color: #E4E4E8
Disabled text color: #9A9AA3

### Secondary
Fill color: #E4E4E8

## Code Blocks
Syntax style: github-dark
Background color: #1E1E24
Corner radius: 12
Padding: 12
`;

const order = (milk: boolean, volume: string): string => `# Order

## Groceries
- [${milk ? "x" : " "}] Milk
- [ ] Bread

## Volume
Volume: [${volume}%]

[Louder](agent:louder)

## Install
\`\`\`sh
npm i @md2ui/dom @md2ui/wire
\`\`\`

[Place order](agent:order?md2ui.commit=1) *[Start over](agent:reset)*
`;

// A product form (md2ui ADR-405): a size chosen among options joined by ` | `, a count,
// and a button that commits both. "12 min" is a feed slot (ADR-206): drawn as plain words,
// never a link or a target.
const PRODUCT = `# Classic Smash

Ready in [12 min](feed:eta)

_Size_
[S](agent:size?v=s&md2ui.choice=size) | *[M](agent:size?v=m&md2ui.choice=size)* | *[L](agent:size?v=l&md2ui.choice=size)*

Quantity: ➖ [1/9] ➕

[Add to cart](agent:add?id=classic-smash&md2ui.commit=1)
`;

export const SCRIPT: Script = Object.freeze({
  welcome: `# Welcome

This reply streamed in through \`@md2ui/wire\` from an in-memory server.

[Show an order](agent:order-form) [Show a product](agent:product-form) *[Docs](https://github.com/)*
`,
  replies: Object.freeze({
    "order-form": () => order(false, "40"),
    "product-form": () => PRODUCT,
    add: () => "# Added\n\nIt is in your cart.\n\n[Start over](agent:reset)\n",
    order: () => "# Thanks\n\nYour order is on its way.\n\n[Start over](agent:reset)\n",
    // The agent answers by changing the volume, not the button: only `u` releases it.
    louder: () => order(false, "60"),
    reset: () => order(false, "40"),
  }),
  prompt: (text: string) => `## You said\n\n${text.replaceAll(/[\\`*_[\]#]/g, "\\$&")}\n`,
  steps: Object.freeze(["Read the request", "Write the reply"]),
  ask: "What would you like to order?",
});
