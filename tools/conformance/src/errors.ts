/**
 * The runner cannot run as called: a wrong argument, or fixtures it does not
 * understand. The CLI prints the message and exits 2.
 */
export class SetupError extends Error {}
