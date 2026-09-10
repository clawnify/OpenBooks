/**
 * Surface a refused write.
 *
 * The server answers 409 with `{ error }` when a change would break an
 * accounting rule -- editing a posted document, deleting a posted invoice,
 * posting into a locked period. Those messages say what to do instead, so they
 * are shown as-is rather than replaced with a generic failure.
 *
 * Returns true when the request was refused, so callers can stop.
 */
export async function refused(res: Response): Promise<boolean> {
  if (res.ok) return false;
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  alert(data.error || "That change was refused.");
  return true;
}
