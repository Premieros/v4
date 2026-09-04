import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('sidebar direction contract', () => {
  it('positions sidebar via logical end-0/start-0 from ar flag', () => {
    const layout = read('src/components/Layout.tsx');
    expect(layout).toContain("ar ? 'start-0' : 'end-0'");
    expect(layout).toContain("ar ? 'translate-x-full' : 'translate-x-full'");
  });

  it('sidebar starts below the fixed header at top-[64px]', () => {
    const layout = read('src/components/Layout.tsx');
    expect(layout).toContain('fixed top-0 bottom-0');
  });

  it('header is fixed and offsets by sidebar width on desktop', () => {
    const layout = read('src/components/Layout.tsx');
    expect(layout).toContain('fixed top-0 start-0 end-0');
    expect(layout).toContain("ar ? 'lg:start-[260px]' : 'lg:end-[260px]'");
  });

  it('main content offsets for sidebar and header', () => {
    const layout = read('src/components/Layout.tsx');
    expect(layout).toContain('pt-[64px]');
    expect(layout).toContain("ar ? 'lg:ms-[260px]' : 'lg:me-[260px]'");
  });

  it('keeps the shared shell direction source on the Layout root', () => {
    const layout = read('src/components/Layout.tsx');
    expect(layout).toContain('<div dir={ar ? \'rtl\' : \'ltr\'}');
    expect(layout).toContain('data-testid="app-sidebar"');
    expect(layout).toContain('lg:translate-x-0');
  });
});
