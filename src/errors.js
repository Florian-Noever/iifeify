/** A conversion that cannot succeed as asked. The CLI prints the message and exits with 1. */
export class ConversionError extends Error {}

/** A wrong command line. The CLI prints the message and exits with 2. */
export class UsageError extends Error {}
