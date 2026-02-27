// ─── Confidence Fusion Engine ────────────────────────────────────────────────
// Merges detections from multiple sources with intelligent scoring:
// - Layer 0 (Deterministic Regex):  100% confidence (Emails, PAN, Aadhaar, SSN, Credit Cards)
// - Layer 1 (Spatial Key-Value):    95-99% confidence (context-based detection)
// - Layer 2 (NLP Heuristic):        60-90% confidence (dictionary matching)
// - Layer 3 (ML/Gemini):            50-95% confidence (probabilistic)
//
// Resolves conflicts, deduplicates overlapping detections, and outputs final entities

import type { DetectedEntity } from '../types';
import type { DocumentType } from './documentRouter';

export interface FusionConfig {
    documentType: DocumentType;
    confidenceThreshold: number;
    preferSpatialOverNLP: boolean;
    deduplicationOverlapThreshold: number; // 0-1, IoU threshold
}

export interface FusionResult {
    entities: DetectedEntity[];
    stats: {
        total: number;
        byLayer: Record<number, number>;
        byConfidenceRange: { low: number; medium: number; high: number };
        deduplicated: number;
    };
}

// ─── Scoring System ──────────────────────────────────────────────────────────

/**
 * Assigns layer-based confidence scores to entities.
 * Layer 0 (Regex):    100%
 * Layer 1 (Spatial):  95-99%
 * Layer 2 (NLP):      60-90%
 * Layer 3 (ML):       50-95%
 */
export function normalizeConfidenceByLayer(entity: DetectedEntity): DetectedEntity {
    let baseConfidence = entity.confidence;

    switch (entity.layer) {
        case 0: // Deterministic regex
            baseConfidence = 1.0;
            break;
        case 1: // Enhanced regex with context
            baseConfidence = Math.max(baseConfidence, 0.95);
            break;
        case 2: // NLP heuristic
            baseConfidence = Math.min(Math.max(baseConfidence, 0.60), 0.90);
            break;
        case 3: // Spatial key-value
            baseConfidence = Math.min(Math.max(baseConfidence, 0.95), 0.99);
            break;
        case 4: // ML/Gemini
            baseConfidence = Math.min(Math.max(baseConfidence, 0.50), 0.95);
            break;
        default:
            baseConfidence = Math.max(baseConfidence, 0.50);
    }

    return {
        ...entity,
        confidence: baseConfidence,
    };
}

// ─── Deduplication ──────────────────────────────────────────────────────────

/**
 * Calculates Intersection over Union (IoU) for two bounding boxes.
 */
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

/**
 * Deduplicates overlapping entities using Non-Maximum Suppression (NMS).
 * Priority:
 * 1. Higher layer (spatial > regex > NLP)
 * 2. Higher confidence
 * 3. Longer text (more specific)
 */
export function deduplicateEntities(
    entities: DetectedEntity[],
    iouThreshold: number = 0.5
): { deduplicated: DetectedEntity[]; removedCount: number } {
    // Sort by priority: layer DESC, confidence DESC, value length DESC
    const sorted = [...entities].sort((a, b) => {
        if (a.layer !== b.layer) return b.layer - a.layer; // Higher layer first
        if (Math.abs(a.confidence - b.confidence) > 0.01) {
            return b.confidence - a.confidence; // Higher confidence first
        }
        return b.value.length - a.value.length; // Longer text first
    });

    const kept: DetectedEntity[] = [];
    const removed: DetectedEntity[] = [];

    for (const entity of sorted) {
        let shouldKeep = true;

        for (const existing of kept) {
            const iou = calculateIoU(entity.bbox, existing.bbox);

            if (iou > iouThreshold) {
                // Overlaps with higher-priority entity
                shouldKeep = false;
                removed.push(entity);
                break;
            }
        }

        if (shouldKeep) {
            kept.push(entity);
        }
    }

    return {
        deduplicated: kept,
        removedCount: removed.length,
    };
}

// ─── Fusion Engine ──────────────────────────────────────────────────────────

export class FusionEngine {
    private config: FusionConfig;

    constructor(config: FusionConfig) {
        this.config = config;
    }

