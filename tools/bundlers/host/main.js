// The smallest host: what a page that bundles @md2ui/dom writes, in the default Worker mode.
import { defineMd2uiView } from "@md2ui/dom";

const THEME = `## Text Styles
Text
- Font Name: sans-serif
- Font size: 15
Heading1
- Font Name: sans-serif
- Font size: 26

## Styling & Spacing
### Root
Background color: #FFFFFF
Padding: 16
`;

defineMd2uiView();
const view = document.createElement("md2ui-view");
view.style.cssText = "display: block; width: 400px; height: 200px";
window.errors = [];
view.addEventListener("md2ui-error", (event) => window.errors.push(event.detail));
view.themeText = THEME;
view.markdown = "# Bundled\n\nRendered through a bundled Worker.\n";
document.body.append(view);
