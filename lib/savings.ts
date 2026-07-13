// Shared helpers for the /savings tracked calculator links (kept out of the route
// files, which may only export GET/POST/config).
export const CALCULATOR_URL =
  "https://www.nearwork.co/services/direct-recruiting#salary-intelligence";

const OFFSET = 100000;
export const codeForId = (id: number) => (id + OFFSET).toString(36);
export function idForCode(code: string): number | null {
  const n = parseInt(code, 36) - OFFSET;
  return Number.isInteger(n) && n > 0 ? n : null;
}
