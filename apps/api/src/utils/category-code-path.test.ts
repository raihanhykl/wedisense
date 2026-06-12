import { describe, it, expect } from 'vitest';
import { buildCategoryCodePath } from './category-code-path.js';

const IT = { id: 'cat-it', code: 'IT', parentId: null };
const NB = { id: 'cat-nb', code: 'NB', parentId: 'cat-it' };
const SP = { id: 'cat-sp', code: 'SP', parentId: 'cat-nb' };

describe('buildCategoryCodePath()', () => {
  it('returns just the code for a root category', () => {
    expect(buildCategoryCodePath('cat-it', [IT, NB, SP])).toBe('IT');
  });

  it('prefixes the parent code for a depth-1 child', () => {
    expect(buildCategoryCodePath('cat-nb', [IT, NB, SP])).toBe('IT/NB');
  });

  it('joins the full ancestor chain root-first for deeper nesting', () => {
    expect(buildCategoryCodePath('cat-sp', [IT, NB, SP])).toBe('IT/NB/SP');
  });

  it('returns an empty string for an unknown category id', () => {
    expect(buildCategoryCodePath('cat-missing', [IT, NB])).toBe('');
  });

  it('truncates the walk when an ancestor is missing from the list', () => {
    // NB references cat-it, but IT is absent → path falls back to "NB"
    expect(buildCategoryCodePath('cat-nb', [NB, SP])).toBe('NB');
  });

  it('does not loop forever on a parent cycle', () => {
    const a = { id: 'a', code: 'A', parentId: 'b' };
    const b = { id: 'b', code: 'B', parentId: 'a' };
    // Visited-set stops the walk after each node is seen once.
    expect(buildCategoryCodePath('a', [a, b])).toBe('B/A');
  });
});
