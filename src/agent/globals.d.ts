interface Window {
  rrweb?: any;
  __mirrorRefresh?: () => void;
  __mirrorDrain?: (timeoutMs: number) => [string, string][] | Promise<[string, string][]>;
}
