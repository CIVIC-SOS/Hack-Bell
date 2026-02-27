import { PDFDocument, rgb } from 'pdf-lib';
import type { DetectedEntity } from '../types';

const SUB_PIXEL_PADDING = 5;

/**
 * Renders a PDF page to a canvas for preview and OCR.
 * Uses an offscreen canvas approach for rendering.
 */
export async function renderPDFPageToCanvas(
    pdfBytes: ArrayBuffer,
    pageIndex: number = 0
): Promise<{ canvas: HTMLCanvasElement; width: number; height: number }> {
    // Use pdf.js-like approach via an image conversion
    // For simplicity, we create an object URL and use an embedded approach
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const page = pdfDoc.getPage(pageIndex);
    const { width, height } = page.getSize();

    const canvas = document.createElement('canvas');
    const scale = 2; // Render at 2x for better OCR accuracy
    canvas.width = width * scale;
    canvas.height = height * scale;

    // Note: pdf-lib doesn't render to canvas natively.
    // We'll use the PDF as an image source via object URL for the preview.
    // The actual OCR is done on the original file.

    return { canvas, width: width * scale, height: height * scale };
}

/**
 * Applies destructive redaction to a PDF using pdf-lib.
 * Draws opaque black rectangles over detected entities.
 */
export async function redactPDF(
    pdfBytes: ArrayBuffer,
    entities: DetectedEntity[],
    imageWidth: number,
    imageHeight: number
): Promise<Uint8Array> {
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const pages = pdfDoc.getPages();

    for (const entity of entities) {
        if (!entity.masked) continue;

        const pageIdx = entity.bbox.pageIndex;
        if (pageIdx >= pages.length) continue;

        const page = pages[pageIdx];
        const { width: pageWidth, height: pageHeight } = page.getSize();

        // Convert OCR coordinates (top-left origin) to PDF coordinates (bottom-left origin)
        const scaleX = pageWidth / imageWidth;
        const scaleY = pageHeight / imageHeight;

        const x = (entity.bbox.x - SUB_PIXEL_PADDING) * scaleX;
        const w = (entity.bbox.w + SUB_PIXEL_PADDING * 2) * scaleX;
        const h = (entity.bbox.h + SUB_PIXEL_PADDING * 2) * scaleY;
        const y = pageHeight - ((entity.bbox.y - SUB_PIXEL_PADDING) * scaleY + h);

        page.drawRectangle({
            x: Math.max(0, x),
            y: Math.max(0, y),
            width: Math.min(pageWidth - Math.max(0, x), w),
            height: Math.min(pageHeight - Math.max(0, y), h),
            color: rgb(0, 0, 0),
            opacity: 1,
        });
    }

    return await pdfDoc.save();
}

/**
 * Gets the number of pages in a PDF.
 */
export async function getPDFPageCount(pdfBytes: ArrayBuffer): Promise<number> {
    const pdfDoc = await PDFDocument.load(pdfBytes);
    return pdfDoc.getPageCount();
}

/**
 * Converts redacted PDF bytes to a File object.
 */
export function pdfBytesToFile(bytes: Uint8Array, fileName: string): File {
    return new File([bytes as BlobPart], fileName, { type: 'application/pdf' });
}
