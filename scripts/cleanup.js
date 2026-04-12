const admin = require('firebase-admin');

// Configuración desde variables de entorno (inyectado por GitHub Actions)
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
const DATABASE_URL = 'https://dvdr-firebase-default-rtdb.firebaseio.com';

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: DATABASE_URL
});

const db = admin.database();
const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

async function cleanup() {
  console.log(`Buscando salas inactivas desde: ${new Date(oneWeekAgo).toLocaleString()}`);
  
  const eventsRef = db.ref('events');
  try {
    const snapshot = await eventsRef
      .orderByChild('metadata/lastActive')
      .endAt(oneWeekAgo)
      .once('value');

    if (!snapshot.exists()) {
      console.log('No se encontraron salas antiguas para eliminar.');
      process.exit(0);
    }

    const rooms = snapshot.val();
    const roomIds = Object.keys(rooms);
    console.log(`Se encontraron ${roomIds.length} salas antiguas.`);

    const deletePromises = roomIds.map(id => {
      console.log(`Eliminando sala: ${id} (Última actividad: ${new Date(rooms[id].metadata.lastActive).toLocaleString()})`);
      return eventsRef.child(id).remove();
    });

    await Promise.all(deletePromises);
    console.log('Limpieza completada con éxito.');
    process.exit(0);
  } catch (error) {
    console.error('Error durante la limpieza:', error);
    process.exit(1);
  }
}

cleanup();
