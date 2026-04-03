/** Kernel process memory info from Rust sysinfo. */
export interface MemoryInfo {
  kernel_rss: number;
  total_memory: number;
  available_memory: number;
}

/** A single variable from the kernel's namespace. */
export interface VariableInfo {
  name: string;
  type: string;
  size: number;
  shape: string;
  dtype: string;
  id: number;
}

/** Format bytes to human-readable string. */
export function formatBytes(bytes: number): string {
  if (bytes < 0) return 'unknown';
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
