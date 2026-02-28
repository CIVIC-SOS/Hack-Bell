// ─── Enhanced Detection Pipeline with Multi-Stage Architecture ─────────────
// Integrates: Advanced Worker → Spatial Mapping → Fusion → Gemini Fallback
//
// New Architecture:
// 1. Advanced Worker (Document Router + Spatial + Regex + NLP)
// 2. Gemini Semantic Filter (optional enhancement)
// 3. Confidence Fusion Engine
// 4. Final Deduplication & Filtering

import type { DetectedEntity, OCRWord } from '../types';
import { getGeminiForbiddenList } from './gemini';
import { runWordIdPipeline } from './geminiWordId';
import { buildSpatialMap, calculateRedactionZones, zonesToEntities } from './matchingEngine';
import { WorkerPool } from '../workers/WorkerPool';

export interface EnhancedPipelineConfig {
    fullText: string;
    words: OCRWord[];
    geminiApiKey: string;
    confidenceThreshold: number;
    requiredFields: string[];
    pageIndex: number;
    onProgress?: (msg: string) => void;
    enableGemini?: boolean; // Optional Gemini enhancement
}

/**
 * Enhanced Multi-Stage Detection Pipeline
 * 
 * Architecture:
 * Stage 1: Advanced Worker (fast, browser-side)
 *   - Document Router classifies document type
 *   - Spatial Mapper detects key-value pairs (95-99% confidence)
 *   - Regex Layer detects deterministic patterns (100% confidence)  
 *   - NLP heuristics for names/addresses (60-90% confidence)
 *   - Fusion Engine merges with deduplication
 * 
 * Stage 2: Gemini Word-ID Detection (PRIMARY, API-based)
 *   - Sends OCR tokens with IDs to Gemini
 *   - Returns exact word IDs for pixel-perfect bounding boxes
 *   - Highest accuracy: no fuzzy matching needed
 * 
 * Stage 3: Gemini Semantic Filter (FALLBACK, API-based)
 *   - Catches edge cases if word-ID detection fails
 *   - Uses forbidden-list + spatial matching approach
 * 
 * Stage 4: Final Processing
 *   - Merge all results with deduplication
 *   - Apply required fields masking
 */
