/**
 * Types for the plain-JS config helper, which `vite.config.ts` imports.
 *
 * The helper stays JavaScript because the deploy scripts run it directly with node, before any build
 * step exists to compile it — a .ts file there would need its own toolchain to answer a question as
 * small as "which config file".
 */
export function stripJsonc(text: string): string;
export function configPath(): string;
export function readWranglerConfig(path?: string): {
  name: string;
  main?: string;
  vars?: Record<string, string>;
  d1_databases?: { binding: string; database_name: string; database_id: string }[];
  r2_buckets?: { binding: string; bucket_name: string }[];
};
export function backupBucketName(config?: ReturnType<typeof readWranglerConfig>): string | null;
export function builtConfigPath(config?: ReturnType<typeof readWranglerConfig>): string;
