// The `conformance` script: the runner over the stages ported so far (ADR-002).
import { argv, exit, stdout } from "node:process";
import { main } from "./main.ts";
import { portedStages } from "./stages.ts";

exit(await main(argv.slice(2), portedStages(), (text) => stdout.write(text)));
