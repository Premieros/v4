import '@testing-library/jest-dom/vitest';

declare global {
  // Augments vitest's Assertion interface with jest-dom matchers.
  // Importing the module above is enough; this file exists so tsc picks up
  // the augmentation for every test file in `tests/`.
}

export {};
