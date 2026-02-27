// ─── Worker Message Types (self-contained for worker scope) ─────────────────

interface BBox {
    x: number;
    y: number;
    w: number;
    h: number;
    pageIndex: number;
}

interface OCRWordResult {
    text: string;
    confidence: number;
    bbox: BBox;
}

// ─── Image Preprocessing (Worker-optimized) ─────────────────────────────────

/**
 * Grayscale conversion using luminance formula
 */
function grayscale(data: Uint8ClampedArray): void {
    for (let i = 0; i < data.length; i += 4) {
        const gray = Math.round(
            0.299 * data[i] +     // R
            0.587 * data[i + 1] + // G
            0.114 * data[i + 2]   // B
        );
        data[i] = gray;
        data[i + 1] = gray;
        data[i + 2] = gray;
    }
}

/**
 * Histogram stretching for contrast enhancement
 */
function enhanceContrast(data: Uint8ClampedArray): void {
    let min = 255;
    let max = 0;

    for (let i = 0; i < data.length; i += 4) {
        const gray = data[i];
        if (gray < min) min = gray;
        if (gray > max) max = gray;
    }

    const range = max - min;
    if (range === 0) return;

    for (let i = 0; i < data.length; i += 4) {
        const stretched = Math.round(((data[i] - min) / range) * 255);
        data[i] = stretched;
        data[i + 1] = stretched;
        data[i + 2] = stretched;
    }
}

/**
 * Otsu's method for automatic thresholding
 */
function calculateOtsuThreshold(data: Uint8ClampedArray): number {
    const histogram = new Array(256).fill(0);
    const pixels = data.length / 4;

    for (let i = 0; i < data.length; i += 4) {
        histogram[data[i]]++;
    }

    let sum = 0;
    for (let i = 0; i < 256; i++) {
        sum += i * histogram[i];
    }

    let sumB = 0;
    let weightB = 0;
    let maxVariance = 0;
    let threshold = 0;

    for (let t = 0; t < 256; t++) {
        weightB += histogram[t];
        if (weightB === 0) continue;

        const weightF = pixels - weightB;
        if (weightF === 0) break;

        sumB += t * histogram[t];

        const meanB = sumB / weightB;
        const meanF = (sum - sumB) / weightF;

        const variance = weightB * weightF * (meanB - meanF) * (meanB - meanF);

        if (variance > maxVariance) {
            maxVariance = variance;
            threshold = t;
        }
    }

    return threshold;
}

/**
 * Binarization
 */
function binarize(data: Uint8ClampedArray, threshold: number): void {
    for (let i = 0; i < data.length; i += 4) {
        const binary = data[i] >= threshold ? 255 : 0;
        data[i] = binary;
        data[i + 1] = binary;
        data[i + 2] = binary;
    }
}

/**
 * Detects optimal PSM based on text density
 */
function detectLayoutPSM(data: Uint8ClampedArray, width: number, height: number): number {
    let nonWhitePixels = 0;
    const totalPixels = width * height;

    for (let i = 0; i < data.length; i += 4) {
        const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
        if (brightness < 240) nonWhitePixels++;
    }

    const density = nonWhitePixels / totalPixels;

    if (density < 0.20) return 11; // Sparse (forms/invoices)
    if (density > 0.50) return 6;  // Dense text blocks
    if (density > 0.30) return 4;  // Single column
    return 3; // Default auto
}

/**
 * Preprocesses image blob for better OCR accuracy
 * Uses createImageBitmap (worker-compatible, no DOM required)
 */
async function preprocessImage(blob: Blob): Promise<{ blob: Blob; psm: number }> {
    try {
        // createImageBitmap is available in workers (no DOM needed)
        const imageBitmap = await createImageBitmap(blob);
        
        const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });

        if (!ctx) {
            imageBitmap.close();
            return { blob, psm: 3 }; // Return original if context fails
        }

        ctx.drawImage(imageBitmap, 0, 0);
        const imageData = ctx.getImageData(0, 0, imageBitmap.width, imageBitmap.height);
        const data = imageData.data;

        // Preprocessing pipeline
        grayscale(data);
        enhanceContrast(data);

        // Detect PSM before binarization
        const psm = detectLayoutPSM(data, imageBitmap.width, imageBitmap.height);

        const threshold = calculateOtsuThreshold(data);
        binarize(data, threshold);

        ctx.putImageData(imageData, 0, 0);

        // Convert canvas to blob
        const processedBlob = await canvas.convertToBlob({ type: 'image/png' });
        
        // Clean up
        imageBitmap.close();

        return { blob: processedBlob, psm };
        
    } catch (err) {
        console.warn('[OCR Worker] Preprocessing failed, using original image:', err);
        return { blob, psm: 3 }; // Fallback to original
    }
}

