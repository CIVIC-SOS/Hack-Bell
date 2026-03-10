import React, { useRef, useEffect, useState } from 'react';
import type { DetectedEntity, PIIType } from '../types';

interface ReviewModalProps {
    entities: DetectedEntity[];
    imageDataUrl: string | null;
    fileName: string;
    onConfirm: (entities: DetectedEntity[]) => void;
    onCancel: () => void;
    requiredFields: string[];
    confidenceThreshold: number;
}

const TYPE_LABELS: Record<PIIType, string> = {
    AADHAAR: 'Aadhaar Number',
    PAN: 'PAN',
    CREDIT_CARD: 'Credit Card',
    PHONE: 'Phone Number',
    NAME: 'Name',
    ADDRESS: 'Address',
    MEDICAL: 'Medical Information',
    EMAIL: 'Email Address',
    DOB: 'Date of Birth',
    ACCOUNT_NUMBER: 'Account Number',
    IFSC: 'IFSC Code',
    INVOICE_NO: 'Invoice Number',
    GST: 'GST Number',
    SENSITIVE: 'Sensitive Info',
};

const TYPE_COLORS: Record<PIIType, string> = {
    AADHAAR: '#ef4444',
    PAN: '#f97316',
    CREDIT_CARD: '#eab308',
    PHONE: '#22c55e',
    NAME: '#3b82f6',
    ADDRESS: '#8b5cf6',
    MEDICAL: '#ec4899',
    EMAIL: '#06b6d4',
    DOB: '#14b8a6',
    ACCOUNT_NUMBER: '#f59e0b',
    IFSC: '#10b981',
    INVOICE_NO: '#6366f1',
    GST: '#84cc16',
    SENSITIVE: '#6b7280',
};

