// Ambient types for the `known-hosts` package (CommonJS, ships no .d.ts).
// It parses ~/.ssh/known_hosts into an array at import time.
declare module "known-hosts" {
  interface KnownHostEntry {
    host: string;
    publicKey: string;
    fingerprint: string;
  }
  const entries: KnownHostEntry[];
  export default entries;
}
