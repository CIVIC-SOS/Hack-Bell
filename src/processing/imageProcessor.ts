import type { DetectedEntity } from '../types';

const SUB_PIXEL_PADDING = 5; // Extra padding to cover letter descenders/ascenders and prevent ghosting

/**
 * Renders an image onto a canvas, applies redaction, and returns the result.
 */
export async function processImage(
    fileBuffer: ArrayBuffer,
    fileType: string
): Promise<{ canvas: HTMLCanvasElement; width: number; height: number }> {
    const blob = new Blob([fileBuffer], { type: fileType });
    const url = URL.createObjectURL(blob);

    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                reject(new Error('Could not get canvas 2D context'));
                return;
            }
            ctx.drawImage(img, 0, 0);
            URL.revokeObjectURL(url);
            resolve({ canvas, width: img.naturalWidth, height: img.naturalHeight });
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Failed to load image'));
        };
        img.src = url;
    });
}

/**
 * Applies destructive redaction to a canvas by drawing black rectangles
 * over detected entities. Uses sub-pixel padding to ensure no "tails"
 * of descending letters (g, y, p, q, j) remain visible.
 */
export function redactImageRegions(
    canvas: HTMLCanvasElement,
    entities: DetectedEntity[]
): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const maskedEntities = entities.filter(e => e.masked);

    for (const entity of maskedEntities) {
        const { x, y, w, h } = entity.bbox;

        // Apply sub-pixel padding to cover descenders and ascenders
        const px = Math.max(0, x - SUB_PIXEL_PADDING);
        const py = Math.max(0, y - SUB_PIXEL_PADDING);
        const pw = Math.min(canvas.width - px, w + SUB_PIXEL_PADDING * 2);
        const ph = Math.min(canvas.height - py, h + SUB_PIXEL_PADDING * 2);

        // Destructive redaction: overwrite pixels with black
        ctx.fillStyle = '#000000';
        ctx.fillRect(px, py, pw, ph);
    }
}

/**
 * Exports a canvas as a File object.
 */
export async function canvasToFile(
    canvas: HTMLCanvasElement,
    fileName: string,
    mimeType: string = 'image/png'
): Promise<File> {
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => {
                if (!blob) {
                    reject(new Error('Failed to export canvas'));
                    return;
                }
                resolve(new File([blob], fileName, { type: mimeType }));
            },
            mimeType,
            0.95
        );
    });
}
