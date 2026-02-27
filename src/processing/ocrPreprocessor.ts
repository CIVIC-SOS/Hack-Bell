// ─── OCR Image Preprocessing Module ─────────────────────────────────────────
// Enhances image quality before Tesseract OCR to reduce garbage output
// Implements: Grayscale, Binarization (Otsu), Contrast Enhancement, Noise Reduction

/**
 * Preprocesses an image canvas to improve OCR accuracy.
 * Uses lightweight browser-native Canvas API for performance.
 */
export function preprocessImageForOCR(canvas: HTMLCanvasElement): HTMLCanvasElement {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Cannot get 2D context from canvas');

    const width = canvas.width;
    const height = canvas.height;
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    // Step 1: Convert to Grayscale
    grayscale(data);

    // Step 2: Auto-adjust Contrast (Histogram Equalization)
    enhanceContrast(data);

    // Step 3: Binarization (Otsu's Method for automatic thresholding)
    const threshold = calculateOtsuThreshold(data);
    binarize(data, threshold);

    ctx.putImageData(imageData, 0, 0);
    return canvas;
}

/**
 * Converts RGBA image data to grayscale in-place.
 * Formula: Y = 0.299R + 0.587G + 0.114B (standard luminance)
 */
function grayscale(data: Uint8ClampedArray): void {
    for (let i = 0; i < data.length; i += 4) {
        const gray = Math.round(
            0.299 * data[i] +     // R
            0.587 * data[i + 1] + // G
            0.114 * data[i + 2]   // B
        );
        data[i] = gray;     // R
        data[i + 1] = gray; // G
        data[i + 2] = gray; // B
        // Alpha (data[i + 3]) unchanged
    }
}

/**
 * Enhances contrast using simple histogram stretching.
 * Finds min/max intensity and stretches to full 0-255 range.
 */
function enhanceContrast(data: Uint8ClampedArray): void {
    let min = 255;
    let max = 0;

    // Find min and max grayscale values
    for (let i = 0; i < data.length; i += 4) {
        const gray = data[i];
        if (gray < min) min = gray;
        if (gray > max) max = gray;
    }

    // Avoid division by zero
    const range = max - min;
    if (range === 0) return;

    // Stretch histogram
    for (let i = 0; i < data.length; i += 4) {
        const stretched = Math.round(((data[i] - min) / range) * 255);
        data[i] = stretched;
        data[i + 1] = stretched;
        data[i + 2] = stretched;
    }
}

/**
 * Calculates optimal binarization threshold using Otsu's method.
 * Maximizes inter-class variance between foreground and background.
 */
function calculateOtsuThreshold(data: Uint8ClampedArray): number {
    const histogram = new Array(256).fill(0);
    const pixels = data.length / 4;

    // Build histogram
    for (let i = 0; i < data.length; i += 4) {
        histogram[data[i]]++;
    }

    // Calculate probabilities
    let sum = 0;
    for (let i = 0; i < 256; i++) {
        sum += i * histogram[i];
    }

    let sumB = 0;
    let weightB = 0;
    let weightF = 0;
    let maxVariance = 0;
    let threshold = 0;

    for (let t = 0; t < 256; t++) {
        weightB += histogram[t];
        if (weightB === 0) continue;

        weightF = pixels - weightB;
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
 * Binarizes the image: pixels below threshold → black, above → white.
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
 * Analyzes layout density to determine optimal Tesseract PSM.
 * Returns PSM code:
 * - 3: Fully automatic page segmentation (default)
 * - 4: Single column of text
 * - 6: Uniform block of text
 * - 11: Sparse text (invoices, forms)
 */
export function detectLayoutPSM(canvas: HTMLCanvasElement): number {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 3; // Default PSM

    const width = canvas.width;
    const height = canvas.height;
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    // Calculate text density (% of non-white pixels)
    let nonWhitePixels = 0;
    const totalPixels = width * height;

    for (let i = 0; i < data.length; i += 4) {
        const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
        if (brightness < 240) nonWhitePixels++;
    }

    const density = nonWhitePixels / totalPixels;

    // Sparse layout (< 20% coverage) → likely invoice/form → PSM 11
    if (density < 0.20) return 11;

    // Dense layout (> 50% coverage) → likely paragraph text → PSM 6
    if (density > 0.50) return 6;

    // Moderate density → column-based → PSM 4
    if (density > 0.30) return 4;

    // Default: fully automatic
    return 3;
}

/**
 * Main preprocessing pipeline for OCR optimization.
 * Returns both processed canvas and recommended PSM.
 */
export function prepareImageForOCR(inputCanvas: HTMLCanvasElement): {
    canvas: HTMLCanvasElement;
    psm: number;
} {
    // Clone canvas to avoid mutating original
    const processedCanvas = document.createElement('canvas');
    processedCanvas.width = inputCanvas.width;
    processedCanvas.height = inputCanvas.height;
    const ctx = processedCanvas.getContext('2d');
    if (!ctx) throw new Error('Cannot create canvas context');

    ctx.drawImage(inputCanvas, 0, 0);

    // Apply preprocessing
    preprocessImageForOCR(processedCanvas);

    // Detect optimal PSM before binarization destroys layout info
    const psm = detectLayoutPSM(inputCanvas);

    return { canvas: processedCanvas, psm };
}