export async function runEnhancedDetectionPipeline(
    config: EnhancedPipelineConfig
): Promise<DetectedEntity[]> {
    const {
        fullText,
        words,
        geminiApiKey,
        confidenceThreshold,
        requiredFields,
        pageIndex,
        onProgress,
        enableGemini = true,
    } = config;

    console.log(`[Enhanced Pipeline] Starting with ${words.length} words, ${fullText.length} chars`);
    console.log(`[Enhanced Pipeline] Gemini enabled: ${enableGemini}`);

    // ────────────────────────────────────────────────────────────────────────
    // STAGE 1: Advanced Worker Detection
    // ────────────────────────────────────────────────────────────────────────

    onProgress?.('Running advanced detection...');

    const workerPool = new WorkerPool();
    let advancedEntities: DetectedEntity[] = [];
    let documentType = 'generic';
    let workerStats: any = {};

    try {
        const workerResult = await workerPool.runAdvancedDetection(
            fullText,
            words,
            pageIndex,
            confidenceThreshold
        );

        advancedEntities = workerResult.entities;
        documentType = workerResult.documentType;
        workerStats = workerResult.stats;

        console.log(`[Enhanced Pipeline] Advanced worker detected ${advancedEntities.length} entities`);
        console.log(`[Enhanced Pipeline] Document type: ${documentType}`);
        console.log(`[Enhanced Pipeline] Stats:`, workerStats);

    } catch (err) {
        console.warn('[Enhanced Pipeline] Advanced worker failed:', err);
        // Continue with empty array - Gemini can still catch entities
    }

    // ────────────────────────────────────────────────────────────────────────
    // STAGE 2: Gemini Word-ID Detection (PRIMARY — pixel-perfect)
    // ────────────────────────────────────────────────────────────────────────

    let geminiEntities: DetectedEntity[] = [];

    if (enableGemini && geminiApiKey) {
        // Try word-ID detection first (highest accuracy)
        try {
            onProgress?.('Running Gemini word-ID detection...');
            const wordIdEntities = await runWordIdPipeline(
                words,
                geminiApiKey,
                pageIndex,
                onProgress
            );

            if (wordIdEntities.length > 0) {
                geminiEntities = wordIdEntities;
                console.log(`[Enhanced Pipeline] Word-ID detection: ${geminiEntities.length} entities (pixel-perfect)`);
            }
        } catch (err) {
            console.warn('[Enhanced Pipeline] Word-ID detection failed:', err);
        }

        // ────────────────────────────────────────────────────────────────────
        // STAGE 3: Gemini Semantic Filter (FALLBACK — if word-ID found nothing)
        // ────────────────────────────────────────────────────────────────────

        if (geminiEntities.length === 0) {
            try {
                onProgress?.('Trying semantic filter fallback...');

                // Build spatial map for matching
                const spatialMap = buildSpatialMap(words, pageIndex);

                // Get forbidden list from Gemini
                const forbiddenList = await getGeminiForbiddenList(
                    fullText,
                    requiredFields,
                    geminiApiKey,
                    onProgress
                );

                if (forbiddenList.length > 0 && spatialMap.length > 0) {
                    onProgress?.('Calculating redaction zones...');
                    const redactionZones = calculateRedactionZones(
                        spatialMap,
                        forbiddenList,
                        requiredFields
                    );
                    geminiEntities = zonesToEntities(redactionZones);
                    console.log(`[Enhanced Pipeline] Semantic filter fallback: ${geminiEntities.length} entities`);
                }
            } catch (err) {
                console.warn('[Enhanced Pipeline] Semantic filter fallback failed:', err);
                // Continue without Gemini - local detection is still valuable
            }
        }
    }

    // ────────────────────────────────────────────────────────────────────────
    // STAGE 4: Merge & Final Deduplication
    // ────────────────────────────────────────────────────────────────────────

    onProgress?.('Finalizing detections...');

    // Combine all entities
    const allEntities = [...advancedEntities, ...geminiEntities];

    // Deduplicate (prefer higher confidence)
    const deduped = deduplicateEntitiesFinal(allEntities);

    // Apply required fields masking
    for (const entity of deduped) {
        if (requiredFields.includes(entity.type)) {
            entity.masked = false;
        }
    }

    console.log(`[Enhanced Pipeline] Final: ${deduped.length} entities (${deduped.filter(e => e.masked).length} masked)`);

    // Cleanup
    workerPool.terminate();

    return deduped;
}

/**
 * Final deduplication with IoU-based overlap detection
 */
function deduplicateEntitiesFinal(entities: DetectedEntity[]): DetectedEntity[] {
    // Sort by priority: layer DESC, confidence DESC
    const sorted = [...entities].sort((a, b) => {
        if (a.layer !== b.layer) return b.layer - a.layer;
        return b.confidence - a.confidence;
    });

    const kept: DetectedEntity[] = [];

    for (const entity of sorted) {
        let shouldKeep = true;

        for (const existing of kept) {
            const iou = calculateIoU(entity.bbox, existing.bbox);

            if (iou > 0.5) {
                shouldKeep = false;
                break;
            }
        }

        if (shouldKeep) {
            kept.push(entity);
        }
    }

    return kept;
}

function calculateIoU(
    a: DetectedEntity['bbox'],
    b: DetectedEntity['bbox']
): number {
    if (a.pageIndex !== b.pageIndex) return 0;

    const xOverlap = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const yOverlap = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    const intersection = xOverlap * yOverlap;

    const areaA = a.w * a.h;
    const areaB = b.w * b.h;
    const union = areaA + areaB - intersection;

    return union > 0 ? intersection / union : 0;
}
