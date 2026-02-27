import React from 'react';
import { DOCUMENT_TYPES, type DocTypeConfig } from '../config/documentTypes';

interface DocTypeSelectorProps {
    selectedDocType: string | null;
    selectedFields: string[];
    onDocTypeChange: (docTypeId: string) => void;
    onFieldsChange: (fields: string[]) => void;
}

export const DocTypeSelector: React.FC<DocTypeSelectorProps> = ({
    selectedDocType,
    selectedFields,
    onDocTypeChange,
    onFieldsChange,
}) => {
    const activeConfig: DocTypeConfig | undefined =
        DOCUMENT_TYPES.find(d => d.id === selectedDocType);

    const handleFieldToggle = (fieldId: string) => {
        if (selectedFields.includes(fieldId)) {
            onFieldsChange(selectedFields.filter(f => f !== fieldId));
        } else {
            onFieldsChange([...selectedFields, fieldId]);
        }
    };

    const handleSelectAll = () => {
        if (!activeConfig) return;
        onFieldsChange(activeConfig.fields.map(f => f.id));
    };

    const handleDeselectAll = () => {
        onFieldsChange([]);
    };

    return (
        <div className="doc-selector">
            {/* Step 1: Document Type Radio Buttons */}
            <div className="doc-selector__section">
                <h3 className="doc-selector__heading">
                    <span className="doc-selector__step">1</span>
                    Select Document Type
                </h3>
                <div className="doc-selector__radio-group">
                    {DOCUMENT_TYPES.map(docType => (
                        <label
                            key={docType.id}
                            className={`doc-selector__radio-card ${selectedDocType === docType.id ? 'doc-selector__radio-card--active' : ''}`}
                        >
                            <input
                                type="radio"
                                name="docType"
                                value={docType.id}
                                checked={selectedDocType === docType.id}
                                onChange={() => {
                                    onDocTypeChange(docType.id);
                                    onFieldsChange([]); // Reset fields on doc type change
                                }}
                                className="doc-selector__radio-input"
                            />
                            <span className="doc-selector__radio-icon">{docType.icon}</span>
                            <span className="doc-selector__radio-label">{docType.label}</span>
                        </label>
                    ))}
                </div>
            </div>

            {/* Step 2: Field Checkboxes (shown only when doc type selected) */}
            {activeConfig && (
                <div className="doc-selector__section">
                    <h3 className="doc-selector__heading">
                        <span className="doc-selector__step">2</span>
                        Select Fields to Keep Visible
                    </h3>
                    <p className="doc-selector__hint">
                        Checked fields will remain <strong>visible</strong>. Everything else will be <strong>redacted</strong>.
                    </p>

                    <div className="doc-selector__actions">
                        <button
                            type="button"
                            className="doc-selector__action-btn"
                            onClick={handleSelectAll}
                        >
                            Select All
                        </button>
                        <button
                            type="button"
                            className="doc-selector__action-btn"
                            onClick={handleDeselectAll}
                        >
                            Deselect All
                        </button>
                    </div>

                    <div className="doc-selector__checkbox-grid">
                        {activeConfig.fields.map(field => (
                            <label
                                key={field.id}
                                className={`doc-selector__checkbox-card ${selectedFields.includes(field.id) ? 'doc-selector__checkbox-card--checked' : ''}`}
                            >
                                <input
                                    type="checkbox"
                                    checked={selectedFields.includes(field.id)}
                                    onChange={() => handleFieldToggle(field.id)}
                                    className="doc-selector__checkbox-input"
                                />
                                <div className="doc-selector__checkbox-content">
                                    <span className="doc-selector__checkbox-label">{field.label}</span>
                                    <span className="doc-selector__checkbox-desc">{field.description}</span>
                                </div>
                            </label>
                        ))}
                    </div>

                    {selectedFields.length === 0 && (
                        <div className="doc-selector__warning">
                            ⚠️ No fields selected — <strong>everything</strong> in the document will be redacted.
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
