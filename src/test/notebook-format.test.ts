import { describe, it, expect } from 'vitest';
import { getCellSource } from '../types/notebook';
import type { Notebook, Output } from '../types/notebook';

describe('Notebook format parsing', () => {
  it('getCellSource handles string source', () => {
    expect(getCellSource('print("hello")')).toBe('print("hello")');
  });

  it('getCellSource handles array source', () => {
    expect(getCellSource(['import pandas as pd\n', 'df = pd.read_csv("data.csv")'])).toBe(
      'import pandas as pd\ndf = pd.read_csv("data.csv")',
    );
  });

  it('getCellSource handles empty string', () => {
    expect(getCellSource('')).toBe('');
  });

  it('getCellSource handles empty array', () => {
    expect(getCellSource([])).toBe('');
  });
});

describe('Notebook structure', () => {
  const sampleNotebook: Notebook = {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: { name: 'python3', display_name: 'Python 3' },
    },
    cells: [
      {
        cell_type: 'markdown',
        source: '# Title\nSome description',
        metadata: {},
      },
      {
        cell_type: 'code',
        source: ['import pandas as pd\n', 'df = pd.read_csv("test.csv")'],
        metadata: {},
        outputs: [
          {
            output_type: 'execute_result',
            data: { 'text/plain': '  col1  col2\n0    1     2' },
            execution_count: 1,
          },
        ],
        execution_count: 1,
      },
      {
        cell_type: 'code',
        source: 'print("hello")',
        metadata: {},
        outputs: [
          {
            output_type: 'stream',
            text: 'hello\n',
            name: 'stdout',
          },
        ],
        execution_count: 2,
      },
    ],
  };

  it('has correct nbformat', () => {
    expect(sampleNotebook.nbformat).toBe(4);
  });

  it('has correct number of cells', () => {
    expect(sampleNotebook.cells.length).toBe(3);
  });

  it('identifies cell types correctly', () => {
    expect(sampleNotebook.cells[0].cell_type).toBe('markdown');
    expect(sampleNotebook.cells[1].cell_type).toBe('code');
    expect(sampleNotebook.cells[2].cell_type).toBe('code');
  });

  it('parses code cell source correctly', () => {
    const source = getCellSource(sampleNotebook.cells[1].source);
    expect(source).toContain('import pandas');
    expect(source).toContain('read_csv');
  });

  it('has outputs on code cells', () => {
    expect(sampleNotebook.cells[1].outputs).toBeDefined();
    expect(sampleNotebook.cells[1].outputs!.length).toBe(1);
    expect(sampleNotebook.cells[1].outputs![0].output_type).toBe('execute_result');
  });

  it('has execution count on code cells', () => {
    expect(sampleNotebook.cells[1].execution_count).toBe(1);
    expect(sampleNotebook.cells[2].execution_count).toBe(2);
  });

  it('has no outputs on markdown cells', () => {
    expect(sampleNotebook.cells[0].outputs).toBeUndefined();
  });

  it('stream output has text and name', () => {
    const output = sampleNotebook.cells[2].outputs![0];
    expect(output.output_type).toBe('stream');
    expect(output.name).toBe('stdout');
    expect(output.text).toBe('hello\n');
  });

  it('execute_result output has data MIME bundle', () => {
    const output = sampleNotebook.cells[1].outputs![0];
    expect(output.data).toBeDefined();
    expect(output.data!['text/plain']).toContain('col1');
  });
});

describe('Output type handling', () => {
  it('handles error output with traceback', () => {
    const errorOutput: Output = {
      output_type: 'error',
      ename: 'NameError',
      evalue: "name 'foo' is not defined",
      traceback: [
        '\u001b[0;31m-----------\u001b[0m',
        "\u001b[0;31mNameError\u001b[0m: name 'foo' is not defined",
      ],
    };
    expect(errorOutput.ename).toBe('NameError');
    expect(errorOutput.traceback!.length).toBe(2);
  });

  it('handles display_data with image', () => {
    const imageOutput: Output = {
      output_type: 'display_data',
      data: {
        'image/png': 'iVBORw0KGgoAAAANSUhEUg==',
        'text/plain': '<Figure size 640x480>',
      },
    };
    expect(imageOutput.data!['image/png']).toBeDefined();
    expect(imageOutput.data!['text/plain']).toContain('Figure');
  });

  it('handles stream output with stderr', () => {
    const stderrOutput: Output = {
      output_type: 'stream',
      name: 'stderr',
      text: 'Warning: deprecated function\n',
    };
    expect(stderrOutput.name).toBe('stderr');
  });
});
