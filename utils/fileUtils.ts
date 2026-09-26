const downloadFile = (filename: string, content: string, mimeType: string) => {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export const exportAsJSON = (data: object, filename: string) => downloadFile(filename, JSON.stringify(data), 'application/json');

export const csvCell = (value: string): string => {
  const text = String(value);
  const safe = /^[=+\-@\t\r\n]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};

export const exportAsCSV = (data: { headers: string[]; rows: string[][] }, filename: string) => {
  const content = [data.headers, ...data.rows].map(row => row.map(csvCell).join(',')).join('\r\n');
  downloadFile(filename, content, 'text/csv;charset=utf-8;');
};
