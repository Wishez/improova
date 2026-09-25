/** Выгрузка файлов, CSV и сжатие изображений в браузере. */

export function downloadText(params: { readonly filename: string; readonly content: string; readonly mime: string }): void {
  const blob = new Blob([params.content], { type: params.mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = params.filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const escapeCsv = (value: string): string =>
  /[";\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

/** CSV с BOM и разделителем «;» — открывается в Excel без настроек (ТЗ 8.2). */
export function toCsv(rows: readonly (readonly string[])[]): string {
  return `﻿${rows.map((row) => row.map(escapeCsv).join(';')).join('\r\n')}`;
}

export interface ICompressedImage {
  readonly dataUrl: string;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
}

const MAX_SIDE = 1600;

export async function compressImage(file: File): Promise<ICompressedImage> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas 2D недоступен');
  }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const dataUrl = canvas.toDataURL('image/webp', 0.82);
  return { dataUrl, width, height, bytes: Math.round((dataUrl.length * 3) / 4) };
}

export function readFileText(file: File): Promise<string> {
  return file.text();
}
