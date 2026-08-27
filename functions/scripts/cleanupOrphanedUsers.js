'use strict';

const admin = require('firebase-admin');

const DEFAULT_PROJECT_ID = 'reunionhub-f23cd';
const PAGE_SIZE = 100;
const DELETED_USER_NAME = 'Usuário excluído';

function optionValue(args, optionName) {
  const inline = args.find((argument) => argument.startsWith(`${optionName}=`));
  if (inline) return inline.slice(optionName.length + 1).trim();

  const optionIndex = args.indexOf(optionName);
  if (optionIndex === -1) return undefined;
  const value = args[optionIndex + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`A opção ${optionName} precisa de um valor.`);
  }
  return value.trim();
}

function printHelp() {
  console.log(`
Limpa perfis do Firestore que já não existem no Firebase Authentication.

Por segurança, o comando apenas lista as contas órfãs por padrão.

Uso, dentro da pasta functions:
  npm run cleanup:orphaned-users
  npm run cleanup:orphaned-users -- --uid UID_DO_USUARIO
  npm run cleanup:orphaned-users -- --apply
  npm run cleanup:orphaned-users -- --uid UID_DO_USUARIO --apply

Opções:
  --apply              Executa a limpeza. Sem esta opção nada é alterado.
  --uid <uid>          Verifica somente um perfil específico.
  --project <id>       Sobrescreve o projeto Firebase.
  --bucket <nome>      Sobrescreve o bucket usado para apagar avatares.
  --help               Exibe esta ajuda.

Autenticação administrativa:
  Defina GOOGLE_APPLICATION_CREDENTIALS com o caminho absoluto de uma chave
  de conta de serviço mantida fora do repositório.
`);
}

function pendingCheckInsWithout(value, userId) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && typeof item === 'object' && item.userId !== userId);
}

async function notifyCancelledEvents(db, events) {
  const deliveries = events.flatMap(({ eventId, event }) => {
    const creatorId = typeof event.createdBy === 'string' ? event.createdBy : '';
    const title = typeof event.title === 'string' && event.title ? event.title : 'sem título';
    const attendees = Array.isArray(event.attendees)
      ? [...new Set(event.attendees.filter((userId) => typeof userId === 'string'))]
      : [];
    return attendees
      .filter((userId) => userId !== creatorId)
      .map((userId) => ({
        id: `event_cancelled_${eventId}_${userId}`,
        userId,
        title: 'Evento cancelado',
        body: `O evento "${title}" foi cancelado porque a conta do organizador foi removida.`,
        eventId,
      }));
  });
  if (deliveries.length === 0) return;

  const profiles = new Map();
  const userIds = [...new Set(deliveries.map(({ userId }) => userId))];
  for (let index = 0; index < userIds.length; index += PAGE_SIZE) {
    const chunk = userIds.slice(index, index + PAGE_SIZE);
    const snapshots = await db.getAll(...chunk.map((userId) => db.collection('users').doc(userId)));
    snapshots.forEach((snapshot) => {
      if (snapshot.exists) profiles.set(snapshot.id, snapshot.data());
    });
  }

  const validDeliveries = deliveries.filter(({ userId }) => profiles.has(userId));
  for (let index = 0; index < validDeliveries.length; index += 400) {
    const batch = db.batch();
    validDeliveries.slice(index, index + 400).forEach((delivery) => {
      batch.set(db.collection('notifications').doc(delivery.id), {
        userId: delivery.userId,
        type: 'event_cancelled',
        title: delivery.title,
        body: delivery.body,
        meetingId: delivery.eventId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        read: false,
      }, { merge: true });
    });
    await batch.commit();
  }

  const devicesByUser = new Map();
  await Promise.all(userIds.map(async (userId) => {
    const devices = await db.collection('pushDevices').where('userId', '==', userId).limit(10).get();
    devicesByUser.set(userId, devices.docs.map((device) => device.data()));
  }));
  const pushMessages = validDeliveries.flatMap((delivery) => (
    (devicesByUser.get(delivery.userId) || []).flatMap((device) => {
      if (device.platform !== 'android' || typeof device.nativePushToken !== 'string') return [];
      return [{
        token: device.nativePushToken,
        notification: { title: delivery.title, body: delivery.body },
        data: { path: `/event/${delivery.eventId}`, meetingId: delivery.eventId, notificationType: 'event_cancelled' },
        android: {
          priority: 'high',
          notification: { channelId: 'events', sound: 'default' },
        },
      }];
    })
  ));
  for (let index = 0; index < pushMessages.length; index += 500) {
    await admin.messaging().sendEach(pushMessages.slice(index, index + 500));
  }
}

