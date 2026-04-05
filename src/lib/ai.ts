/**
 * AI prompt builders for Saturn's code assistance features.
 */

import { aiComplete } from './ipc';

const SYSTEM_EXPLAIN = `You are a coding assistant for a Jupyter notebook. Explain the given code clearly and concisely. Focus on what the code does, not how Python syntax works. Use bullet points for multi-step code. Keep it under 200 words.`;

const SYSTEM_FIX = `You are a coding assistant for a Jupyter notebook. The user's code produced an error. Return ONLY the corrected code with no explanation, no markdown fences, no commentary. Just the fixed Python code.`;

const SYSTEM_GENERATE = `You are a coding assistant for a Jupyter notebook. The user will describe what they want. Return ONLY the Python code with no explanation, no markdown fences, no commentary. Just working Python code. Include necessary imports.`;

export async function explainCell(source: string): Promise<string> {
  return aiComplete(SYSTEM_EXPLAIN, `Explain this code:\n\n${source}`);
}

export async function fixError(source: string, error: string): Promise<string> {
  return aiComplete(
    SYSTEM_FIX,
    `This code:\n\n${source}\n\nProduced this error:\n\n${error}\n\nReturn the fixed code.`,
  );
}

export async function generateCode(instruction: string, context: string): Promise<string> {
  const prompt = context
    ? `Context (previous cell code):\n${context}\n\nWrite code that: ${instruction}`
    : `Write code that: ${instruction}`;
  return aiComplete(SYSTEM_GENERATE, prompt);
}
