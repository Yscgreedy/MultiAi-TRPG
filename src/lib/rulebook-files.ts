import * as pdfjs from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface RulebookFileImport {
  content: string;
  sourceName: string;
  fileCount: number;
}

const TEXT_LAYER_REQUIRED_MESSAGE =
  "扫描版 PDF 无法导入。请上传带文字层、可复制文字的 PDF，或改用官方/授权渠道提供的 TXT、Markdown、文字版 PDF。";

type PdfTextItem = {
  str: string;
};

type PdfTextContentChunk = {
  items?: unknown[];
};

export async function readRulebookFiles(files: File[]): Promise<RulebookFileImport> {
  const supported = files.filter(isSupportedRulebookFile);
  if (!supported.length) {
    throw new Error("请选择 .pdf、.txt、.md 或 .markdown 规则书文件。");
  }

  const parts = await Promise.all(
    supported.map(async (file) => {
      const text = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
        ? await readPdfText(file)
        : await readTextFile(file);
      const sourceName = getDisplayFilePath(file);
      return `# ${sourceName}\n\n${text.trim()}`;
    }),
  );
  const content = parts.filter(Boolean).join("\n\n---\n\n").trim();
  if (!content) {
    throw new Error(TEXT_LAYER_REQUIRED_MESSAGE);
  }

  return {
    content,
    sourceName: supported.map(getDisplayFilePath).join(", "),
    fileCount: supported.length,
  };
}

export function isSupportedRulebookFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    name.endsWith(".pdf") ||
    name.endsWith(".txt") ||
    name.endsWith(".md") ||
    name.endsWith(".markdown")
  );
}

export function getDisplayFilePath(file: File): string {
  return (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
}

function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error(`读取 ${file.name} 失败`));
    reader.readAsText(file);
  });
}

async function readPdfText(file: File): Promise<string> {
  const data = new Uint8Array(await file.arrayBuffer());
  const document = await pdfjs.getDocument({ data }).promise;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const textItems = await readPdfPageTextItems(page);
    const text = textItems
      .map((item) => item.str)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) {
      pages.push(text);
    }
  }

  const content = pages.join("\n\n").trim();
  if (!content) {
    throw new Error(`${getDisplayFilePath(file)}：${TEXT_LAYER_REQUIRED_MESSAGE}`);
  }

  return content;
}

async function readPdfPageTextItems(
  page: pdfjs.PDFPageProxy,
): Promise<PdfTextItem[]> {
  const reader = page.streamTextContent().getReader();
  const items: PdfTextItem[] = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      const chunk = value as PdfTextContentChunk;
      items.push(...(chunk.items ?? []).filter(isPdfTextItem));
    }
  } finally {
    reader.releaseLock();
  }

  return items;
}

function isPdfTextItem(item: unknown): item is PdfTextItem {
  return (
    typeof item === "object" &&
    item !== null &&
    "str" in item &&
    typeof item.str === "string"
  );
}
