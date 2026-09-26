
import { Snapshot } from '../types';

const downloadFile = (filename: string, content: string, mimeType: string) => {
  const element = document.createElement('a');
  const file = new Blob([content], { type: mimeType });
  element.href = URL.createObjectURL(file);
  element.download = filename;
  document.body.appendChild(element);
  element.click();
  document.body.removeChild(element);
};

export const exportAsJSON = (data: object, filename: string) => {
  downloadFile(filename, JSON.stringify(data, null, 2), 'application/json');
};

export const exportAsCSV = (data: { headers: string[]; rows: string[][] }, filename: string) => {
  const csvContent = [
    data.headers.join(','),
    ...data.rows.map(row => row.join(','))
  ].join('\n');
  downloadFile(filename, csvContent, 'text/csv;charset=utf-8;');
};
