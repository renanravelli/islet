// The extension's only logger. Messages are fixed strings plus non-personal details (types,
// codes, counts): never names, titles, meeting codes or message content.

export function warn(message: string, detail?: string | number): void {
  console.warn(detail === undefined ? `[islet] ${message}` : `[islet] ${message}: ${detail}`);
}
