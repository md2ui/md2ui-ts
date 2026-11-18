// One code highlighter per view. Shiki warns once ten instances are alive, and a chat
// page holds many views, each re-sent many times, so a view never keeps more than the
// one its shown document paints with and the one its next document is loading.
//
// The highlighter grows: a document that names a language the current one lacks loads
// a new one for every language the view has asked for, so a thread settles on one
// instance. A new syntax style starts afresh. Only names a grammar exists for count, so a
// fence a stream has half written (` ```pyt `) loads nothing.
import type { ResolvedTheme } from "@md2ui/contracts";
import { codeLanguages, type LoadedHighlighter, loadCodeHighlighter } from "@md2ui/core";

export interface ViewHighlighter {
  /**
   * A highlighter for `languages` under `theme`'s syntax style: the current one when
   * it covers them. Null when there is no code to colour, or when the grammars could
   * not be loaded (code then paints in its text colour).
   */
  load(theme: ResolvedTheme, languages: ReadonlySet<string>): Promise<LoadedHighlighter | null>;
  /**
   * What colours `theme`'s code without waiting: the latest highlighter for its syntax
   * style that has loaded, or null; `complete` when it covers `languages`. A document
   * shown with an incomplete one paints the missing languages plain until `load`'s
   * highlighter arrives.
   */
  now(
    theme: ResolvedTheme,
    languages: ReadonlySet<string>,
  ): { readonly highlighter: LoadedHighlighter | null; readonly complete: boolean };
  /** The shown document now paints with `highlighter`: any other is released. */
  show(highlighter: LoadedHighlighter | null): void;
  /** Releases every instance; the view is gone. */
  dispose(): void;
}

interface Loading {
  readonly style: string;
  readonly asked: ReadonlySet<string>;
  readonly highlighter: Promise<LoadedHighlighter | null>;
}

/** A load that has finished. */
interface Loaded extends Loading {
  readonly value: LoadedHighlighter | null;
}

/** `defer` runs work the view can put off (the release of a replaced instance). */
export function createViewHighlighter(defer: (work: () => void) => void): ViewHighlighter {
  const alive = new Set<Promise<LoadedHighlighter | null>>();
  let latest: Loading | null = null;
  /** The most recent load to finish, by the order the loads started. */
  let loaded: Loaded | null = null;
  let started = 0;
  let finished = 0;
  let shown: LoadedHighlighter | null = null;
  let disposed = false;

  /** Releases every instance but the shown one and the latest. */
  const sweep = (): void => {
    for (const pending of [...alive]) {
      if (!disposed && pending === latest?.highlighter) continue;
      alive.delete(pending);
      void pending.then((h) => {
        if (h === null) return;
        if (!disposed && h === shown) alive.add(pending);
        else h.dispose();
      });
    }
  };

  return {
    load(theme, languages) {
      const style = theme.code_blocks.syntax_style;
      const known = codeLanguages(languages);
      const covered = latest !== null && latest.style === style;
      if (covered && [...known].every((l) => latest?.asked.has(l))) {
        return latest?.highlighter ?? Promise.resolve(null);
      }
      if (known.size === 0) return Promise.resolve(null);
      const asked = new Set([...(covered ? (latest?.asked ?? []) : []), ...known]);
      const highlighter = loadCodeHighlighter(theme, asked).catch(() => null);
      const loading = { style, asked, highlighter };
      latest = loading;
      const order = ++started;
      void highlighter.then((value) => {
        if (order < finished) return;
        finished = order;
        loaded = { ...loading, value };
      });
      alive.add(highlighter);
      defer(sweep);
      return highlighter;
    },
    now(theme, languages) {
      const style = theme.code_blocks.syntax_style;
      const known = codeLanguages(languages);
      // Only an instance the sweep keeps: the shown one, or the latest load's.
      const kept =
        loaded !== null && (loaded.value === shown || loaded.highlighter === latest?.highlighter);
      const ready = kept && loaded?.style === style ? loaded : null;
      return {
        highlighter: ready?.value ?? null,
        complete: [...known].every((l) => ready?.asked.has(l)),
      };
    },
    show(highlighter) {
      shown = highlighter;
      defer(sweep);
    },
    dispose() {
      disposed = true;
      sweep();
    },
  };
}
