declare module "magnet-uri" {
  export function encode(parsed: {
    infoHash?: string;
    [key: string]: unknown;
  }): string;
}

declare module "create-torrent" {
  function createTorrent(
    input: string,
    options: object,
    callback: (err: Error | null, torrent: Buffer) => void
  ): void;
  export default createTorrent;
}

declare module "parse-torrent" {
  interface ParsedTorrent {
    infoHash?: string;
    length?: number;
    [key: string]: unknown;
  }
  function parseTorrent(torrent: Buffer): Promise<ParsedTorrent>;
  export default parseTorrent;
}
