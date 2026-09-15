const assert = require('node:assert/strict');
const test = require('node:test');

const { isExpoPushToken, planPushRouting, stringData } = require('../lib/pushNotifications');

function message(overrides) {
    return {
        userId: 'user1',
        title: 'Titulo',
        body: 'Corpo',
        data: {},
        channel: 'events',
        priority: 'high',
        ...overrides,
    };
}

test('aceita apenas os prefixos de token do Expo', () => {
    assert.equal(isExpoPushToken('ExponentPushToken[abc]'), true);
    assert.equal(isExpoPushToken('ExpoPushToken[abc]'), true);
    assert.equal(isExpoPushToken('fcm-native-token'), false);
    assert.equal(isExpoPushToken(''), false);
    assert.equal(isExpoPushToken(undefined), false);
});

test('stringData converte primitivos e descarta o resto', () => {
    assert.deepEqual(
        stringData({ path: '/event/1', count: 3, flag: true }),
        { path: '/event/1', count: '3', flag: 'true' },
    );
    // Contrato explícito: objeto/array/null somem do payload do FCM.
    assert.deepEqual(stringData({ nested: { a: 1 }, list: [1], nothing: null }), {});
});

test('Android com token nativo sai só por FCM, sem duplicar no Expo', () => {
    const plan = planPushRouting([message({
        registrationPath: 'pushDevices/device1',
        platform: 'android',
        nativeToken: 'fcm-1',
        expoToken: 'ExponentPushToken[abc]',
    })]);

    assert.equal(plan.native.length, 1);
    assert.equal(plan.expoFallback.length, 0, 'o mesmo aparelho não pode receber pelos dois caminhos');
    assert.equal(plan.missingToken, 0);
});

test('sem token nativo cai no Expo (iOS e Android sem FCM)', () => {
    const plan = planPushRouting([
        message({ registrationPath: 'pushDevices/ios1', platform: 'ios', expoToken: 'ExponentPushToken[ios]' }),
        message({ registrationPath: 'pushDevices/android2', platform: 'android', expoToken: 'ExponentPushToken[and]' }),
    ]);

    assert.equal(plan.native.length, 0);
    assert.equal(plan.expoFallback.length, 2);
    assert.equal(plan.missingToken, 0);
});

test('nativeToken vazio não conta como caminho nativo', () => {
    const plan = planPushRouting([message({
        registrationPath: 'pushDevices/device3',
        platform: 'android',
        nativeToken: '',
        expoToken: 'ExponentPushToken[abc]',
    })]);

    assert.equal(plan.native.length, 0);
    assert.equal(plan.expoFallback.length, 1);
});

test('mensagem sem nenhum token entra em missingToken', () => {
    const plan = planPushRouting([
        message({ registrationPath: 'pushDevices/device4', platform: 'android' }),
        // Formato legado: usuário sem device registrado, sem registrationPath.
        message({ userId: 'user2' }),
    ]);

    assert.equal(plan.native.length, 0);
    assert.equal(plan.expoFallback.length, 0);
    assert.equal(plan.missingToken, 2);
});

test('cada mensagem recebe exatamente um destino', () => {
    const messages = [
        message({ registrationPath: 'pushDevices/a', platform: 'android', nativeToken: 'fcm-a', expoToken: 'ExponentPushToken[a]' }),
        message({ registrationPath: 'pushDevices/b', platform: 'ios', expoToken: 'ExponentPushToken[b]' }),
        message({ registrationPath: 'pushDevices/c', platform: 'android' }),
        message({ userId: 'user3' }),
    ];

    const plan = planPushRouting(messages);
    assert.equal(
        plan.native.length + plan.expoFallback.length + plan.missingToken,
        messages.length,
        'nenhuma mensagem pode ser perdida nem contada duas vezes',
    );
});

test('vários aparelhos do mesmo usuário são roteados de forma independente', () => {
    const plan = planPushRouting([
        message({ registrationPath: 'pushDevices/phone', platform: 'android', nativeToken: 'fcm-phone' }),
        message({ registrationPath: 'pushDevices/tablet', platform: 'android', expoToken: 'ExponentPushToken[tablet]' }),
    ]);

    assert.equal(plan.native.length, 1);
    assert.equal(plan.expoFallback.length, 1);
    assert.equal(plan.missingToken, 0);
});
