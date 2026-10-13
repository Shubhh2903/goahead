/** Compares SHA-256 digests in constant time, so the answer time does not tell how much of the token matched. */
export async function adminTokenMatches(expected: string | undefined, provided: string | null): Promise<boolean> {
  if (!expected || !provided) return false;
  const encoder = new TextEncoder();
  const [expectedHash, providedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
  ]);
  return constantTimeEqual(new Uint8Array(expectedHash), new Uint8Array(providedHash));
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return difference === 0;
}
