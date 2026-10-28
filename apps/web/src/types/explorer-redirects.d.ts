declare module "./src/lib/navigation/explorer-redirects.mjs" {
  export function explorerRedirects(configured?: string): Array<{
    source: string;
    destination: string;
    permanent: boolean;
  }>;
}

declare module "@/lib/navigation/explorer-redirects.mjs" {
  export function explorerRedirects(configured?: string): Array<{
    source: string;
    destination: string;
    permanent: boolean;
  }>;
}
