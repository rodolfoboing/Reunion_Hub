const assert = require('node:assert/strict');
const test = require('node:test');
const { sendPushMessages } = require('../lib/pushNotifications');

test('Expo envia no máximo 100 por lote e registra recibos sem perder TTL', async () => {
    const originalFetch = global.fetch;
    const batchSizes = [];
    let receipts = 0;
    global.fetch = async (_url, options) => {
        const payload = JSON.parse(options.body);
        batchSizes.push(payload.length);
        assert.ok(payload.every((item) => item.ttl > 0 && item.ttl <= 600));
        return { ok: true, status: 200, json: async () => ({
            data: payload.map((_, index) => ({ status: 'ok', id: `ticket-${batchSizes.length}-${index}` })),
        }) };
    };
    const db = {
        collection: () => ({ doc: (id) => ({ id }) }),
        batch: () => ({ set: () => { receipts += 1; }, commit: async () => undefined }),
    };
    try {
        const messages = Array.from({ length: 101 }, (_, index) => ({
            userId: `user-${index}`,
            title: 'Evento', body: 'Hoje', data: {}, channel: 'recommendations', priority: 'normal',
            expoToken: `ExpoPushToken[${index}]`, expiresAtMs: Date.now() + 10 * 60 * 1000,
        }));
        const result = await sendPushMessages(db, messages);
        assert.deepEqual(batchSizes.sort((a, b) => a - b), [1, 100]);
        assert.equal(receipts, 101);
        assert.equal(result.deliveredToProvider, 101);
        assert.equal(result.rejected, 0);
    } finally {
        global.fetch = originalFetch;
    }
});

test('erro temporário do Expo marca apenas o aparelho que precisa de nova tentativa', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => ({ status: 200, json: async () => ({ data: [
        { status: 'ok', id: 'ticket-ok' },
        { status: 'error', details: { error: 'MessageRateExceeded' } },
    ] }) });
    const db = {
        collection: () => ({ doc: (id) => ({ id }) }),
        batch: () => ({ set: () => undefined, commit: async () => undefined }),
    };
    try {
        const result = await sendPushMessages(db, [
            { userId: 'one', registrationPath: 'pushDevices/one', expoToken: 'ExpoPushToken[one]', title: 'Evento', body: 'Hoje', data: {}, channel: 'events', priority: 'normal' },
            { userId: 'two', registrationPath: 'pushDevices/two', expoToken: 'ExpoPushToken[two]', title: 'Evento', body: 'Hoje', data: {}, channel: 'events', priority: 'normal' },
        ]);
        assert.equal(result.deliveredToProvider, 1);
        assert.deepEqual(result.retryableRegistrationPaths, ['pushDevices/two']);
    } finally {
        global.fetch = originalFetch;
    }
});
