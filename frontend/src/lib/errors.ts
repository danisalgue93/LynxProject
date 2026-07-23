/**
 * Narrow an unknown thrown value to a human-readable message.
 *
 * Lets catch blocks use the (safe) implicit `unknown` instead of `catch (e)`
 * while keeping the existing "err.message with fallback" UX. Handles the three
 * shapes actually thrown in this app: Error instances, plain strings, and
 * object payloads carrying a string `message` (e.g. parsed API error bodies).
 */
export function getErrorMessage(err: unknown): string | undefined {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (
    err &&
    typeof err === 'object' &&
    'message' in err &&
    typeof (err as { message?: unknown }).message === 'string'
  ) {
    return (err as { message: string }).message;
  }
  return undefined;
}
