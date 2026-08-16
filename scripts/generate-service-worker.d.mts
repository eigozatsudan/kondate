/** Vite closeBundle から呼ぶ許可リスト SW 生成器。時計や乱数は使わない。 */
export function generateServiceWorker(options: { distDir: string }): Promise<{
  cacheName: string;
  precacheUrls: string[];
  outputPath: string;
}>;

export function assertPrecacheUrls(urls: readonly string[]): void;

export function buildPrecacheUrls(manifest: Record<string, unknown>): string[];

export function isHashedPrecachePath(url: string): boolean;

export const FIXED_PRECACHE_URLS: readonly string[];
