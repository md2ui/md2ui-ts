// @md2ui/react — a binding: a thin React wrapper over <md2ui-view>, no logic (ADR-003).
// Props become the element's properties, its two events become callbacks, and the ref
// is the element. No module-level mutable state; nothing runs on import.
import {
  defineMd2uiView,
  type Md2uiAction,
  type Md2uiLoadError,
  type Md2uiViewElement,
  type Md2uiViewProperties,
} from "@md2ui/dom";
import {
  type CSSProperties,
  createElement,
  type ForwardedRef,
  type ForwardRefExoticComponent,
  forwardRef,
  type ReactElement,
  type RefAttributes,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";

/** The element's properties, each optional, and its events as callbacks. */
export interface Md2uiViewProps extends Partial<Md2uiViewProperties> {
  /** `md2ui-action`: call `event.preventDefault()` to cancel what the view would do. */
  readonly onAction?: (event: CustomEvent<Md2uiAction>) => void;
  /** `md2ui-error`: a theme, font or image that could not load. */
  readonly onError?: (event: CustomEvent<Md2uiLoadError>) => void;
  readonly className?: string;
  readonly style?: CSSProperties;
}

export type {
  FontSource,
  Md2uiAction,
  Md2uiLoadError,
  Md2uiViewElement,
  Md2uiViewProperties,
} from "@md2ui/dom";

/**
 * The order properties are set in: the theme and fonts first, then the document, then
 * its message id, so a document and its id reach the view together.
 */
const ORDER: readonly (keyof Md2uiViewProperties)[] = Object.freeze([
  "themeSrc",
  "themeText",
  "assetBase",
  "fonts",
  "disabled",
  "streaming",
  "motion",
  "markdown",
  "messageId",
]);

function forward<T>(ref: ForwardedRef<T>, value: T | null): void {
  if (typeof ref === "function") ref(value);
  else if (ref !== null) ref.current = value;
}

function Md2uiViewRender(props: Md2uiViewProps, ref: ForwardedRef<Md2uiViewElement>): ReactElement {
  const { onAction, onError, className, style } = props;
  const element = useRef<Md2uiViewElement | null>(null);
  /** What each property was last set to, so an unchanged prop is not set again. */
  const applied = useRef(new Map<keyof Md2uiViewProperties, unknown>());
  const callbacks = useRef({ onAction, onError });
  callbacks.current = { onAction, onError };

  const attach = useCallback(
    (node: Md2uiViewElement | null) => {
      element.current = node;
      forward(ref, node);
    },
    [ref],
  );

  useLayoutEffect(() => {
    const node = element.current;
    if (node === null) return;
    defineMd2uiView();
    for (const name of ORDER) {
      const value = props[name];
      if (value === undefined || applied.current.get(name) === value) continue;
      applied.current.set(name, value);
      Reflect.set(node, name, value);
    }
  });

  useEffect(() => {
    const node = element.current;
    if (node === null) return;
    const action = (event: CustomEvent<Md2uiAction>) => callbacks.current.onAction?.(event);
    const error = (event: CustomEvent<Md2uiLoadError>) => callbacks.current.onError?.(event);
    node.addEventListener("md2ui-action", action);
    node.addEventListener("md2ui-error", error);
    return () => {
      node.removeEventListener("md2ui-action", action);
      node.removeEventListener("md2ui-error", error);
    };
  }, []);

  return createElement("md2ui-view", { ref: attach, className, style });
}

/** `<md2ui-view>` as a React component; the ref is the element. */
export const Md2uiView: ForwardRefExoticComponent<
  Md2uiViewProps & RefAttributes<Md2uiViewElement>
> = forwardRef(Md2uiViewRender);
