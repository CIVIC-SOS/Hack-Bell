import type { DetectedEntity, OCRWord, NLPResponse } from '../types';
import { runLayer1Detection } from './layer1';
import { getGeminiForbiddenList, runGeminiDetection } from './gemini';
import { buildSpatialMap, calculateRedactionZones, zonesToEntities } from './matchingEngine';

/**
 * Unified Detection Pipeline — Semantic Redaction Mode
 *
 * Flow:
 * 1. Build spatial map from OCR words (coordinate-aware)
 * 2. Run Layer 1: deterministic regex + checksums (Aadhaar, PAN, CC, Phone)
 * 3. Run NLP Worker: local heuristic detection (names, addresses, medical, DOB, email)
 * 4. Run Gemini Semantic Filter (with retry): get "forbidden list"
 * 5. Run Matching Engine: link forbidden phrases to Tesseract word coordinates
 * 6. Merge all layers → Deduplicate → Filter by confidence
 * 7. Mark requiredFields as unmasked
 */
export async function runDetectionPipeline(
    fullText: string,
    words: OCRWord[],
    geminiApiKey: string,
    confidenceThreshold: number = 0.5,
    requiredFields: string[] = [],
    pageIndex: number = 0,
    onProgress?: (msg: string) => void
): Promise<DetectedEntity[]> {
    // Step 1: Build spatial map
    const spatialMap = buildSpatialMap(words, pageIndex);
    console.log(`[Pipeline] Spatial map: ${spatialMap.length} entries`);
    console.log(`[Pipeline] fullText length: ${fullText.length}, first 100 chars: "${fullText.substring(0, 100)}"`);

    // Step 2: Layer 1 — deterministic regex + checksums (fast, high confidence)
    onProgress?.('Running deterministic detection...');
    const layer1Entities = runLayer1Detection(fullText, words, pageIndex);
    console.log('[Pipeline] Layer 1 entities:', layer1Entities.length);

    // Step 3: NLP Worker — local heuristic detection (no API needed)
    onProgress?.('Running local NLP analysis...');
    let nlpEntities: DetectedEntity[] = [];
    try {
        nlpEntities = await runNLPWorker(words, pageIndex);
        console.log('[Pipeline] NLP heuristic entities:', nlpEntities.length);
    } catch (err) {
        console.warn('[Pipeline] NLP worker failed:', err);
    }

    // Step 4 & 5: Gemini Semantic Filter + Matching Engine (with retry)
    let matchingEngineEntities: DetectedEntity[] = [];

    if (geminiApiKey) {
        try {
            onProgress?.('Analyzing with Gemini AI...');

            // Get forbidden list from Gemini (with retry for rate limits)
            const forbiddenList = await withRetry(
                () => getGeminiForbiddenList(fullText, requiredFields, geminiApiKey, onProgress),
                2,       // max retries (reduced from 3)
                5000     // initial delay (5s, faster retry for better UX)
            );

            if (forbiddenList.length > 0 && spatialMap.length > 0) {
                onProgress?.('Calculating redaction zones...');
                const redactionZones = calculateRedactionZones(spatialMap, forbiddenList, requiredFields);
                matchingEngineEntities = zonesToEntities(redactionZones);
                console.log('[Pipeline] Matching engine zones:', matchingEngineEntities.length);
            }
        } catch (err) {
            console.warn('[Pipeline] Gemini semantic filter failed after retries:', err);

            // Fallback: try legacy entity-based Gemini detection
            try {
                const legacyEntities = await withRetry(
                    () => runGeminiDetection(fullText, words, geminiApiKey, pageIndex, onProgress),
                    1,
                    5000
                );
                matchingEngineEntities = legacyEntities;
                console.log('[Pipeline] Legacy Gemini entities:', matchingEngineEntities.length);
            } catch (err2) {
                console.warn('[Pipeline] All Gemini calls failed. Using Layer 1 + NLP only.');
            }
        }
    }

    // Step 6: Merge all results
    const allEntities = [...layer1Entities, ...nlpEntities, ...matchingEngineEntities];

    // Deduplicate overlapping detections
    const deduped = deduplicateEntities(allEntities);

    // Filter by confidence
    const filtered = deduped.filter(e => e.confidence >= confidenceThreshold);

    // Step 7: Mark required fields as unmasked
    for (const entity of filtered) {
        if (requiredFields.includes(entity.type)) {
            entity.masked = false;
        }
    }

    console.log(`[Pipeline] Final: ${filtered.length} entities (${filtered.filter(e => e.masked).length} masked, ${filtered.filter(e => !e.masked).length} visible)`);

    return filtered;
}

