/**
 * Turns a query string into schema input, reading only the given keys.
 *
 * - A missing key is undefined, so optional fields stay optional and required ones say "required".
 * - An empty value (`?limit=`) stays "", so the schema rejects it instead of treating it as absent:
 *   a client that sends a key with no value is broken, and silently dropping it would hide that.
 * - A repeated key uses its first value, as URLSearchParams.get does.
 * - Other keys are ignored, so cache-busting params do no harm.
 */
export function queryInput<K extends string>(
  params: URLSearchParams,
  keys: readonly K[],
): Record<K, string | undefined> {
  const input = {} as Record<K, string | undefined>;
  for (const key of keys) input[key] = params.get(key) ?? undefined;
  return input;
}
