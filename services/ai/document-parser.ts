import readXlsxFile from "read-excel-file/node";

const textMimeTypes = new Set([
  "text/plain",
  "text/csv",
  "application/json",
  "application/xml",
  "text/markdown"
]);

/** Extract plain text from a Buffer. Use in background contexts (no File/Request available). */
export async function extractTextFromBuffer(
  buffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<string> {
  const isText = textMimeTypes.has(mimeType) ||
    /\.(csv|txt|md)$/i.test(fileName);
  if (isText) return buffer.toString("utf-8");

  if (/\.(xlsx|xls)$/i.test(fileName)) {
    const rows = (await readXlsxFile(buffer as never) as unknown) as Array<Array<unknown>>;
    return `Planilha: ${fileName}\n${rows.map((row) => row.join("\t")).join("\n")}`;
  }

  if (mimeType === "application/pdf" || /\.pdf$/i.test(fileName)) {
    try {
      const pdfParse = (await import("pdf-parse")).default;
      const result = await pdfParse(buffer);
      return result.text.trim() || `[PDF sem texto extraível: ${fileName}]`;
    } catch {
      return `[Erro ao extrair texto do PDF: ${fileName}. Verifique se o arquivo não está protegido.]`;
    }
  }

  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    /\.docx$/i.test(fileName)
  ) {
    try {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      return result.value.trim() || `[DOCX sem texto extraível: ${fileName}]`;
    } catch {
      return `[Erro ao extrair texto do DOCX: ${fileName}.]`;
    }
  }

  if (/\.doc$/i.test(fileName)) {
    return `[Formato .doc legado não suportado. Converta para .docx: ${fileName}]`;
  }

  return `[Formato não suportado: ${fileName} (${mimeType || "tipo desconhecido"})]`;
}

/** Legacy wrapper for code that already has a File object. */
export async function extractTextFromFile(file: File): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer());
  return extractTextFromBuffer(buffer, file.type, file.name);
}

/**
 * Semantic paragraph-aware chunker.
 * Splits on double-newlines and markdown heading boundaries, then merges
 * short paragraphs up to maxChars. The last paragraph of each chunk is
 * carried forward as overlap context for the next chunk.
 */
export function chunkText(text: string, maxChars = 1400): string[] {
  // Split on paragraph boundaries (2+ newlines) and before markdown headings
  const paragraphs = text
    .split(/\n{2,}|(?=\n#{1,6}\s)/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (!paragraphs.length) return [];

  const SEP = "\n\n";
  const SEP_LEN = SEP.length;
  const chunks: string[] = [];
  let buf: string[] = [];
  let bufLen = 0;

  for (const para of paragraphs) {
    const paraLen = para.length;

    // Paragraph exceeds max on its own — flush buffer then hard-split the paragraph
    if (paraLen > maxChars) {
      if (buf.length) {
        chunks.push(buf.join(SEP));
        buf = [];
        bufLen = 0;
      }
      for (let i = 0; i < paraLen; i += maxChars - 100) {
        chunks.push(para.slice(i, Math.min(i + maxChars, paraLen)));
      }
      continue;
    }

    const addLen = buf.length > 0 ? SEP_LEN + paraLen : paraLen;

    if (bufLen + addLen > maxChars && buf.length > 0) {
      // Flush and keep last paragraph as overlap context
      chunks.push(buf.join(SEP));
      const overlap = buf[buf.length - 1];
      buf = [overlap, para];
      bufLen = overlap.length + SEP_LEN + paraLen;
    } else {
      buf.push(para);
      bufLen += addLen;
    }
  }

  if (buf.length) chunks.push(buf.join(SEP));
  return chunks.filter(Boolean);
}
