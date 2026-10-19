import { describe, expect, it } from 'vitest';
import { addToQueue, moveInQueue, nextInQueue, removeFromQueue } from './queue';

describe('queue', () => {
  it('não duplica ao adicionar', () => {
    expect(addToQueue(['a'], 'b')).toEqual(['a', 'b']);
    expect(addToQueue(['a'], 'a')).toEqual(['a']);
  });
  it('remove', () => {
    expect(removeFromQueue(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
  });
  it('move para cima/baixo respeitando os limites', () => {
    expect(moveInQueue(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveInQueue(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(moveInQueue(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c']);
  });
  it('próxima da fila', () => {
    expect(nextInQueue(['a', 'b', 'c'], 'a')).toBe('b');
    expect(nextInQueue(['a', 'b', 'c'], 'c')).toBeNull();
    expect(nextInQueue(['a', 'b'], 'x')).toBeNull();
  });
});