async function processQueryInPages(db, baseQuery, applyDocument) {
  let cursor;
  let affected = 0;

  while (true) {
    let pageQuery = baseQuery.orderBy(admin.firestore.FieldPath.documentId()).limit(PAGE_SIZE);
    if (cursor) pageQuery = pageQuery.startAfter(cursor);

    const snapshot = await pageQuery.get();
    if (snapshot.empty) return affected;

    const batch = db.batch();
    let pageAffected = 0;
    snapshot.docs.forEach((document) => {
      if (applyDocument(batch, document) !== false) pageAffected += 1;
    });
    if (pageAffected > 0) await batch.commit();

    affected += pageAffected;
    cursor = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.size < PAGE_SIZE) return affected;
  }
}

async function findOrphanedProfiles(db, auth, targetUserId) {
  if (targetUserId) {
    const profile = await db.collection('users').doc(targetUserId).get();
    if (!profile.exists) {
      console.log('Nenhum perfil do Firestore foi encontrado para o UID informado.');
      return [];
    }

    try {
      await auth.getUser(targetUserId);
      console.log('O UID informado ainda existe no Firebase Authentication. Nada será limpo.');
      return [];
    } catch (error) {
      if (error && error.code === 'auth/user-not-found') return [profile];
      throw error;
    }
  }

  const orphanedProfiles = [];
  let cursor;

  while (true) {
    let query = db.collection('users')
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);

    const snapshot = await query.get();
    if (snapshot.empty) break;

    const lookup = await auth.getUsers(snapshot.docs.map((document) => ({ uid: document.id })));
    const missingUserIds = new Set(
      lookup.notFound
        .map((identifier) => identifier.uid)
        .filter((uid) => typeof uid === 'string')
    );
    snapshot.docs.forEach((document) => {
      if (missingUserIds.has(document.id)) orphanedProfiles.push(document);
    });

    cursor = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.size < PAGE_SIZE) break;
  }

  return orphanedProfiles;
}

