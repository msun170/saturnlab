/** A kernelspec as reported by the backend. */
export interface KernelSpec {
  name: string;
  display_name: string;
  language: string;
  argv: string[];
}

/** Info about a running kernel. */
export interface KernelInfo {
  id: string;
  name: string;
  display_name: string;
  language: string;
  status: string;
}

/** Output event emitted from the backend via Tauri events. */
export interface KernelOutput {
  kernel_id: string;
  msg_type: string;
  content: Record<string, unknown>;
  parent_msg_id: string;
}
