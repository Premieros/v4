import { describe, expect, it, vi } from 'vitest';
import { downloadCSV, openPrintWindow, toCSV } from '@/lib/reportExport';

describe('reportExport (ERP-01 §6 output)', () => {
  it('serializes a simple table to CSV', () => {
    const csv = toCSV([
      { Name: 'A', Total: 1 },
      { Name: 'B', Total: 2 },
    ]);
    expect(csv).toBe('Name,Total\nA,1\nB,2');
  });

  it('quotes cells containing commas, quotes and newlines (RFC 4180)', () => {
    const csv = toCSV([{ Name: 'Ahmed, Omar', Note: 'say "hi"', Total: 5 }]);
    expect(csv).toBe('Name,Note,Total\n"Ahmed, Omar","say ""hi""",5');
  });

  it('returns an empty string for no rows', () => {
    expect(toCSV([])).toBe('');
  });

  it('downloads a UTF-8 BOM-prefixed CSV file', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const append = vi.spyOn(document.body, 'appendChild').mockImplementation(() => ({}) as never);
    const remove = vi.spyOn(HTMLElement.prototype, 'remove').mockImplementation(() => {});
    downloadCSV([{ Name: 'A' }], 'report_sales');
    expect(append).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('writes an escaped printable report to a new window and closes the document', () => {
    const write = vi.fn();
    const close = vi.fn();
    const open = vi.spyOn(window, 'open').mockReturnValue({ document: { write, close } } as unknown as Window);
    openPrintWindow({
      title: 'Sales <Report>',
      subtitle: '2026-01-01 - 2026-01-31',
      headers: ['Product', 'Qty'],
      rows: [['Koshari & Co.', '3']],
      lang: 'ar',
    });
    expect(open).toHaveBeenCalledWith('', '_blank', expect.stringContaining('width='));
    const html = write.mock.calls[0][0] as string;
    expect(html).toContain('Sales &lt;Report&gt;');
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('<table>');
    expect(html).toContain('Koshari &amp; Co.');
    expect(close).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('returns silently when the print window cannot be opened', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    expect(() => openPrintWindow({ title: 'X', headers: [], rows: [] })).not.toThrow();
    vi.restoreAllMocks();
  });
});