// ─── NLP Heuristic Worker ───────────────────────────────────────────────────

/**
 * Runs the local NLP heuristic worker (dictionary-based name/address/medical
 * detection). No API key needed — works entirely in the browser.
 */
function runNLPWorker(words: OCRWord[], pageIndex: number): Promise<DetectedEntity[]> {
    return new Promise((resolve, reject) => {
        const worker = new Worker(
            new URL('../workers/nlp.worker.ts', import.meta.url),
            { type: 'module' }
        );

        const timeout = setTimeout(() => {
            worker.terminate();
            reject(new Error('NLP worker timed out'));
        }, 10000);

        worker.onmessage = (e: MessageEvent<NLPResponse>) => {
            clearTimeout(timeout);
            worker.terminate();

            if (e.data.type === 'NLP_ERROR') {
                reject(new Error(e.data.error));
            } else if (e.data.type === 'NLP_RESULT') {
                resolve((e.data.entities ?? []) as DetectedEntity[]);
            }
        };

        worker.onerror = (err) => {
            clearTimeout(timeout);
            worker.terminate();
            reject(err);
        };

        worker.postMessage({
            type: 'NLP_ANALYZE',
            text: words.map(w => w.text).join(' '),
            words,
            pageIndex,
        });
    });
}

// ─── Retry Helper ───────────────────────────────────────────────────────────

/**
 * Retries a function on 429 rate-limit errors with exponential backoff.
 * Skips retries if quota is exhausted (RESOURCE_EXHAUSTED or daily limit reached).
 */
async function withRetry<T>(
    fn: () => Promise<T>,
    maxRetries: number,
    initialDelayMs: number
): Promise<T> {
    let lastError: Error | undefined;
    let delay = initialDelayMs;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
            const errorMsg = lastError.message.toLowerCase();

            // Skip retries if quota is exhausted or resource limit reached
            if (errorMsg.includes('resource_exhausted') ||
                errorMsg.includes('quota') ||
                errorMsg.includes('daily limit') ||
                errorMsg.includes('rate limit exceeded')) {
                console.warn('[Pipeline] Quota/resource exhausted, skipping retries');
                throw lastError;
            }

            // Only retry on 429 rate limit errors
            if (!errorMsg.includes('429') || attempt >= maxRetries) {
                throw lastError;
            }

            console.log(`[Pipeline] Rate limited, retrying in ${delay / 1000}s (attempt ${attempt + 1}/${maxRetries})...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            delay *= 1.5; // Exponential backoff
        }
    }

    throw lastError;
}

// ─── Deduplication ──────────────────────────────────────────────────────────

function deduplicateEntities(entities: DetectedEntity[]): DetectedEntity[] {
    const sorted = [...entities].sort((a, b) => b.confidence - a.confidence);
    const result: DetectedEntity[] = [];

    for (const entity of sorted) {
        const overlaps = result.some(existing =>
            existing.bbox.pageIndex === entity.bbox.pageIndex &&
            boxesOverlap(existing.bbox, entity.bbox, 0.5)
        );

        if (!overlaps) {
            result.push(entity);
        }
    }

    return result;
}

function boxesOverlap(
    a: DetectedEntity['bbox'],
    b: DetectedEntity['bbox'],
    threshold: number
): boolean {
    const overlapX = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const overlapY = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    const overlapArea = overlapX * overlapY;
    const minArea = Math.min(a.w * a.h, b.w * b.h);

    return minArea > 0 && overlapArea / minArea > threshold;
}
