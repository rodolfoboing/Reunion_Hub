import * as functions from 'firebase-functions';

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

export function requireStringField(data: unknown, field: string): string {
    if (!isRecord(data)) {
        throw new functions.https.HttpsError('invalid-argument', `${field} é obrigatório.`);
    }
    const rawValue = data[field];
    if (typeof rawValue !== 'string') {
        throw new functions.https.HttpsError('invalid-argument', `${field} é obrigatório.`);
    }
    const value = rawValue.trim();
    if (!value) throw new functions.https.HttpsError('invalid-argument', `${field} é inválido.`);
    return value;
}

export function isValidDocumentId(value: string, maxLength = 500): boolean {
    return value.length > 0
        && value.length <= maxLength
        && value !== '.'
        && value !== '..'
        && !value.includes('/');
}

export function requireDocumentIdValue(value: unknown, field: string, maxLength = 500): string {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!isValidDocumentId(normalized, maxLength)) {
        throw new functions.https.HttpsError('invalid-argument', `${field} é inválido.`);
    }
    return normalized;
}

export function requireDocumentIdField(data: unknown, field: string, maxLength = 500): string {
    if (!isRecord(data)) {
        throw new functions.https.HttpsError('invalid-argument', `${field} é obrigatório.`);
    }
    return requireDocumentIdValue(data[field], field, maxLength);
}

export function optionalDocumentIdField(data: unknown, field: string, maxLength = 500): string | null {
    if (!isRecord(data) || data[field] === undefined || data[field] === null || data[field] === '') return null;
    return requireDocumentIdValue(data[field], field, maxLength);
}

export function isValidCalendarDate(value: string): boolean {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (year < 1900 || year > 9999 || month < 1 || month > 12 || day < 1) return false;
    return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isValidClockTime(value: string): boolean {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}