async function cleanupProfile(db, bucket, profile) {
  const userId = profile.id;
  const userRef = profile.ref;
  const cancelledEvents = [];
  const counts = {
    favorites: 0,
    privatePlaceHabits: 0,
    notifications: 0,
    reports: 0,
    invitations: 0,
    checkInReviews: 0,
    createdEvents: 0,
    activeAttendances: 0,
    conversations: 0,
    places: 0,
    blockedReferences: 0,
    pushDevices: 0,
    notificationSettings: 0,
  };

  counts.favorites = await processQueryInPages(
    db,
    userRef.collection('favoriteEvents'),
    (batch, document) => batch.delete(document.ref)
  );
  counts.privatePlaceHabits = await processQueryInPages(
    db,
    userRef.collection('placeHabits'),
    (batch, document) => batch.delete(document.ref)
  );
  counts.notifications = await processQueryInPages(
    db,
    db.collection('notifications').where('userId', '==', userId),
    (batch, document) => batch.delete(document.ref)
  );
  counts.reports += await processQueryInPages(
    db,
    db.collection('reports').where('reportedBy', '==', userId),
    (batch, document) => batch.delete(document.ref)
  );
  counts.reports += await processQueryInPages(
    db,
    db.collection('reports').where('targetId', '==', userId),
    (batch, document) => {
      if (document.data().type !== 'user') return false;
      batch.delete(document.ref);
    }
  );
  counts.invitations += await processQueryInPages(
    db,
    db.collection('eventInvitations').where('inviterId', '==', userId),
    (batch, document) => batch.delete(document.ref)
  );
  counts.pushDevices = await processQueryInPages(
    db,
    db.collection('pushDevices').where('userId', '==', userId),
    (batch, document) => batch.delete(document.ref)
  );
  await db.collection('pushTokens').doc(userId).delete().catch(() => undefined);
  const notificationSettings = await db.collection('notificationSettings').doc(userId).get();
  if (notificationSettings.exists) {
    await notificationSettings.ref.delete();
    counts.notificationSettings = 1;
  }
  counts.invitations += await processQueryInPages(
    db,
    db.collection('eventInvitations').where('inviteeId', '==', userId),
    (batch, document) => batch.delete(document.ref)
  );
  counts.checkInReviews = await processQueryInPages(
    db,
    db.collection('eventCheckInReviews').where('userId', '==', userId),
    (batch, document) => batch.delete(document.ref)
  );

  counts.createdEvents = await processQueryInPages(
    db,
    db.collection('meetings').where('createdBy', '==', userId),
    (batch, document) => {
      const event = document.data();
      const changes = {
        creatorName: DELETED_USER_NAME,
        creatorDeleted: true,
      };
      if (!event.status || event.status === 'active') {
        changes.status = 'cancelled';
        cancelledEvents.push({ eventId: document.id, event });
      }
      batch.update(document.ref, changes);
    }
  );
  try {
    await notifyCancelledEvents(db, cancelledEvents);
  } catch (error) {
    console.warn('[Cleanup] Os eventos foram cancelados, mas algumas notificações podem ter falhado.', error.message);
  }
  counts.activeAttendances = await processQueryInPages(
    db,
    db.collection('meetings').where('attendees', 'array-contains', userId),
    (batch, document) => {
      const event = document.data();
      if (event.createdBy === userId || (event.status && event.status !== 'active')) return false;
      batch.update(document.ref, {
        attendees: admin.firestore.FieldValue.arrayRemove(userId),
        checkedIn: admin.firestore.FieldValue.arrayRemove(userId),
        pendingCheckIns: pendingCheckInsWithout(event.pendingCheckIns, userId),
      });
    }
  );

  counts.conversations = await processQueryInPages(
    db,
    db.collection('conversations').where('participants', 'array-contains', userId),
    (batch, document) => batch.update(
      document.ref,
      new admin.firestore.FieldPath('participantNames', userId),
      DELETED_USER_NAME,
      new admin.firestore.FieldPath('unreadCounts', userId),
      admin.firestore.FieldValue.delete()
    )
  );
  counts.places = await processQueryInPages(
    db,
    db.collection('places').where('frequenters', 'array-contains', userId),
    (batch, document) => batch.update(
      document.ref,
      'frequenters',
      admin.firestore.FieldValue.arrayRemove(userId),
      new admin.firestore.FieldPath('habits', userId),
      admin.firestore.FieldValue.delete(),
      new admin.firestore.FieldPath('habitSchedules', userId),
      admin.firestore.FieldValue.delete()
    )
  );
  counts.blockedReferences = await processQueryInPages(
    db,
    db.collection('users').where('blockedUsers', 'array-contains', userId),
    (batch, document) => batch.update(document.ref, {
      blockedUsers: admin.firestore.FieldValue.arrayRemove(userId),
    })
  );

  await userRef.delete();

  let avatarCleanup = 'ok';
  try {
    await bucket.deleteFiles({ prefix: `avatars/${userId}_` });
  } catch (error) {
    avatarCleanup = 'falhou';
    console.warn(`[Cleanup] Não foi possível apagar o avatar do UID ${userId}.`, error.message);
  }

  return { ...counts, avatarCleanup };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    printHelp();
    return;
  }

  const applyChanges = args.includes('--apply');
  const targetUserId = optionValue(args, '--uid');
  const projectId = optionValue(args, '--project')
    || process.env.GCLOUD_PROJECT
    || process.env.GOOGLE_CLOUD_PROJECT
    || DEFAULT_PROJECT_ID;
  const storageBucket = optionValue(args, '--bucket')
    || process.env.FIREBASE_STORAGE_BUCKET
    || process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET
    || `${projectId}.firebasestorage.app`;

  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId,
    storageBucket,
  });

  const db = admin.firestore();
  const auth = admin.auth();
  const bucket = admin.storage().bucket();
  console.log(`[Cleanup] Projeto: ${projectId}`);
  console.log(`[Cleanup] Modo: ${applyChanges ? 'APLICAR ALTERAÇÕES' : 'SIMULAÇÃO'}`);

  const orphanedProfiles = await findOrphanedProfiles(db, auth, targetUserId);
  if (orphanedProfiles.length === 0) {
    console.log('[Cleanup] Nenhum perfil órfão encontrado.');
    return;
  }

  console.log(`[Cleanup] Perfis órfãos encontrados: ${orphanedProfiles.length}`);
  orphanedProfiles.forEach((profile) => console.log(`  - ${profile.id}`));

  if (!applyChanges) {
    console.log('[Cleanup] Simulação concluída. Execute novamente com --apply para limpar esses perfis.');
    return;
  }

  for (const profile of orphanedProfiles) {
    console.log(`[Cleanup] Limpando UID ${profile.id}...`);
    const result = await cleanupProfile(db, bucket, profile);
    console.log(`[Cleanup] UID ${profile.id} concluído:`, result);
  }

  console.log(`[Cleanup] Limpeza concluída para ${orphanedProfiles.length} perfil(is).`);
}

main().catch((error) => {
  console.error('[Cleanup] Falha. Nenhuma conta existente no Authentication foi removida.', error);
  process.exitCode = 1;
});
