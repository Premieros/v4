import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INTERACTION_CONTRACTS } from '@/lib/interactionIdentity';

const root = resolve(process.cwd());

describe('Interaction-Identity Registry (6H-P5)', () => {
  it('registers at least the core stable contracts', () => {
    expect(INTERACTION_CONTRACTS.length).toBeGreaterThan(40);
  });

  for (const contract of INTERACTION_CONTRACTS) {
    it(`keeps ${contract.testId} (${contract.label}) present in ${contract.file}`, () => {
      const source = readFileSync(resolve(root, contract.file), 'utf8');
      expect(source).toContain(contract.marker);
    });
  }

  it('every registered contract points at an existing source file', () => {
    for (const contract of INTERACTION_CONTRACTS) {
      expect(() => readFileSync(resolve(root, contract.file), 'utf8')).not.toThrow();
    }
  });
});
