/** Voyage serials are scoped to the world seed; seeds themselves may contain colons. */
export function voyageSequence(seed: string, id: string): number | undefined {
  const prefix = `${seed}:`;
  if (!id.startsWith(prefix)) return undefined;
  const suffix = id.slice(prefix.length);
  if (!/^[1-9]\d*$/.test(suffix)) return undefined;
  const sequence = Number(suffix);
  return Number.isSafeInteger(sequence) && sequence <= 1e9 ? sequence : undefined;
}
