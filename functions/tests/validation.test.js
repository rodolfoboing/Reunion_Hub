const test = require('node:test');
const assert = require('node:assert/strict');
const { isValidCalendarDate, isValidDocumentId } = require('../lib/validation');

test('isValidCalendarDate accepts real calendar dates', () => {
    assert.equal(isValidCalendarDate('2028-02-29'), true);
    assert.equal(isValidCalendarDate('2026-12-31'), true);
});

test('isValidCalendarDate rejects normalized or malformed dates', () => {
    assert.equal(isValidCalendarDate('2026-02-29'), false);
    assert.equal(isValidCalendarDate('2026-02-31'), false);
    assert.equal(isValidCalendarDate('2026-13-01'), false);
    assert.equal(isValidCalendarDate('01/01/2026'), false);
});

test('isValidDocumentId rejects unsafe Firestore document paths', () => {
    assert.equal(isValidDocumentId('event_123'), true);
    assert.equal(isValidDocumentId('events/123'), false);
    assert.equal(isValidDocumentId('.'), false);
    assert.equal(isValidDocumentId('..'), false);
    assert.equal(isValidDocumentId('x'.repeat(6), 5), false);
});
