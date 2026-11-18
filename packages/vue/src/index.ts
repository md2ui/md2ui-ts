// @md2ui/vue — a binding: a thin Vue wrapper over <md2ui-view>, no logic (ADR-003).
// Props become the element's properties, and its two events become `action` and
// `error`; the component's root (`$el`) is the element. No module-level mutable state;
// nothing runs on import.
import {
  defineMd2uiView,
  type FontSource,
  type Md2uiAction,
  type Md2uiLoadError,
  type Md2uiViewElement,
  type Md2uiViewProperties,
} from "@md2ui/dom";
import {
  defineComponent,
  h,
  onBeforeUnmount,
  onMounted,
  type PropType,
  shallowRef,
  watch,
} from "vue";

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

/** A prop left unset leaves the element's own default. */
const text = () => ({ type: String, default: undefined });
const nullableText = () => ({ type: String as PropType<string | null>, default: undefined });

/** `<md2ui-view>` as a Vue component. */
export const Md2uiView = defineComponent({
  name: "Md2uiView",
  props: {
    markdown: text(),
    messageId: nullableText(),
    themeSrc: nullableText(),
    themeText: nullableText(),
    assetBase: nullableText(),
    fonts: { type: Array as PropType<readonly FontSource[]>, default: undefined },
    disabled: { type: Boolean, default: undefined },
    streaming: { type: Boolean, default: undefined },
    motion: { type: String as PropType<Md2uiViewProperties["motion"]>, default: undefined },
  },
  emits: {
    /** `md2ui-action`: call `event.preventDefault()` to cancel what the view would do. */
    action: (event: CustomEvent<Md2uiAction>) => event instanceof CustomEvent,
    /** `md2ui-error`: a theme, font or image that could not load. */
    error: (event: CustomEvent<Md2uiLoadError>) => event instanceof CustomEvent,
  },
  setup(props, { emit }) {
    const element = shallowRef<Md2uiViewElement | null>(null);

    /** What each property was last set to, so an unchanged prop is not set again. */
    const applied = new Map<keyof Md2uiViewProperties, unknown>();
    const apply = (): void => {
      const node = element.value;
      if (node === null) return;
      for (const name of ORDER) {
        const value = props[name];
        if (value === undefined || applied.get(name) === value) continue;
        applied.set(name, value);
        Reflect.set(node, name, value);
      }
    };
    const action = (event: CustomEvent<Md2uiAction>): void => emit("action", event);
    const error = (event: CustomEvent<Md2uiLoadError>): void => emit("error", event);

    onMounted(() => {
      defineMd2uiView();
      apply();
      element.value?.addEventListener("md2ui-action", action);
      element.value?.addEventListener("md2ui-error", error);
    });
    watch(() => ORDER.map((name) => props[name]), apply, { flush: "post" });
    onBeforeUnmount(() => {
      element.value?.removeEventListener("md2ui-action", action);
      element.value?.removeEventListener("md2ui-error", error);
    });

    return () => h("md2ui-view", { ref: element });
  },
});
