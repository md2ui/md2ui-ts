// The source panel: CodeMirror over the document shown, loaded the first time the panel
// opens so the page does not pay for it until then. Every edit goes to `onChange`; the
// view beside it is the preview.
import { markdown } from "@codemirror/lang-markdown";
import { basicSetup, EditorView } from "codemirror";

export interface SourceEditor {
  /** Replaces the text, as when another document is chosen; does not call `onChange`. */
  setText(text: string): void;
  destroy(): void;
}

export function createSourceEditor(
  parent: HTMLElement,
  text: string,
  onChange: (text: string) => void,
): SourceEditor {
  let quiet = false;
  const view = new EditorView({
    parent,
    doc: text,
    extensions: [
      basicSetup,
      markdown(),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !quiet) onChange(update.state.doc.toString());
      }),
    ],
  });
  return {
    setText(next) {
      quiet = true;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } });
      quiet = false;
    },
    destroy: () => view.destroy(),
  };
}
