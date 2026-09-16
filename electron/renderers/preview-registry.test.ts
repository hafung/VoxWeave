import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PreviewRegistry } from './preview-registry.js';

describe('PreviewRegistry', () => {
  it('maps only registered composition resources below their workspace', () => {
    const registry = new PreviewRegistry();
    const url = registry.register('plan-2', path.resolve('/tmp/preview-root'));
    expect(url).toBe('voxweave-preview://composition/plan-2/index.html');
    expect(registry.resolve(url).pathname).toContain('/tmp/preview-root/index.html');
    expect(() => registry.resolve('voxweave-preview://composition/plan-2/%2e%2e/secret')).toThrow();
  });
});
