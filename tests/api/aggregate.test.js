import { describe, expect, it } from 'vitest';
import { groupPersonFolders } from '../../api/aggregate.js';

describe('aggregate folder grouping', () => {
  it('groups folders by normalized person name', () => {
    const groups = groupPersonFolders([
      { id: 'a', name: '류준,류수현' },
      { id: 'b', name: '류준, 류수현' },
      { id: 'c', name: '이선수, 박종일' },
    ]);

    expect(groups).toEqual([
      { name: '류준, 류수현', folders: [{ id: 'a', name: '류준,류수현' }, { id: 'b', name: '류준, 류수현' }] },
      { name: '이선수, 박종일', folders: [{ id: 'c', name: '이선수, 박종일' }] },
    ]);
  });
});
