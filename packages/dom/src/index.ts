// @md2ui/dom — the host layer and the <md2ui-view> custom element (ADR-003, C6).
// No module-level mutable state; nothing runs on import, not even element registration:
// a host calls `defineMd2uiView()`.
export type {
  AgentAction,
  CheckboxAction,
  FontSource,
  ForwardedAction,
  LinkAction,
  Md2uiAction,
  Md2uiLoadError,
  Md2uiViewProperties,
  SettledValue,
  SliderAction,
} from "@md2ui/contracts";
export {
  defineMd2uiView,
  type Md2uiViewElement,
  type Md2uiViewEventMap,
  type Md2uiViewOptions,
} from "./element.ts";
