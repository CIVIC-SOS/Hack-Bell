// ─── Document Type Configuration ────────────────────────────────────────────
// Defines the fields present in each document type.
// Users select a document type, then choose which fields to KEEP VISIBLE.
// Everything else gets redacted.

export interface DocField {
    id: string;
    label: string;
    description: string;
}

export interface DocTypeConfig {
    id: string;
    label: string;
    icon: string;
    fields: DocField[];
}

export const DOCUMENT_TYPES: DocTypeConfig[] = [
    {
        id: 'aadhaar',
        label: 'Aadhaar Card',
        icon: '🪪',
        fields: [
            { id: 'NAME', label: 'Name', description: 'Full name of the cardholder' },
            { id: 'ADDRESS', label: 'Address', description: 'Residential address' },
            { id: 'DOB', label: 'Date of Birth', description: 'Birth date' },
            { id: 'AADHAAR', label: 'Aadhaar Number', description: '12-digit UID number' },
            { id: 'PHONE', label: 'Phone Number', description: 'Registered mobile number' },
            { id: 'GENDER', label: 'Gender', description: 'Male/Female/Other' },
            { id: 'PHOTO', label: 'Photo', description: 'Passport-size photograph' },
            { id: 'QR_CODE', label: 'QR Code', description: 'Machine-readable QR code' },
        ],
    },
    {
        id: 'pan',
        label: 'PAN Card',
        icon: '💳',
        fields: [
            { id: 'NAME', label: 'Name', description: 'Name of the cardholder' },
            { id: 'FATHER_NAME', label: "Father's Name", description: "Father's full name" },
            { id: 'DOB', label: 'Date of Birth', description: 'Birth date' },
            { id: 'PAN', label: 'PAN Number', description: '10-character alphanumeric PAN' },
            { id: 'PHOTO', label: 'Photo', description: 'Photograph on the card' },
            { id: 'SIGNATURE', label: 'Signature', description: 'Cardholder signature' },
        ],
    },
    {
        id: 'health_report',
        label: 'Health Report',
        icon: '🏥',
        fields: [
            { id: 'NAME', label: 'Patient Name', description: 'Name of the patient' },
            { id: 'AGE', label: 'Age', description: 'Patient age' },
            { id: 'DOB', label: 'Date of Birth', description: 'Birth date' },
            { id: 'DOCTOR', label: 'Doctor Name', description: 'Attending physician' },
            { id: 'HOSPITAL', label: 'Hospital/Clinic', description: 'Institution name' },
            { id: 'DIAGNOSIS', label: 'Diagnosis', description: 'Medical diagnosis' },
            { id: 'MEDICAL', label: 'Medications', description: 'Prescribed medications' },
            { id: 'TEST_RESULTS', label: 'Test Results', description: 'Lab test values' },
            { id: 'BLOOD_GROUP', label: 'Blood Group', description: 'Patient blood group' },
        ],
    },
    {
        id: 'income_tax',
        label: 'Income Tax Return',
        icon: '📊',
        fields: [
            { id: 'NAME', label: 'Name', description: 'Taxpayer name' },
            { id: 'PAN', label: 'PAN Number', description: 'PAN of the taxpayer' },
            { id: 'ADDRESS', label: 'Address', description: 'Taxpayer address' },
            { id: 'INCOME', label: 'Income Details', description: 'Gross/net income' },
            { id: 'TAX_AMOUNT', label: 'Tax Amount', description: 'Tax payable/refund' },
            { id: 'ASSESSMENT_YEAR', label: 'Assessment Year', description: 'Tax assessment year' },
            { id: 'TAN', label: 'TAN', description: 'Tax deduction account number' },
            { id: 'EMPLOYER', label: 'Employer', description: 'Employer name' },
        ],
    },
    {
        id: 'invoice',
        label: 'Invoice',
        icon: '🧾',
        fields: [
            { id: 'COMPANY', label: 'Company Name', description: 'Issuing company' },
            { id: 'CUSTOMER', label: 'Customer Name', description: 'Bill-to customer' },
            { id: 'ADDRESS', label: 'Address', description: 'Billing/shipping address' },
            { id: 'INVOICE_NO', label: 'Invoice Number', description: 'Unique invoice ID' },
            { id: 'DATE', label: 'Date', description: 'Invoice date' },
            { id: 'AMOUNT', label: 'Amount', description: 'Total amount/subtotals' },
            { id: 'GST', label: 'GST Number', description: 'GSTIN of the company' },
            { id: 'ITEMS', label: 'Line Items', description: 'Product/service details' },
            { id: 'BANK', label: 'Bank Details', description: 'Payment bank account info' },
        ],
    },
    {
        id: 'bank_statement',
        label: 'Bank Statement',
        icon: '🏦',
        fields: [
            { id: 'NAME', label: 'Account Holder Name', description: 'Name on the account' },
            { id: 'ACCOUNT_NO', label: 'Account Number', description: 'Bank account number' },
            { id: 'IFSC', label: 'IFSC Code', description: 'Bank branch IFSC code' },
            { id: 'ADDRESS', label: 'Address', description: 'Account holder address' },
            { id: 'TRANSACTIONS', label: 'Transaction Details', description: 'Transaction history' },
            { id: 'BALANCE', label: 'Account Balance', description: 'Opening/closing balance' },
            { id: 'BANK_NAME', label: 'Bank Name', description: 'Name of the bank' },
            { id: 'BRANCH', label: 'Branch', description: 'Branch name/address' },
            { id: 'DATE', label: 'Statement Date', description: 'Statement period dates' },
        ],
    },
];
