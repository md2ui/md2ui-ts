// The Worker `<md2ui-view>` runs its pipeline in by default (C6, sessions.ts): the same
// two lines a host's own Worker file holds. It is started as a Worker, never imported.
import { exposePipeline } from "./worker.ts";

exposePipeline();