// ─── Tesseract Worker ────────────────────────────────────────────────────────

let tesseractWorker: import('tesseract.js').Worker | null = null;

async function initTesseract(): Promise<import('tesseract.js').Worker> {
    if (tesseractWorker) return tesseractWorker;
    const Tesseract = await import('tesseract.js');
    tesseractWorker = await Tesseract.createWorker('eng', undefined, {
        logger: (m: { status: string; progress: number }) => {
            self.postMessage({
                type: 'OCR_PROGRESS',
                progress: m.progress,
                message: m.status,
            });
        },
    });
    return tesseractWorker;
}

self.onmessage = async (e: MessageEvent) => {
    const { type, fileBuffer, fileType, pageIndex } = e.data;

    if (type !== 'OCR_START') return;

    try {
        const worker = await initTesseract();

        let imageSource: Blob;
        if (fileType === 'application/pdf') {
            // For PDF, we receive an already-rendered image buffer
            imageSource = new Blob([fileBuffer], { type: 'image/png' });
        } else {
            imageSource = new Blob([fileBuffer], { type: fileType });
        }

        // Preprocess image for better OCR accuracy
        self.postMessage({
            type: 'OCR_PROGRESS',
            progress: 0.1,
            message: 'Preprocessing image...',
        });

        const { blob: processedBlob, psm } = await preprocessImage(imageSource);

        console.log(`[OCR Worker] Detected optimal PSM: ${psm}`);

        // Configure Tesseract with dynamic PSM
        await worker.setParameters({
            tessedit_pageseg_mode: psm.toString(),
        });

        const result = await worker.recognize(processedBlob, {}, { text: true, blocks: true });
        const words: OCRWordResult[] = [];

        // Tesseract.js v7 nests words in blocks → paragraphs → lines → words.
        // blocks are only populated when { blocks: true } is passed to recognize().
        const extractWord = (w: any) => {
            if (!w || !w.text || !w.bbox) return;
            words.push({
                text: w.text,
                confidence: (w.confidence ?? 0) / 100,
                bbox: {
                    x: w.bbox.x0,
                    y: w.bbox.y0,
                    w: w.bbox.x1 - w.bbox.x0,
                    h: w.bbox.y1 - w.bbox.y0,
                    pageIndex: pageIndex ?? 0,
                },
            });
        };

        if (result.data.blocks && result.data.blocks.length > 0) {
            for (const block of result.data.blocks) {
                for (const paragraph of (block.paragraphs ?? [])) {
                    for (const line of (paragraph.lines ?? [])) {
                        for (const word of (line.words ?? [])) {
                            extractWord(word);
                        }
                    }
                }
            }
        } else if ((result.data as any).words && (result.data as any).words.length > 0) {
            // Legacy v4 fallback
            for (const word of (result.data as any).words) {
                extractWord(word);
            }
        }

        console.log(`[OCR Worker] Extracted ${words.length} words from Tesseract`);

        // Use Tesseract's text if available, otherwise reconstruct from words
        let fullText = result.data.text ?? '';
        if (!fullText.trim() && words.length > 0) {
            fullText = words.map(w => w.text).join(' ');
            console.log('[OCR Worker] Reconstructed fullText from words');
        }
        console.log(`[OCR Worker] fullText length: ${fullText.length}`);

        self.postMessage({
            type: 'OCR_RESULT',
            words,
            fullText,
            pageIndex: pageIndex ?? 0,
        });
    } catch (error) {
        self.postMessage({
            type: 'OCR_ERROR',
            error: error instanceof Error ? error.message : 'OCR processing failed',
        });
    }
};
