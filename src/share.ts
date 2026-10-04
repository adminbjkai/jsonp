/** Share links keep the document in the URL fragment, which browsers never send to a server. */
const PREFIX = '#json=';
export const MAX_SHARE_LENGTH = 60_000;
const base64url = (bytes: Uint8Array) => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
async function pipe(
  bytes: Uint8Array,
  stream: CompressionStream | DecompressionStream,
  limit = Infinity,
) {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(stream).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (let next = await reader.read(); !next.done; next = await reader.read()) {
    size += next.value.length;
    if (size > limit) {
      await reader.cancel();
      throw new Error('Shared document is larger than 5 MiB.');
    }
    chunks.push(next.value);
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) output.set(chunk, (offset += chunk.length) - chunk.length);
  return output;
}
export async function shareLink(text: string) {
  const compressed = await pipe(
    new TextEncoder().encode(text),
    new CompressionStream('deflate-raw'),
  );
  return `${location.origin}${location.pathname}${PREFIX}${base64url(compressed)}`;
}
export async function readShared(hash: string): Promise<string | null> {
  if (!hash.startsWith(PREFIX)) return null;
  const encoded = hash.slice(PREFIX.length).replace(/-/g, '+').replace(/_/g, '/');
  const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(
    await pipe(bytes, new DecompressionStream('deflate-raw'), 5 * 1024 * 1024),
  );
}
