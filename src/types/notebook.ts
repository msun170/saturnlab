/** A Jupyter notebook (nbformat v4). */
export interface Notebook {
  nbformat: number;
  nbformat_minor: number;
  metadata: NotebookMetadata;
  cells: Cell[];
}

export interface NotebookMetadata {
  kernelspec?: KernelSpecMeta;
  language_info?: LanguageInfo;
  [key: string]: unknown;
}

export interface KernelSpecMeta {
  name: string;
  display_name: string;
  language?: string;
}

export interface LanguageInfo {
  name: string;
  version?: string;
  [key: string]: unknown;
}

/** A single notebook cell. */
export interface Cell {
  cell_type: 'code' | 'markdown' | 'raw';
  source: string | string[];
  metadata: Record<string, unknown>;
  outputs?: Output[];
  execution_count?: number | null;
  id?: string;
}

/** A cell output. */
export interface Output {
  output_type: 'stream' | 'display_data' | 'execute_result' | 'error';
  data?: Record<string, unknown>;
  text?: string | string[];
  name?: string;
  ename?: string;
  evalue?: string;
  traceback?: string[];
  execution_count?: number | null;
}

/** Helper to get cell source as a single string. */
export function getCellSource(source: string | string[]): string {
  return Array.isArray(source) ? source.join('') : source;
}
