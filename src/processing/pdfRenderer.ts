import * as pdfjsLib from 'pdfjs-dist';

// Configure the worker source for pdf.js
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
).toString();

/**
 * Renders a single PDF page to a canvas and returns it as a PNG ArrayBuffer.
 * This is needed because Tesseract.js cannot read PDF files directly.
 */
export async function renderPDFPageToImage(
    pdfBytes: ArrayBuffer,
    pageIndex: number = 0,
    scale: number = 2.0
): Promise<{ imageBuffer: ArrayBuffer; width: number; height: number; canvas: HTMLCanvasElement }> {
    const pdf = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
    const page = await pdf.getPage(pageIndex + 1); // pdf.js pages are 1-indexed

    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get canvas context');

    await page.render({ canvasContext: ctx, viewport, canvas }).promise;

    // Convert canvas to PNG blob, then to ArrayBuffer
    const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error('Failed to convert PDF page to image'))),
            'image/png'
        );
    });

    const imageBuffer = await blob.arrayBuffer();
    return { imageBuffer, width: viewport.width, height: viewport.height, canvas };
}

/**
 * Gets the total number of pages in a PDF document.
 */
export async function getPDFPageCount(pdfBytes: ArrayBuffer): Promise<number> {
    const pdf = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
    return pdf.numPages;
}
