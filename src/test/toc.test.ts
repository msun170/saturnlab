import { describe, it, expect } from 'vitest';
import { extractHeadings } from '../components/sidebar/TableOfContents';

describe('Table of Contents heading extraction', () => {
  it('extracts h1 heading', () => {
    const cells = [{ cell_type: 'markdown', source: '# Title' }];
    const headings = extractHeadings(cells);
    expect(headings.length).toBe(1);
    expect(headings[0].level).toBe(1);
    expect(headings[0].text).toBe('Title');
    expect(headings[0].cellIndex).toBe(0);
  });

  it('extracts multiple heading levels', () => {
    const cells = [
      { cell_type: 'markdown', source: '# Title\n## Subtitle\n### Section' },
    ];
    const headings = extractHeadings(cells);
    expect(headings.length).toBe(3);
    expect(headings[0].level).toBe(1);
    expect(headings[1].level).toBe(2);
    expect(headings[2].level).toBe(3);
  });

  it('ignores code cells', () => {
    const cells = [
      { cell_type: 'code', source: '# This is a comment, not a heading' },
    ];
    const headings = extractHeadings(cells);
    expect(headings.length).toBe(0);
  });

  it('handles array source', () => {
    const cells = [
      { cell_type: 'markdown', source: ['# Title\n', '## Section\n'] },
    ];
    const headings = extractHeadings(cells);
    expect(headings.length).toBe(2);
  });

  it('returns correct cell index for multiple cells', () => {
    const cells = [
      { cell_type: 'code', source: 'x = 1' },
      { cell_type: 'markdown', source: '# First' },
      { cell_type: 'code', source: 'y = 2' },
      { cell_type: 'markdown', source: '## Second' },
    ];
    const headings = extractHeadings(cells);
    expect(headings.length).toBe(2);
    expect(headings[0].cellIndex).toBe(1);
    expect(headings[1].cellIndex).toBe(3);
  });

  it('returns empty for no headings', () => {
    const cells = [
      { cell_type: 'markdown', source: 'Just some text without headings' },
    ];
    const headings = extractHeadings(cells);
    expect(headings.length).toBe(0);
  });

  it('handles h4 through h6', () => {
    const cells = [
      { cell_type: 'markdown', source: '#### H4\n##### H5\n###### H6' },
    ];
    const headings = extractHeadings(cells);
    expect(headings.length).toBe(3);
    expect(headings[0].level).toBe(4);
    expect(headings[1].level).toBe(5);
    expect(headings[2].level).toBe(6);
  });
});
