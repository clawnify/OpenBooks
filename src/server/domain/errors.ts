/**
 * A refusal to change the books.
 *
 * Thrown when a write would break an accounting rule the app is not allowed to
 * bend: editing a posted document, deleting an entry, or posting into a locked
 * period. Routes turn it into a 409 with the message shown to the caller --
 * including an agent, which is why the messages say what to do instead.
 */
export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerError";
  }
}
