// The documents and themes the site offers, served from `public/`. Each theme lists the
// faces its `Font Name`s use, since the view never loads a theme's font files itself
// (ADR-006). The text faces come from Fontsource's npm packages on jsDelivr, pinned, so
// the site serves no font files of its own: each package ships its licence. The icon
// font is md2ui's, served beside its licence; its path resolves against the page, as the
// themes' `Font:` path does.
import type { FontSource } from "@md2ui/dom";

export interface SiteTheme {
  readonly id: string;
  readonly label: string;
  readonly src: string;
  readonly fonts: readonly FontSource[];
}

export interface SiteContent {
  readonly id: string;
  readonly label: string;
  readonly src: string;
  /** The theme the document was written for, chosen with it. */
  readonly theme: string;
  /** The published design the sample reproduces; none for one an LLM wrote or reworded. */
  readonly designUrl?: string;
}

const ICONS: FontSource = {
  family: "md2ui icons",
  url: "assets/icons/material-design-icons-md2ui.ttf",
};

/** The Fontsource release a face is pinned to, unless its package needs another. */
const FONTSOURCE = "5.3.0";

/** `family` at `weight` from Fontsource package `pkg`, Latin subset. */
const face = (family: string, pkg: string, weight: number, version = FONTSOURCE): FontSource => ({
  family,
  url: `https://cdn.jsdelivr.net/npm/@fontsource/${pkg}@${version}/files/${pkg}-latin-${weight}-normal.woff2`,
  weight,
});

const MONO: readonly FontSource[] = [
  face("JetBrains Mono", "jetbrains-mono", 400),
  face("JetBrains Mono", "jetbrains-mono", 500),
  face("JetBrains Mono", "jetbrains-mono", 700),
];

export const THEMES: readonly SiteTheme[] = [
  {
    id: "home",
    label: "md2ui home",
    src: "samples/home/THEME.md",
    fonts: [
      face("Inter 24pt", "inter", 400),
      face("Inter 24pt", "inter", 500),
      face("Inter 24pt", "inter", 600),
      face("Inter 24pt", "inter", 700),
      face("IBM Plex Mono", "ibm-plex-mono", 400),
      face("IBM Plex Mono", "ibm-plex-mono", 500),
      face("IBM Plex Mono", "ibm-plex-mono", 600),
      face("IBM Plex Mono", "ibm-plex-mono", 700),
      ICONS,
    ],
  },
  {
    id: "whipsaw",
    label: "Phone OS widgets",
    src: "samples/whipsaw/THEME.md",
    fonts: [
      face("Inter 18pt", "inter", 400),
      face("Inter 18pt", "inter", 500),
      face("Inter 18pt", "inter", 600),
      face("Inter 18pt", "inter", 700),
      ICONS,
    ],
  },
  {
    id: "brutalism",
    label: "Brutalism",
    src: "samples/brutalism/THEME.md",
    fonts: [
      face("Archivo", "archivo", 400),
      face("Archivo", "archivo", 500),
      face("Archivo", "archivo", 600),
      face("Archivo", "archivo", 700),
      face("Archivo", "archivo", 800),
      face("Archivo", "archivo", 900),
      ...MONO,
      ICONS,
    ],
  },
  {
    id: "landing-page",
    label: "Lavender",
    src: "samples/landing-page/THEME.md",
    fonts: [
      face("google sans", "google-sans", 400, "5.3.2"),
      face("google sans", "google-sans", 500, "5.3.2"),
      face("google sans", "google-sans", 700, "5.3.2"),
      ICONS,
    ],
  },
  {
    id: "burger-shop",
    label: "Burger Shop",
    src: "samples/burger-shop/THEME.md",
    fonts: [
      face("Plus Jakarta Sans", "plus-jakarta-sans", 500),
      face("Plus Jakarta Sans", "plus-jakarta-sans", 600),
      face("Plus Jakarta Sans", "plus-jakarta-sans", 700),
      face("Plus Jakarta Sans", "plus-jakarta-sans", 800),
      face("Inter 18pt", "inter", 400),
      face("Inter 18pt", "inter", 500),
      face("Inter 18pt", "inter", 600),
      face("Inter 18pt", "inter", 700),
      ICONS,
    ],
  },
  {
    id: "finance",
    label: "Night ledger",
    src: "samples/finance/THEME.md",
    fonts: [
      face("Inter 18pt", "inter", 400),
      face("Inter 18pt", "inter", 500),
      face("Inter 18pt", "inter", 600),
      face("Inter 18pt", "inter", 700),
      face("Space Mono", "space-mono", 400),
      face("Space Mono", "space-mono", 700),
      ICONS,
    ],
  },
];

export const CONTENTS: readonly SiteContent[] = [
  { id: "home", label: "md2ui — start here", src: "samples/home/content.md", theme: "home" },
  {
    id: "whipsaw",
    label: "Phone OS widgets",
    src: "samples/whipsaw/content.md",
    theme: "whipsaw",
    designUrl:
      "https://www.whipsaw.com/latest/reimagining-phone-os-a-design-exploration-for-an-ai-future",
  },
  {
    id: "brutalism",
    label: "Brutalism landing page",
    src: "samples/brutalism/content.md",
    theme: "brutalism",
    designUrl: "https://p.superdesign.dev/draft/1a57fa51-6aa7-451f-96bf-94dc03a0909e",
  },
  {
    id: "landing-page",
    label: "Mellowbox landing page",
    src: "samples/landing-page/content.md",
    theme: "landing-page",
  },
  {
    id: "burger-shop",
    label: "Burger Shop",
    src: "samples/burger-shop/content.md",
    theme: "burger-shop",
  },
  {
    id: "finance",
    label: "Finance dashboard",
    src: "samples/finance/content.md",
    theme: "finance",
  },
];

/** The values `### Root` → `Layout:` takes, as THEME_GUIDE.md spells them. */
export const LAYOUTS = ["Auto", "Bento", "Default"] as const;
export type SiteLayout = (typeof LAYOUTS)[number];

/** The layout `themeText` asks for: its `Layout:` line, else md2ui's default. */
export function themeLayout(themeText: string): SiteLayout {
  const value = /^Layout:\s*(\S+)/im.exec(themeText)?.[1]?.toLowerCase();
  return LAYOUTS.find((layout) => layout.toLowerCase() === value) ?? "Default";
}

/**
 * `themeText` with its layout set to `layout`: the existing `Layout:` line rewritten,
 * else one added under `### Root`, else a `### Root` block appended for it.
 */
export function withLayout(themeText: string, layout: SiteLayout): string {
  const line = `Layout: ${layout}`;
  if (/^Layout:.*$/im.test(themeText)) return themeText.replace(/^Layout:.*$/im, line);
  if (/^### Root[ \t]*$/m.test(themeText)) {
    return themeText.replace(/^### Root[ \t]*$/m, (root) => `${root}\n${line}`);
  }
  return `${themeText}\n\n## Styling & Spacing\n\n### Root\n${line}\n`;
}
