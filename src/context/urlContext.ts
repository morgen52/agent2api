import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import type { AgentRunRequest, MaterialFile } from "../contract/requestSchema.js";

export type UrlContextOptions = {
  fetchUrlContent?: boolean;
  allowedUrlHosts?: string[];
  maxUrlBytes?: number;
  fetch?: typeof fetch;
};

export async function enrichUrlContext(request: AgentRunRequest, options: UrlContextOptions): Promise<AgentRunRequest> {
  if (options.fetchUrlContent === false || request.context.urls.length === 0) {
    return request;
  }

  const fetchFn = options.fetch ?? globalThis.fetch;
  const maxUrlBytes = options.maxUrlBytes ?? 1_000_000;
  const fetchedFiles: MaterialFile[] = [];
  const notes: string[] = [];

  for (const [index, item] of request.context.urls.entries()) {
    const url = new URL(item.url);
    await assertUrlAllowed(url, options.allowedUrlHosts ?? []);

    const response = await fetchFn(url);
    if (!response.ok) {
      throw new Error(`failed to fetch URL ${item.url}: ${response.status}`);
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength && Number(contentLength) > maxUrlBytes) {
      throw new Error(`URL content exceeds ${maxUrlBytes} bytes: ${item.url}`);
    }

    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxUrlBytes) {
      throw new Error(`URL content exceeds ${maxUrlBytes} bytes: ${item.url}`);
    }

    const name = `url-${index + 1}.txt`;
    fetchedFiles.push({
      name,
      mimeType: response.headers.get("content-type")?.split(";")[0] || "text/plain",
      text
    });
    notes.push(`Fetched URL ${item.url} into input/files/${name}.`);
  }

  return {
    ...request,
    context: {
      ...request.context,
      files: [...request.context.files, ...fetchedFiles],
      notes: [...request.context.notes, ...notes]
    }
  };
}

async function assertUrlAllowed(url: URL, allowedUrlHosts: string[]): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`unsupported URL protocol: ${url.protocol}`);
  }

  if (allowedUrlHosts.includes(url.hostname)) {
    return;
  }

  const address = isIP(url.hostname) ? url.hostname : (await lookup(url.hostname)).address;
  if (isPrivateAddress(address)) {
    throw new Error(`URL host is private or loopback and must be allowlisted: ${url.hostname}`);
  }
}

function isPrivateAddress(address: string): boolean {
  if (address === "::1" || address.startsWith("fe80:") || address.startsWith("fc") || address.startsWith("fd")) {
    return true;
  }

  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
    return false;
  }

  const [a, b] = parts;
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}
