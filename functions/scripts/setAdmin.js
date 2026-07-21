const admin = require('firebase-admin');

// Initialize with application default credentials or explicitly using projectId
admin.initializeApp({
  projectId: "reunionhub-f23cd"
});

const db = admin.firestore();

async function setAdmin() {
  const email = 'rodolfo-bm473@hotmail.com';
  console.log(`Buscando UID para o email: ${email}`);
  
  try {
    const userRecord = await admin.auth().getUserByEmail(email);
    console.log(`UID encontrado: ${userRecord.uid}`);
    
    console.log('Atualizando Firestore...');
    await db.collection('users').doc(userRecord.uid).update({
      role: 'admin'
    });
    console.log('Cargo de admin concedido com sucesso no Firestore!');
  } catch (error) {
    if (error.code === 'auth/user-not-found') {
      console.log('Usuário não encontrado na autenticação. Verificando apenas no Firestore pelo email (caso tenha salvo email lá)...');
      // Fallback: search firestore users collection
      const snapshot = await db.collection('users').where('email', '==', email).get();
      if (snapshot.empty) {
        console.log('Nenhum documento encontrado no Firestore com esse email.');
      } else {
        const uid = snapshot.docs[0].id;
        await db.collection('users').doc(uid).update({ role: 'admin' });
        console.log(`Cargo de admin concedido para UID: ${uid}`);
      }
    } else {
      console.error('Erro ao atualizar cargo:', error);
    }
  }
}

setAdmin();
