const test = require('node:test');
const assert = require('node:assert/strict');
const { selectEventChatRecipients } = require('../lib/eventChatNotifications');

test('notifica cada participante apenas uma vez até o chat ser aberto', () => {
    const members = ['ana', 'bia', 'ana', 'caio'];
    assert.deepEqual(selectEventChatRecipients(members, 'duda', 'ana', [], []), ['bia', 'caio', 'duda']);
    assert.deepEqual(selectEventChatRecipients(members, 'duda', 'ana', [], ['bia', 'caio', 'duda']), []);
    assert.deepEqual(selectEventChatRecipients(members, 'duda', 'ana', [], ['bia', 'duda']), ['caio']);
});

test('respeita silêncio do evento e pagina grupos maiores sem duplicar avisos', () => {
    const members = ['ana', 'bia', 'caio', 'duda'];
    const first = selectEventChatRecipients(members, 'ana', 'bia', ['caio'], [], 1);
    const second = selectEventChatRecipients(members, 'ana', 'bia', ['caio'], first, 1);
    assert.deepEqual(first, ['ana']);
    assert.deepEqual(second, ['duda']);
    assert.deepEqual(selectEventChatRecipients(members, 'ana', 'bia', ['caio'], [...first, ...second]), []);
});
