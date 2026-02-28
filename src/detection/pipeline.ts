import type { DetectedEntity, OCRWord, NLPResponse } from '../types';
import { runLayer1Detection } from './layer1';
import { getGeminiForbiddenList, runGeminiDetection } from './gemini';
import { runWordIdPipeline } from './geminiWordId';
import { buildSpatialMap, calculateRedactionZones, zonesToEntities } from './matchingEngine';

/**
 * Unified Detection Pipeline — Semantic Redaction Mode
 *
 * Flow:
 * 1. Build spatial map from OCR words (coordinate-aware)
 * 2. Run Layer 1: deterministic regex + checksums (Aadhaar, PAN, CC, Phone)
 * 3. Run NLP Worker: local heuristic detection (names, addresses, medical, DOB, email)
 * 4. Run Gemini Word-ID Detection (PRIMARY): exact word-ID mapping for pixel-perfect bboxes
 *    ↳ Fallback A: Gemini Semantic Filter (forbidden list + matching engine)
 *    ↳ Fallback B: Legacy Gemini entity-based detection
 * 5. Merge all layers → Deduplicate → Filter by confidence
 * 6. Mark requiredFields as unmasked
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

    // Step 4: Gemini AI Detection (multi-strategy with fallbacks)
    let geminiEntities: DetectedEntity[] = [];

    if (geminiApiKey) {
        // PRIMARY: Word-ID based detection (pixel-perfect, highest accuracy)
        try {
            onProgress?.('Running Gemini word-ID detection...');
            const wordIdEntities = await withRetry(
                () => runWordIdPipeline(words, geminiApiKey, pageIndex, onProgress),
                2,
                5000
            );

            if (wordIdEntities.length > 0) {
                geminiEntities = wordIdEntities;
                console.log(`[Pipeline] Word-ID detection: ${geminiEntities.length} entities (pixel-perfect)`);
            }
        } catch (err) {
            console.warn('[Pipeline] Gemini word-ID detection failed:', err);
        }

        // FALLBACK A: Forbidden list + matching engine (if word-ID found nothing)
        if (geminiEntities.length === 0) {
            try {
                onProgress?.('Trying semantic filter fallback...');
                const forbiddenList = await withRetry(
                    () => getGeminiForbiddenList(fullText, requiredFields, geminiApiKey, onProgress),
                    2,
                    5000
                );

                if (forbiddenList.length > 0 && spatialMap.length > 0) {
                    onProgress?.('Calculating redaction zones...');
                    const redactionZones = calculateRedactionZones(spatialMap, forbiddenList, requiredFields);
                    geminiEntities = zonesToEntities(redactionZones);
                    console.log('[Pipeline] Semantic filter fallback:', geminiEntities.length, 'entities');
                }
            } catch (err) {
                console.warn('[Pipeline] Semantic filter fallback failed:', err);

                // FALLBACK B: Legacy entity-based Gemini detection
                try {
                    const legacyEntities = await withRetry(
                        () => runGeminiDetection(fullText, words, geminiApiKey, pageIndex, onProgress),
                        1,
                        5000
                    );
                    geminiEntities = legacyEntities;
                    console.log('[Pipeline] Legacy Gemini fallback:', geminiEntities.length, 'entities');
                } catch (err2) {
                    console.warn('[Pipeline] All Gemini strategies failed. Using Layer 1 + NLP only.');
                }
            }
        }
    }

    // Step 5: Merge all results
    const allEntities = [...layer1Entities, ...nlpEntities, ...geminiEntities];

    // Deduplicate overlapping detections
    const deduped = deduplicateEntities(allEntities);

    // Filter by confidence
    const filtered = deduped.filter(e => e.confidence >= confidenceThreshold);

    // Step 6: Mark required fields as unmasked
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
