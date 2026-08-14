"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isValidClockTime = exports.isValidCalendarDate = exports.optionalDocumentIdField = exports.requireDocumentIdField = exports.requireDocumentIdValue = exports.isValidDocumentId = exports.requireStringField = exports.isRecord = void 0;
const functions = require("firebase-functions");
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
exports.isRecord = isRecord;
function requireStringField(data, field) {
    if (!isRecord(data)) {
        throw new functions.https.HttpsError('invalid-argument', `${field} é obrigatório.`);
    }
    const rawValue = data[field];
    if (typeof rawValue !== 'string') {
        throw new functions.https.HttpsError('invalid-argument', `${field} é obrigatório.`);
    }
    const value = rawValue.trim();
    if (!value)
        throw new functions.https.HttpsError('invalid-argument', `${field} é inválido.`);
    return value;
}
exports.requireStringField = requireStringField;
function isValidDocumentId(value, maxLength = 500) {
    return value.length > 0
        && value.length <= maxLength
        && value !== '.'
        && value !== '..'
        && !value.includes('/');
}
exports.isValidDocumentId = isValidDocumentId;
function requireDocumentIdValue(value, field, maxLength = 500) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!isValidDocumentId(normalized, maxLength)) {
        throw new functions.https.HttpsError('invalid-argument', `${field} é inválido.`);
    }
    return normalized;
}
exports.requireDocumentIdValue = requireDocumentIdValue;
function requireDocumentIdField(data, field, maxLength = 500) {
    if (!isRecord(data)) {
        throw new functions.https.HttpsError('invalid-argument', `${field} é obrigatório.`);
    }
    return requireDocumentIdValue(data[field], field, maxLength);
}
exports.requireDocumentIdField = requireDocumentIdField;
function optionalDocumentIdField(data, field, maxLength = 500) {
    if (!isRecord(data) || data[field] === undefined || data[field] === null || data[field] === '')
        return null;
    return requireDocumentIdValue(data[field], field, maxLength);
}
exports.optionalDocumentIdField = optionalDocumentIdField;
function isValidCalendarDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match)
        return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (year < 1900 || year > 9999 || month < 1 || month > 12 || day < 1)
        return false;
    return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}
exports.isValidCalendarDate = isValidCalendarDate;
function isValidClockTime(value) {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}
exports.isValidClockTime = isValidClockTime;
//# sourceMappingURL=validation.js.map