    /**
     * Main fusion method: combines detections from all sources.
     */
    fuse(
        regexEntities: DetectedEntity[],
        spatialEntities: DetectedEntity[],
        nlpEntities: DetectedEntity[],
        mlEntities: DetectedEntity[]
    ): FusionResult {
        // Step 1: Normalize confidence scores by layer
        const normalizedRegex = regexEntities.map(normalizeConfidenceByLayer);
        const normalizedSpatial = spatialEntities.map(normalizeConfidenceByLayer);
        const normalizedNLP = nlpEntities.map(normalizeConfidenceByLayer);
        const normalizedML = mlEntities.map(normalizeConfidenceByLayer);

        // Step 2: Combine all entities
        let combined = [
            ...normalizedRegex,
            ...normalizedSpatial,
            ...normalizedNLP,
            ...normalizedML,
        ];

        console.log(`[FusionEngine] Combined ${combined.length} entities from all sources`);
        console.log(`[FusionEngine] - Regex: ${normalizedRegex.length}`);
        console.log(`[FusionEngine] - Spatial: ${normalizedSpatial.length}`);
        console.log(`[FusionEngine] - NLP: ${normalizedNLP.length}`);
        console.log(`[FusionEngine] - ML/Gemini: ${normalizedML.length}`);

        // Step 3: Deduplicate overlapping detections
        const { deduplicated, removedCount } = deduplicateEntities(
            combined,
            this.config.deduplicationOverlapThreshold
        );

        console.log(`[FusionEngine] Deduplicated: removed ${removedCount}, kept ${deduplicated.length}`);

        // Step 4: Filter by confidence threshold
        const filtered = deduplicated.filter(
            e => e.confidence >= this.config.confidenceThreshold
        );

        console.log(`[FusionEngine] After confidence filter (>=${this.config.confidenceThreshold}): ${filtered.length}`);

        // Step 5: Generate statistics
        const stats = this.generateStats(filtered, removedCount);

        return {
            entities: filtered,
            stats,
        };
    }

    /**
     * Generates statistics about the fused entities.
     */
    private generateStats(
        entities: DetectedEntity[],
        removedCount: number
    ): FusionResult['stats'] {
        const byLayer: Record<number, number> = {};
        let low = 0;
        let medium = 0;
        let high = 0;

        for (const entity of entities) {
            // By layer
            byLayer[entity.layer] = (byLayer[entity.layer] || 0) + 1;

            // By confidence range
            if (entity.confidence < 0.7) low++;
            else if (entity.confidence < 0.9) medium++;
            else high++;
        }

        return {
            total: entities.length,
            byLayer,
            byConfidenceRange: { low, medium, high },
            deduplicated: removedCount,
        };
    }

    /**
     * Applies document-specific confidence boost.
     */
    applyDocumentTypeBoost(entities: DetectedEntity[]): DetectedEntity[] {
        const boost = this.getConfidenceBoost();
        if (boost === 1.0) return entities;

        return entities.map(e => ({
            ...e,
            confidence: Math.min(e.confidence * boost, 1.0),
        }));
    }

    private getConfidenceBoost(): number {
        switch (this.config.documentType) {
            case 'invoice':
                return 1.2;
            case 'bank_statement':
                return 1.3;
            case 'id_card_aadhaar':
            case 'id_card_pan':
                return 1.25;
            case 'tax_return':
                return 1.15;
            default:
                return 1.0;
        }
    }
}

// ─── Conflict Resolution ────────────────────────────────────────────────────

/**
 * Resolves type conflicts when same region has multiple PII type candidates.
 * Strategy: Prefer deterministic > spatial > ML > NLP
 */
export function resolveTypeConflicts(entities: DetectedEntity[]): DetectedEntity[] {
    const groups = new Map<string, DetectedEntity[]>();

    // Group by bounding box hash
    for (const entity of entities) {
        const key = `${entity.bbox.pageIndex}_${entity.bbox.x}_${entity.bbox.y}_${entity.bbox.w}_${entity.bbox.h}`;
        if (!groups.has(key)) {
            groups.set(key, []);
        }
        groups.get(key)!.push(entity);
    }

    const resolved: DetectedEntity[] = [];

    for (const group of groups.values()) {
        if (group.length === 1) {
            resolved.push(group[0]);
            continue;
        }

        // Multiple entities for same bbox - pick best one
        const sorted = group.sort((a, b) => {
            // Prefer higher layer
            if (a.layer !== b.layer) return b.layer - a.layer;
            // Then higher confidence
            return b.confidence - a.confidence;
        });

        resolved.push(sorted[0]);
    }

    return resolved;
}

// ─── Memory Management ──────────────────────────────────────────────────────

/**
 * Cleans up large intermediate data structures to prevent memory leaks.
 * Call this after fusion is complete.
 */
export function cleanupIntermediateData(
    ...arrays: Array<DetectedEntity[] | null | undefined>
): void {
    for (const arr of arrays) {
        if (arr) {
            arr.length = 0; // Clear array without deallocating
        }
    }
}
