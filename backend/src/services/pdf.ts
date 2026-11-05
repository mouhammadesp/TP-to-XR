/**
 * PDF text extraction (pdf-parse v2, pdf.js under the hood).
 */
import { PDFParse } from "pdf-parse";
import { HttpError, errorMessage } from "../utils/http";

export interface PdfText {
  text: string;
  pages: number;
  chars: number;
}

/**
 * Extracts the plain text of a PDF.
 * @throws HttpError 400 if the buffer is not a readable PDF, 422 if it has no text layer
 */
export async function extractPdfText(data: Buffer): Promise<PdfText> {
  if (data.length < 5 || data.subarray(0, 5).toString("latin1") !== "%PDF-") {
    throw new HttpError(400, "Body is not a PDF file (missing %PDF- header)");
  }
  console.log(`📑 Extracting text from PDF (${(data.length / 1024).toFixed(0)} KB)...`);

  const parser = new PDFParse({ data: new Uint8Array(data) });
  try {
    const result = await parser.getText();
    const text = normalizeText(result.text);
    if (!text) {
      throw new HttpError(422, "PDF has no text layer (scanned document?) — OCR is not supported yet");
    }
    console.log(`✅ PDF extracted: ${result.total} pages, ${text.length} chars`);
    return { text, pages: result.total, chars: text.length };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, `Unreadable PDF: ${errorMessage(err)}`);
  } finally {
    await parser.destroy();
  }
}

/**
 * Removes pdf-parse page separators and collapses excessive blank lines.
 */
function normalizeText(raw: string): string {
  return raw
    .replace(/^-- \d+ of \d+ --$/gm, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
