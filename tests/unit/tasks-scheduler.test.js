import { describe, expect, it } from 'vitest';
import { buildBatches, detectConflicts } from '../../src/commands/tasks.js';

const task = (id, owns = [], reads = [], depends_on = []) => ({
  id, owns, reads, depends_on, description: id, complexity: 'medium'
});

describe('task scheduler grounding', () => {
  it('treats write/read overlap as a parallel conflict', () => {
    const tasks = [
      task('T1', ['src/shared/']),
      task('T2', ['src/feature.ts'], ['src/shared/types.ts'])
    ];

    expect(detectConflicts(tasks)).toMatchObject([
      { taskA: 'T1', taskB: 'T2' }
    ]);
    expect(buildBatches(tasks).batches).toMatchObject([
      { type: 'serial', tasks: ['T1', 'T2'] }
    ]);
  });

  it('keeps disjoint tasks parallel', () => {
    const tasks = [task('T1', ['src/a/']), task('T2', ['src/b/'])];
    expect(detectConflicts(tasks)).toEqual([]);
    expect(buildBatches(tasks).batches).toEqual([{ type: 'parallel', tasks: ['T1', 'T2'] }]);
  });
});
