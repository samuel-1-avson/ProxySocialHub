declare module "./src/lib/navigation/explorer-redirects.mjs" {
  export const STANDALONE_EXPLORER_ORIGIN: string;
  export function explorerRedirects(configured?: string): Array<{
    source: string;
    destination: string;
    permanent: boolean;
  }>;
  export function matchExplorerRedirect(
    configured: string | undefined,
    pathname: string,
    search?: string,
  ): string | null;
}

declare module "@/lib/navigation/explorer-redirects.mjs" {
  export const STANDALONE_EXPLORER_ORIGIN: string;
  export function explorerRedirects(configured?: string): Array<{
    source: string;
    destination: string;
    permanent: boolean;
  }>;
  export function matchExplorerRedirect(
    configured: string | undefined,
    pathname: string,
    search?: string,
  ): string | null;
}
