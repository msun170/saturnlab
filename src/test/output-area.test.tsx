import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import OutputArea from '../components/output/OutputArea';
import type { Output } from '../types/notebook';

describe('OutputArea', () => {
  it('renders nothing for empty outputs', () => {
    const { container } = render(<OutputArea outputs={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders stream output as text', () => {
    const outputs: Output[] = [
      { output_type: 'stream', text: 'hello world\n', name: 'stdout' },
    ];
    render(<OutputArea outputs={outputs} />);
    expect(screen.getByText('hello world')).toBeTruthy();
  });

  it('renders execute_result with Out[n]: prompt', () => {
    const outputs: Output[] = [
      {
        output_type: 'execute_result',
        data: { 'text/plain': '42' },
        execution_count: 5,
      },
    ];
    render(<OutputArea outputs={outputs} />);
    expect(screen.getByText('Out[5]:')).toBeTruthy();
    expect(screen.getByText('42')).toBeTruthy();
  });

  it('renders error output with traceback', () => {
    const outputs: Output[] = [
      {
        output_type: 'error',
        ename: 'NameError',
        evalue: "name 'foo' is not defined",
        traceback: ["NameError: name 'foo' is not defined"],
      },
    ];
    render(<OutputArea outputs={outputs} />);
    expect(screen.getByText("NameError: name 'foo' is not defined")).toBeTruthy();
  });

  it('renders HTML output in sandboxed iframe', () => {
    const outputs: Output[] = [
      {
        output_type: 'display_data',
        data: { 'text/html': '<b>bold text</b>' },
      },
    ];
    const { container } = render(<OutputArea outputs={outputs} />);
    const iframe = container.querySelector('iframe');
    expect(iframe).toBeTruthy();
    // Static HTML (no scripts): strict sandbox (empty string)
    expect(iframe?.getAttribute('sandbox')).toBe('');
    expect(iframe?.getAttribute('srcdoc')).toContain('bold text');
  });

  it('renders image output', async () => {
    const outputs: Output[] = [
      {
        output_type: 'display_data',
        data: { 'image/png': 'iVBORw0KGgo=' },
      },
    ];
    const { container } = render(<OutputArea outputs={outputs} />);
    // IntersectionObserver mock fires async, wait for img to appear
    await waitFor(() => {
      const img = container.querySelector('img');
      expect(img).toBeTruthy();
      expect(img?.src).toContain('data:image/png;base64,');
    });
  });

  it('always renders prompt spacer div for alignment', () => {
    const outputs: Output[] = [
      { output_type: 'stream', text: 'test', name: 'stdout' },
    ];
    const { container } = render(<OutputArea outputs={outputs} />);
    const promptDivs = container.querySelectorAll('.output-prompt');
    expect(promptDivs.length).toBe(1);
    // Stream output should have empty prompt (no Out[n])
    expect(promptDivs[0].textContent).toBe('');
  });

  it('renders multiple outputs', () => {
    const outputs: Output[] = [
      { output_type: 'stream', text: 'line 1\n', name: 'stdout' },
      { output_type: 'stream', text: 'line 2\n', name: 'stdout' },
    ];
    render(<OutputArea outputs={outputs} />);
    expect(screen.getByText('line 1')).toBeTruthy();
    expect(screen.getByText('line 2')).toBeTruthy();
  });

  it('renders stderr with stderr class', () => {
    const outputs: Output[] = [
      { output_type: 'stream', text: 'warning message', name: 'stderr' },
    ];
    const { container } = render(<OutputArea outputs={outputs} />);
    const stderrEl = container.querySelector('.stderr');
    expect(stderrEl).toBeTruthy();
  });
});
