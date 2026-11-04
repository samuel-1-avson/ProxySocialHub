/** Bound every untrusted JSON read by bytes, including chunked responses. */
export async function readAssistantJson(source: Pick<Response, "body" | "headers">, maxBytes: number): Promise<unknown> {
  if (Number(source.headers.get("content-length")) > maxBytes) throw new Error("JSON payload too large");
  const reader = source.body?.getReader();
  if (!reader) throw new Error("Missing JSON body");
  const decoder = new TextDecoder();
  let raw = "";
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) { await reader.cancel(); throw new Error("JSON payload too large"); }
      raw += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(raw + decoder.decode()) as unknown;
  } finally { reader.releaseLock(); }
}
