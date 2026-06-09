import readXlsxFile from "read-excel-file/node";

const textMimeTypes = new Set([
  "text/plain",
  "text/csv",
  "application/json",
  "application/xml",
  "text/markdown"
]);

export async function extractTextFromFile(file: File): Promise<string> {
  // Plain text types
  if (textMimeTypes.has(file.type) || file.name.endsWith(".csv") || file.name.endsWith(".txt") || file.name.endsWith(".md")) {
    return file.text();
  }

  // Excel
  if (file.name.endsWith(".xlsx") || file.name.endsWith(".xls")) {
    const buffer = await file.arrayBuffer();
    const rows = (await readXlsxFile(Buffer.from(buffer) as never) as unknown) as Array<Array<unknown>>;
    return `Planilha: ${file.name}\n${rows.map((row) => row.join("\t")).join("\n")}`;
  }

  // PDF — uses pdf-parse (Node.js only, kept out of webpack via serverExternalPackages)
  if (file.type === "application/pdf" || file.name.endsWith(".pdf")) {
    try {
      const pdfParse = (await import("pdf-parse")).default;
      const buffer = Buffer.from(await file.arrayBuffer());
      const result = await pdfParse(buffer);
      return result.text.trim() || `[PDF sem texto extraível: ${file.name}]`;
    } catch {
      return `[Erro ao extrair texto do PDF: ${file.name}. Verifique se o arquivo não está protegido por senha.]`;
    }
  }

  // DOCX — uses mammoth (Node.js only)
  if (
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    file.name.endsWith(".docx")
  ) {
    try {
      const mammoth = await import("mammoth");
      const buffer = Buffer.from(await file.arrayBuffer());
      const result = await mammoth.extractRawText({ buffer });
      return result.value.trim() || `[DOCX sem texto extraível: ${file.name}]`;
    } catch {
      return `[Erro ao extrair texto do DOCX: ${file.name}.]`;
    }
  }

  // DOC (legacy Word) — not supported by mammoth without conversion
  if (file.name.endsWith(".doc")) {
    return `[Formato .doc legado não suportado. Converta para .docx e envie novamente: ${file.name}]`;
  }

  // Images
  if (file.type.startsWith("image/")) {
    return `[Imagem enviada: ${file.name}. Para extrair texto de imagens, ative OCR na configuração do sistema.]`;
  }

  return `[Formato não suportado para extração de texto: ${file.name} (${file.type || "tipo desconhecido"})]`;
}

export function chunkText(text: string, size = 1400, overlap = 180): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const chunks: string[] = [];
  let start = 0;

  while (start < normalized.length) {
    chunks.push(normalized.slice(start, start + size));
    start += size - overlap;
  }

  return chunks.filter(Boolean);
}
