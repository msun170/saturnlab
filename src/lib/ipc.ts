import { invoke } from '@tauri-apps/api/core';
import type { KernelSpec, KernelInfo } from '../types/kernel';
import type { Notebook } from '../types/notebook';

// ─── Kernel Management ───────────────────────────────────────────────

export async function listKernelspecs(): Promise<KernelSpec[]> {
  return invoke<KernelSpec[]>('list_kernelspecs');
}

export async function startKernel(specName: string): Promise<string> {
  return invoke<string>('start_kernel', { specName });
}

export async function stopKernel(kernelId: string): Promise<void> {
  return invoke<void>('stop_kernel', { kernelId });
}

export async function interruptKernel(kernelId: string): Promise<void> {
  return invoke<void>('interrupt_kernel', { kernelId });
}

export async function listRunningKernels(): Promise<KernelInfo[]> {
  return invoke<KernelInfo[]>('list_running_kernels');
}

// ─── Code Execution ──────────────────────────────────────────────────

export async function executeCode(
  kernelId: string,
  code: string,
  silent: boolean = false,
  msgId?: string,
): Promise<string> {
  return invoke<string>('execute_code', { kernelId, code, silent, msgId: msgId ?? null });
}

// ─── Notebook I/O ────────────────────────────────────────────────────

export async function readNotebook(path: string): Promise<Notebook> {
  return invoke<Notebook>('read_notebook', { path });
}

export async function writeNotebook(path: string, notebook: Notebook): Promise<void> {
  return invoke<void>('write_notebook', { path, notebook });
}

// ─── Filesystem ──────────────────────────────────────────────────────

export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified: number;
}

export async function listDirectory(path: string): Promise<FileEntry[]> {
  return invoke<FileEntry[]>('list_directory', { path });
}

export async function getCwd(): Promise<string> {
  return invoke<string>('get_cwd');
}

export async function renameFile(oldPath: string, newPath: string): Promise<void> {
  return invoke<void>('rename_file', { oldPath, newPath });
}

// ─── Memory ──────────────────────────────────────────────────────────

import type { MemoryInfo } from '../types/memory';

export async function getKernelMemory(kernelId: string): Promise<MemoryInfo> {
  return invoke<MemoryInfo>('get_kernel_memory', { kernelId });
}

export async function inspectVariables(kernelId: string, msgId?: string): Promise<string> {
  return invoke<string>('inspect_variables', { kernelId, msgId: msgId ?? null });
}

// ─── Code Intelligence ───────────────────────────────────────────────

export async function completeCode(
  kernelId: string,
  code: string,
  cursorPos: number,
): Promise<{ matches: string[]; cursor_start: number; cursor_end: number; status: string }> {
  return invoke('complete_code', { kernelId, code, cursorPos });
}

export async function inspectCode(
  kernelId: string,
  code: string,
  cursorPos: number,
): Promise<{ found: boolean; data: Record<string, string> }> {
  return invoke('inspect_code', { kernelId, code, cursorPos });
}

// ─── Settings ────────────────────────────────────────────────────────

export interface AppSettings {
  kernel_auto_stop_minutes: number | null;
  layer_b_delay_seconds: number;
  layer_a_delay_seconds: number;
  autosave_interval_seconds: number;
  show_line_numbers: boolean;
  theme: string;
  editor_font_size: number;
}

export async function getSettings(): Promise<AppSettings> {
  return invoke<AppSettings>('get_settings');
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  return invoke<void>('save_settings', { settings });
}
