import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';

export function renderBarcode(canvas: HTMLCanvasElement, value: string): void {
  try {
    JsBarcode(canvas, value || '000000000000', {
      format: 'CODE128',
      width: 2,
      height: 60,
      displayValue: true,
      fontSize: 14,
      margin: 4,
    });
  } catch {
    // ignore invalid barcodes
  }
}

export async function generateQRCodeDataURL(value: string): Promise<string> {
  return QRCode.toDataURL(value, { width: 200, margin: 1 });
}