export const ReviewModal: React.FC<ReviewModalProps> = ({
    entities,
    imageDataUrl,
    fileName,
    onConfirm,
    onCancel,
    requiredFields,
    confidenceThreshold,
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const imgRef = useRef<HTMLImageElement | null>(null);
    const [localEntities, setLocalEntities] = useState<DetectedEntity[]>(entities);
    const [scale, setScale] = useState(1);

    useEffect(() => {
        setLocalEntities(entities);
    }, [entities]);

    function drawBoundingBoxes(
        ctx: CanvasRenderingContext2D,
        ents: DetectedEntity[],
        s: number
    ) {
        for (const entity of ents) {
            const { x, y, w, h } = entity.bbox;
            const sx = x * s;
            const sy = y * s;
            const sw = w * s;
            const sh = h * s;

            const color = TYPE_COLORS[entity.type] || '#888';

            if (entity.masked) {
                // Show as redacted region
                ctx.fillStyle = color + '33';
                ctx.fillRect(sx, sy, sw, sh);
                ctx.strokeStyle = color;
                ctx.lineWidth = 2;
                ctx.strokeRect(sx, sy, sw, sh);

                // Diagonal lines to indicate masking
                ctx.beginPath();
                ctx.moveTo(sx, sy);
                ctx.lineTo(sx + sw, sy + sh);
                ctx.moveTo(sx + sw, sy);
                ctx.lineTo(sx, sy + sh);
                ctx.strokeStyle = color + '66';
                ctx.lineWidth = 1;
                ctx.stroke();
            } else {
                // Show as kept-visible (dashed border)
                ctx.strokeStyle = color;
                ctx.lineWidth = 2;
                ctx.setLineDash([4, 4]);
                ctx.strokeRect(sx, sy, sw, sh);
                ctx.setLineDash([]);
            }

            // Label
            const label = entity.type;
            ctx.font = `${Math.max(10, 11 * s)}px Inter, system-ui, sans-serif`;
            const metrics = ctx.measureText(label);
            const labelH = 16 * s;
            const labelY = sy - labelH;

            ctx.fillStyle = color;
            ctx.fillRect(sx, Math.max(0, labelY), metrics.width + 8 * s, labelH);
            ctx.fillStyle = '#ffffff';
            ctx.fillText(label, sx + 4 * s, Math.max(labelH - 4 * s, labelY + labelH - 4 * s));
        }
    }

    // Load image and set canvas dimensions (only when imageDataUrl changes)
    useEffect(() => {
        if (!imageDataUrl || !canvasRef.current) return;

        const canvas = canvasRef.current;
        const img = new Image();
        img.onload = () => {
            const containerWidth = canvas.parentElement?.clientWidth ?? 800;
            const s = Math.min(1, containerWidth / img.naturalWidth);
            canvas.width = img.naturalWidth * s;
            canvas.height = img.naturalHeight * s;
            imgRef.current = img;
            setScale(s);
        };
        img.src = imageDataUrl;
    }, [imageDataUrl]);

    // Redraw bounding boxes in real time when entities or scale changes
    useEffect(() => {
        const canvas = canvasRef.current;
        const img = imgRef.current;
        if (!canvas || !img || canvas.width === 0) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        drawBoundingBoxes(ctx, localEntities, scale);
    }, [localEntities, scale]);

    function toggleEntity(entityId: string) {
        setLocalEntities(prev =>
            prev.map(e => {
                if (e.id !== entityId) return e;
                // Don't allow unmasking required fields when they should stay visible
                if (requiredFields.includes(e.type) && e.masked) return e;
                return { ...e, masked: !e.masked };
            })
        );
    }

    const maskedCount = localEntities.filter(e => e.masked).length;
    const keptCount = localEntities.filter(e => !e.masked).length;

    return (
        <div className="su-modal-overlay" onClick={onCancel}>
            <div className="su-modal" onClick={e => e.stopPropagation()}>
                <div className="su-modal-header">
                    <div>
                        <h2 className="su-modal-title">Review Detected Information</h2>
                        <p className="su-modal-subtitle">{fileName}</p>
                    </div>
                    <button className="su-modal-close" onClick={onCancel} aria-label="Close">
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                            <path d="M5 5L15 15M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                    </button>
                </div>

                <div className="su-modal-body">
                    <div className="su-modal-preview">
                        <canvas ref={canvasRef} className="su-modal-canvas" />
                    </div>

                    <div className="su-modal-sidebar">
                        <div className="su-modal-stats">
                            <div className="su-modal-stat">
                                <span className="su-modal-stat-value">{maskedCount}</span>
                                <span className="su-modal-stat-label">Masked</span>
                            </div>
                            <div className="su-modal-stat">
                                <span className="su-modal-stat-value">{keptCount}</span>
                                <span className="su-modal-stat-label">Visible</span>
                            </div>
                        </div>

                        <div className="su-modal-entities">
                            <h3 className="su-modal-section-title">Detected Entities</h3>
                            {localEntities.length === 0 && (
                                <p className="su-modal-empty">No sensitive information detected.</p>
                            )}
                            {localEntities.map(entity => {
                                const isRequired = requiredFields.includes(entity.type);
                                const isLowConfidence = entity.confidence < confidenceThreshold + 0.15 && entity.confidence >= confidenceThreshold;

                                return (
                                    <div
                                        key={entity.id}
                                        className={`su-entity-card ${isLowConfidence ? 'su-entity-card--warning' : ''}`}
                                    >
                                        <div className="su-entity-header">
                                            <div className="su-entity-type" style={{ color: TYPE_COLORS[entity.type] }}>
                                                {TYPE_LABELS[entity.type] || entity.type}
                                            </div>
                                            <div className="su-entity-confidence">
                                                {Math.round(entity.confidence * 100)}%
                                            </div>
                                        </div>

                                        <div className="su-entity-value">
                                            {entity.masked ? maskValue(entity.value) : entity.value}
                                        </div>

                                        {isRequired && !entity.masked && (
                                            <div className="su-entity-required-badge">Required Field</div>
                                        )}

                                        {isLowConfidence && !isRequired && (
                                            <div className="su-entity-warning">
                                                Low confidence detection. Please verify this is correct.
                                            </div>
                                        )}

                                        <div className="su-entity-actions">
                                            <button
                                                className={`su-toggle ${entity.masked ? 'su-toggle--masked' : 'su-toggle--visible'}`}
                                                onClick={() => toggleEntity(entity.id)}
                                                disabled={isRequired && !entity.masked}
                                            >
                                                <span className="su-toggle-track">
                                                    <span className="su-toggle-thumb" />
                                                </span>
                                                <span className="su-toggle-label">
                                                    {entity.masked ? 'Masked' : 'Visible'}
                                                </span>
                                            </button>
                                        </div>

                                        {!entity.masked && !isRequired && (
                                            <div className="su-entity-liability">
                                                You are choosing to keep this {TYPE_LABELS[entity.type]?.toLowerCase() || 'information'} visible.
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                <div className="su-modal-footer">
                    <button className="su-btn su-btn--secondary" onClick={onCancel}>
                        Cancel
                    </button>
                    <button
                        className="su-btn su-btn--primary"
                        onClick={() => onConfirm(localEntities)}
                    >
                        Confirm and Redact ({maskedCount} items)
                    </button>
                </div>
            </div>
        </div>
    );
};

function maskValue(value: string): string {
    if (value.length <= 4) return '*'.repeat(value.length);
    return value.substring(0, 2) + '*'.repeat(value.length - 4) + value.substring(value.length - 2);
}
