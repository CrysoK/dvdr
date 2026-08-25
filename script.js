import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js';
import { getDatabase, ref, set, get, onValue, remove, update, onDisconnect, query, orderByChild, endAt } from 'https://www.gstatic.com/firebasejs/12.12.1/firebase-database.js';
import Alpine from 'https://cdn.jsdelivr.net/npm/alpinejs@3.15.11/dist/module.esm.js';

const firebaseConfig = {
  apiKey: "AIzaSyAkWVD_Sb2tHJeZRSvfCZCyqJHifq2jLaM",
  authDomain: "dvdr-firebase.firebaseapp.com",
  databaseURL: "https://dvdr-firebase-default-rtdb.firebaseio.com",
  projectId: "dvdr-firebase",
  storageBucket: "dvdr-firebase.firebasestorage.app",
  messagingSenderId: "469351231087",
  appId: "1:469351231087:web:cc69531ff7550e4cee679a",
  measurementId: "G-GTKT2MXD3T"
};

let db;
let auth;
let firebaseInitError = false;
try {
  const app = initializeApp(firebaseConfig);
  db = getDatabase(app);
  auth = getAuth(app);
} catch (e) {
  console.warn("Firebase no está configurado.");
  firebaseInitError = true;
}

const ROOM_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_ID_LENGTH = 8;

function generateRoomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(ROOM_ID_LENGTH));
  let id = '';
  for (let i = 0; i < ROOM_ID_LENGTH; i++) {
    id += ROOM_ID_ALPHABET[bytes[i] & 31];
  }
  return id;
}

Alpine.data('app', function () {
  const APP_VERSION = '2.2.0';
  const STORAGE_KEY = 'dvdr_data';

  const MIGRATIONS = {
    '1.1.0': (data) => {
      if (!data.hasOwnProperty('history')) { data.history = []; }
      return data;
    },
    '2.2.0': (data) => {
      // Consolidar los datos dispersos en localStorage
      const lastUsers = {};
      const keysToRemove = [];

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;

        if (key.startsWith('dvdr_last_user_')) {
          const eventId = key.replace('dvdr_last_user_', '');
          lastUsers[eventId] = localStorage.getItem(key);
        }

        // Limpiar solo claves conocidas de la app
        if (key.startsWith('dvdr_') || key === 'dvd_data' || key === 'dvdr_admin_keys') {
          if (key !== 'dvdr_theme' && key !== 'dvdr_data') {
            keysToRemove.push(key);
          }
        }
      }

      data.lastUsers = lastUsers;

      keysToRemove.forEach(k => localStorage.removeItem(k));
      return data;
    }
  };

  function runMigrations(data) {
    let currentData = { ...data };
    let dataVersion = currentData.version;
    if (!dataVersion) return currentData;
    const migrationTargets = Object.keys(MIGRATIONS).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    for (const targetVersion of migrationTargets) {
      // No ejecutar migraciones para versiones posteriores a la actual
      if (targetVersion.localeCompare(APP_VERSION, undefined, { numeric: true }) > 0) continue;

      if (dataVersion.localeCompare(targetVersion, undefined, { numeric: true }) < 0) {
        currentData = MIGRATIONS[targetVersion](currentData);
        currentData.version = targetVersion;
        dataVersion = targetVersion;
      }
    }
    if (currentData.version !== APP_VERSION) currentData.version = APP_VERSION;
    return currentData;
  }

  return {
    version: APP_VERSION,
    uid: null,
    isOnline: false,
    eventId: null,
    eventName: '',
    currentUser: null,
    showOnlineModal: false,
    onlineTab: 'join',
    joinEventId: '',
    createEventName: '',
    newUserName: '',
    eventCreator: null,
    claimedUsers: {},
    isFirebaseConnected: false,
    confirmedAdmin: false,
    onlinePresence: {},
    eventRenames: {},
    _firebaseUnsubs: [],
    isJoining: false,
    unclaimedPeople: [],
    showManualName: false,
    lastUsers: {},
    recentRoomsList: [],
    isLoadingRecent: false,
    get isAdmin() {
      if (!this.eventId || !this.isOnline) return false;
      return this.confirmedAdmin;
    },
    _presenceDisplayName(key, value) {
      if (value === true) return key;
      if (typeof value === 'string') return value;
      if (value && typeof value === 'object' && value.name) return value.name;
      return null;
    },
    _presenceNameMap(presence) {
      const names = {};
      Object.entries(presence || {}).forEach(([key, value]) => {
        const name = this._presenceDisplayName(key, value);
        if (name) names[name] = true;
      });
      return names;
    },
    get onlineByName() {
      return this._presenceNameMap(this.onlinePresence);
    },

    people: [],
    transactions: [],
    history: [],
    newPersonName: '',
    newHistoryName: '',
    activeTab: 'expense',
    mobileTab: 'personas',
    isMobile: false,
    showMobileForm: false,
    notifications: [],
    changelog: {
      show: false,
      loading: false,
      error: false,
      data: []
    },
    confirmation: {
      show: false, title: '', message: '', onConfirm: () => { }, onCancel: () => { }, confirmText: 'Confirmar', cancelText: 'Cancelar', confirmClass: 'primary'
    },

    editingPerson: { oldName: null, newName: '' },
    editingTransactionId: null,

    expenseForm: { description: '', amount: null, payer: '', participants: [], splitType: 'equal', customSplit: {}, },
    adjustmentForm: { description: '', amount: null, beneficiary: '', contributors: [], },
    transferForm: { from: '', to: '', amount: null, },
    waitingWorker: null,
    themePreference: 'system', // 'system' | 'light' | 'dark'
    get darkMode() {
      if (this.themePreference === 'system') return window.matchMedia('(prefers-color-scheme: dark)').matches;
      return this.themePreference === 'dark';
    },
    hasUpdate: false,

    init() {
      // Theme: load saved preference or default to 'system'
      this.themePreference = localStorage.getItem('dvdr_theme') || 'system';
      this._applyTheme();
      // Listen for OS theme changes (relevant when preference is 'system')
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (this.themePreference === 'system') this._applyTheme();
      });

      this.$watch('joinEventId', async (val) => {
        const id = val.trim().toUpperCase();
        this.showManualName = false;
        if ((id.length === 6 || id.length >= ROOM_ID_LENGTH) && db) {
          try {
            const [metaSnap, peopleSnap] = await Promise.all([
              get(ref(db, `events/${id}/metadata`)),
              get(ref(db, `events/${id}/data/people`))
            ]);
            if (metaSnap.exists() && peopleSnap.exists()) {
              const claimed = metaSnap.val().users || {};
              const allPeople = peopleSnap.val() || {};
              const peopleList = Array.isArray(allPeople) ? allPeople : Object.keys(allPeople);
              this.unclaimedPeople = peopleList.filter(p => !claimed[p]);
            } else {
              this.unclaimedPeople = [];
            }
          } catch (e) { this.unclaimedPeople = []; }
        } else {
          this.unclaimedPeople = [];
        }
      });

      if (firebaseInitError) {
        this.addNotification('No se pudo conectar con Firebase. El modo online no estará disponible.', 'error', 6000);
      }
      // Manejar Autenticación Silenciosa
      if (auth) {
        signInAnonymously(auth).catch(e => console.warn("Error de autenticación", e));
        onAuthStateChanged(auth, (user) => {
          this.uid = user ? user.uid : null;
        });
      }
      if (db) {
        onValue(ref(db, '.info/connected'), (snap) => {
          this.isFirebaseConnected = snap.val() === true;
          if (this.isFirebaseConnected && this.isOnline && this.eventId && this.uid && this.currentUser) {
            const myPresenceRef = ref(db, `events/${this.eventId}/presence/${this.uid}`);
            onDisconnect(myPresenceRef).remove();
            set(myPresenceRef, this.currentUser);
          }
        });
      }

      // Mobile viewport detection
      const mq = window.matchMedia('(max-width: 991px)');
      this.isMobile = mq.matches;
      mq.addEventListener('change', (e) => {
        this.isMobile = e.matches;
        if (!e.matches) this.showMobileForm = false;
      });
      this.loadData();
      const urlParams = new URLSearchParams(window.location.search);
      const eventIdFromUrl = urlParams.get('e');
      const userFromUrl = urlParams.get('u');
      if (eventIdFromUrl) {
        this.joinEventId = eventIdFromUrl.toUpperCase();
        if (userFromUrl) {
          this.newUserName = decodeURIComponent(userFromUrl);
          this.$nextTick(() => this.enterEvent());
        } else {
          const savedUser = this.lastUsers[this.joinEventId];
          if (savedUser) {
            this.newUserName = savedUser;
            this.$nextTick(() => this.enterEvent());
          } else {
            this.showOnlineModal = true;
            this.onlineTab = 'join';
          }
        }
      }

      window.addEventListener('sw-update-available', (event) => {
        this.hasUpdate = true;
        this.waitingWorker = event.detail;
      });
      this.$watch('people', (newVal, oldVal) => {
        if (this.editingTransactionId) return;
        const oldP = oldVal || [];
        const newP = newVal || [];

        const added = newP.filter(p => !oldP.includes(p));
        const removed = oldP.filter(p => !newP.includes(p));

        if (added.length === 0 && removed.length === 0) return;

        if (added.length > 0) {
          this.expenseForm.participants = [...this.expenseForm.participants, ...added];
          this.adjustmentForm.contributors = [...this.adjustmentForm.contributors, ...added];
        }
        if (removed.length > 0) {
          this.expenseForm.participants = this.expenseForm.participants.filter(p => !removed.includes(p));
          this.adjustmentForm.contributors = this.adjustmentForm.contributors.filter(p => !removed.includes(p));
          removed.forEach(p => { delete this.expenseForm.customSplit[p]; });
        }
      });
    },
    toggleTheme() {
      const cycle = { system: 'light', light: 'dark', dark: 'system' };
      this.themePreference = cycle[this.themePreference] || 'system';
      if (this.themePreference === 'system') {
        localStorage.removeItem('dvdr_theme');
      } else {
        localStorage.setItem('dvdr_theme', this.themePreference);
      }
      this._applyTheme();
    },
    _applyTheme() {
      const isDark = this.darkMode;
      document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
      const metaTheme = document.querySelector('meta[name="theme-color"]');
      if (metaTheme) {
        metaTheme.setAttribute('content', isDark ? '#0f1923' : '#274768');
      }
    },
    refreshApp() {
      this.addNotification('Actualizando aplicación...', 'info');
      if (this.waitingWorker) {
        // Le dice al SW que tome el control. Esto disparará 'controllerchange' en index.html
        this.waitingWorker.postMessage({ type: 'SKIP_WAITING' });
      }
    },
    async updateRemote(updates) {
      if (this.isOnline && db && this.eventId) {
        updates['metadata/lastActive'] = Date.now();
        try { await update(ref(db, `events/${this.eventId}`), updates); } catch (e) { console.error("Error sync", e); }
      }
    },
    saveData() {
      const data = {
        version: this.version,
        people: this.people,
        transactions: this.transactions,
        history: this.history,
        lastUsers: this.lastUsers
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    },
    loadData() {
      let dataToLoad = null;
      // 1. Intentar cargar estado desde la URL (Ej: Shared Link)
      if (window.location.hash) {
        try {
          const jsonData = decodeURIComponent(escape(atob(window.location.hash.substring(1))));
          const parsed = JSON.parse(jsonData);
          if (parsed && parsed.version && Array.isArray(parsed.people)) {
            dataToLoad = parsed;
          } else {
            this.addNotification("El enlace para compartir es de una versión antigua o está corrupto.", 'error', 5000);
          }
        } catch (e) {
          console.error("Error al cargar datos desde la URL", e);
          this.addNotification("El enlace para compartir es inválido o está corrupto.", 'error', 5000);
        } finally {
          history.pushState("", document.title, window.location.pathname);
        }
      }
      // 2. Rescatar y preparar los datos locales
      let localDataStr = localStorage.getItem(STORAGE_KEY);
      if (!localDataStr) {
        localDataStr = localStorage.getItem('dvd_data');
      }
      if (!localDataStr) {
        // Generar un esqueleto si hay rastros viejos en localStorage que requieran migración
        const hasOrphans = Object.keys(localStorage).some(k => k.startsWith('dvdr_last_user_') || k === 'dvdr_admin_keys');
        if (hasOrphans) {
          localDataStr = JSON.stringify({ version: '2.1.2', people: [], transactions: [], history: [] });
        }
      }

      let localData = null;
      if (localDataStr) {
        try {
          localData = JSON.parse(localDataStr);
          // Migrar inmediatamente si la versión local es menor
          if (localData && localData.version.localeCompare(this.version, undefined, { numeric: true }) < 0) {
            localData = runMigrations(localData);
            if (!dataToLoad) { // Mostrar toast si no sobreescribimos desde URL
              this.addNotification(`¡DVDr actualizado a v${this.version}!`, 'success', 4000);
              setTimeout(() => { this.openChangelog(); }, 500);
            }
          }
          // Siempre restaurar el estado persistente del usuario (sesiones previas)
          this.lastUsers = localData.lastUsers || {};
        } catch (e) {
          console.error("Error al parsear datos de localStorage", e);
        }
      }
      // 3. Determinar los datos finales (URL sobrescribe el estado del balance local, pero se mantienen configuraciones de usuario)
      let finalData = dataToLoad || localData;

      if (finalData) {
        // Asegurar la migración en caso de que los datos vinieran puramente de un link antiguo
        if (dataToLoad && dataToLoad.version.localeCompare(this.version, undefined, { numeric: true }) < 0) {
          finalData = runMigrations(finalData);
        }
        this.people = finalData.people || [];
        this.transactions = finalData.transactions || [];
        this.history = finalData.history || [];
        this.saveData();
      }
    },
    clearCurrentDivision() {
      if (this.isOnline && !this.isAdmin) return this.addNotification('Solo el creador del evento puede limpiar la división.', 'warning');
      this.askConfirm({
        title: 'Limpiar división actual',
        message: 'Esto borrará las personas y transacciones de la sesión actual (sin afectar a las divisiones guardadas). ¿Deseas continuar?',
        confirmText: 'Sí, limpiar',
        confirmClass: 'warning',
        onConfirm: () => {
          if (this.isOnline) {
            this.updateRemote({ 'data': null });
          }
          this.people = [];
          this.transactions = [];
          this.cancelEditTransaction();
          this.saveData();
          window.scrollTo({ top: 0, behavior: 'smooth' });
          this.addNotification('División actual limpiada.', 'success');
        }
      });
    },
    resetData() {
      if (this.isOnline && !this.isAdmin) return this.addNotification('Solo el creador del evento puede reiniciar todos los datos.', 'warning');
      this.askConfirm({
        title: 'Reiniciar todos los datos',
        message: '¿Seguro que quieres borrar TODOS los datos? Esto incluye personas, transacciones y las divisiones guardadas. Esta acción no se puede deshacer.',
        confirmText: 'Sí, borrar todo',
        confirmClass: 'danger',
        onConfirm: () => {
          this.people = [];
          this.transactions = [];
          this.history = [];
          this.saveData();
          this.addNotification('Todos los datos han sido reiniciados.', 'success');
        }
      });
    },
    loadDemoData() {
      if (this.isOnline && !this.isAdmin) return this.addNotification('Solo el creador del evento puede cargar datos de prueba.', 'warning');
      const load = () => {
        const baseTime = Date.now();
        // 1. Personas
        this.people = ['Ana', 'Beto', 'Carla', 'Dani'];
        // 2. Transacciones variadas para mostrar todas las funciones
        this.transactions = [
          {
            id: baseTime,
            type: 'expense',
            description: 'Supermercado y comida',
            amount: 15600.00,
            payer: 'Ana',
            shares: [
              { person: 'Ana', amount: 3900 },
              { person: 'Beto', amount: 3900 },
              { person: 'Carla', amount: 3900 },
              { person: 'Dani', amount: 3900 }
            ]
          },
          {
            id: baseTime + 1,
            type: 'expense',
            description: 'Alquiler de la cabaña',
            amount: 40000.00,
            payer: 'Beto',
            shares: [
              { person: 'Ana', amount: 10000 },
              { person: 'Beto', amount: 10000 },
              { person: 'Carla', amount: 10000 },
              { person: 'Dani', amount: 10000 }
            ]
          },
          {
            id: baseTime + 2,
            type: 'expense',
            description: 'Bebidas (Dani no tomó)',
            amount: 4500.00,
            payer: 'Carla',
            shares: [
              { person: 'Ana', amount: 1500 },
              { person: 'Beto', amount: 1500 },
              { person: 'Carla', amount: 1500 }
            ]
          },
          {
            id: baseTime + 3,
            type: 'adjustment',
            description: 'Ana rompió un vaso (pagan todos)',
            amount: 1200.00,
            beneficiary: 'Beto', // Beto lo pagó o es el dueño
            contributors: ['Ana', 'Beto', 'Carla', 'Dani']
          },
          {
            id: baseTime + 4,
            type: 'transfer',
            description: 'Transferencia parcial',
            from: 'Dani',
            to: 'Beto',
            amount: 5000.00
          }
        ];
        this.newHistoryName = '';
        this.cancelEditTransaction();
        this.saveData();
        this.addNotification('Datos de demostración cargados.', 'success');
      };
      if (this.people.length > 0 || this.transactions.length > 0) {
        this.askConfirm({
          title: 'Cargar demostración',
          message: 'Esto reemplazará tus datos actuales de la sesión. ¿Deseas continuar?',
          confirmText: 'Cargar Demo',
          onConfirm: load
        });
      } else {
        load();
      }
    },
    // --- MÉTODOS ONLINE ---

    openOnlineModal() {
      this.showOnlineModal = true;
      // Si el usuario tiene historial de salas, abrimos por defecto la pestaña "Recientes"
      if (Object.keys(this.lastUsers).length > 0) {
        this.onlineTab = 'recent';
        this.fetchRecentRooms();
      } else {
        this.onlineTab = 'join';
      }
    },
    closeOnlineModal() { if (!this.isOnline) this.showOnlineModal = false; },

    async fetchRecentRooms() {
      if (!db) return;
      if (!this.isFirebaseConnected) {
        this.isLoadingRecent = false;
        return;
      }
      this.isLoadingRecent = true;
      const roomIds = Object.keys(this.lastUsers);
      const validRooms = [];
      const keysToRemove = [];

      try {
        // Consultar todas las salas en paralelo
        await Promise.all(roomIds.map(async (id) => {
          try {
            const snap = await get(ref(db, `events/${id}/metadata`));
            if (snap.exists()) {
              const meta = snap.val();
              validRooms.push({
                id: id,
                name: meta.name,
                lastActive: meta.lastActive || meta.createdAt || Date.now(),
                isCreator: meta.creator_uid === this.uid,
                userName: this.lastUsers[id] // El nombre que usamos en esa sala
              });
            } else {
              // Si ya no existe (eliminada por el cron o manualmente), la marcamos para borrarla
              keysToRemove.push(id);
            }
          } catch (e) {
            console.warn(`No se pudo cargar la sala ${id}`);
          }
        }));

        // Limpiar localStorage de salas eliminadas
        if (keysToRemove.length > 0) {
          keysToRemove.forEach(id => delete this.lastUsers[id]);
          this.saveData();
        }

        // Ordenar temporalmente por fecha de actividad (más reciente arriba)
        validRooms.sort((a, b) => b.lastActive - a.lastActive);

        // Separar: Mostrar TODAS las propias, y máximo las últimas 5 invitadas
        const myRooms = validRooms.filter(r => r.isCreator);
        const otherRooms = validRooms.filter(r => !r.isCreator).slice(0, 5);

        // Juntar y ordenar final
        this.recentRoomsList = [...myRooms, ...otherRooms].sort((a, b) => b.lastActive - a.lastActive);
      } catch (e) {
        console.error("Error fetching recent rooms", e);
      } finally {
        this.isLoadingRecent = false;
      }
    },

    formatExpiration(lastActiveTimestamp) {
      const msInDay = 1000 * 60 * 60 * 24;
      const msInHour = 1000 * 60 * 60;
      const inactiveTime = Date.now() - lastActiveTimestamp;
      const timeLeft = (7 * msInDay) - inactiveTime;

      if (timeLeft <= 0) return 'Expirando...';

      const daysLeft = Math.floor(timeLeft / msInDay);
      if (daysLeft > 0) {
        return `Expira en ${daysLeft} ${daysLeft === 1 ? 'día' : 'días'}`;
      }
      const hoursLeft = Math.floor(timeLeft / msInHour);
      return `Expira en ${hoursLeft} ${hoursLeft === 1 ? 'hora' : 'horas'}`;
    },

    joinRecent(room) {
      this.joinEventId = room.id;
      this.newUserName = room.userName;
      this.enterEvent();
    },

    async createEvent() {
      if (this.isJoining) return;
      this.createEventName = this.createEventName.replace(/[.#$\[\]]/g, '').trim().substring(0, 40);
      this.newUserName = this.newUserName.replace(/[.#$\[\]]/g, '').trim().substring(0, 30);
      if (!this.createEventName || !this.newUserName) return this.addNotification('Ingresa nombres válidos (sin . # $ [ ])', 'warning');
      // Rate limit: máximo 3 salas por sesión
      const created = parseInt(sessionStorage.getItem('dvdr_rooms_created') || '0');
      if (created >= 3) return this.addNotification('Has creado demasiadas salas en esta sesión. Recarga la página si necesitas crear más.', 'warning');
      // Validación extra: Esperar inicio de sesión
      if (!this.uid) return this.addNotification('Conectando de forma segura, intenta de nuevo...', 'warning');
      this.isJoining = true;
      const userName = this.newUserName;
      try {
        let eventId = null;
        for (let i = 0; i < 8; i++) {
          const candidate = generateRoomId();
          const snap = await get(ref(db, `events/${candidate}/metadata`));
          if (snap.exists()) continue;
          try {
            await set(ref(db, `events/${candidate}/metadata`), {
              name: this.createEventName,
              creator: userName,
              creator_uid: this.uid,
              createdAt: Date.now(),
              lastActive: Date.now()
            });
            eventId = candidate;
            break;
          } catch (e) {
            continue;
          }
        }
        if (!eventId) {
          this.addNotification('No se pudo crear la sala. Intenta de nuevo.', 'error');
          return;
        }
        await set(ref(db, `events/${eventId}/members/${this.uid}`), { name: userName, joinedAt: Date.now() });
        await update(ref(db, `events/${eventId}/metadata/users`), { [userName]: this.uid });
        await set(ref(db, `events/${eventId}/data/people`), { [userName]: true });
        sessionStorage.setItem('dvdr_rooms_created', String(created + 1));
        this.joinEventId = eventId;
        this.createEventName = '';
        this.isJoining = false;
        await this.enterEvent();
      } catch (e) {
        this.addNotification('Error al crear evento', 'error');
      } finally {
        this.isJoining = false;
      }
    },

    async enterEvent() {
      if (this.isJoining) return;
      this.joinEventId = this.joinEventId.trim().toUpperCase();
      this.newUserName = this.newUserName.replace(/[.#$\[\]]/g, '').trim().substring(0, 30);
      if (!this.joinEventId || !this.newUserName) return this.addNotification('Rellena nombres válidos (sin . # $ [ ])', 'warning');
      if (!this.uid) return this.addNotification('Conectando de forma segura, intenta de nuevo...', 'warning');
      this.isJoining = true;
      const eventId = this.joinEventId;
      let userName = this.newUserName;

      try {
        const [metaSnap, peopleSnap] = await Promise.all([
          get(ref(db, `events/${eventId}/metadata`)),
          get(ref(db, `events/${eventId}/data/people`))
        ]);

        if (metaSnap.exists()) {
          // Limpiar listeners anteriores si había una sesión previa
          this._cleanupFirebaseListeners();

          const metadata = metaSnap.val();
          const peopleData = peopleSnap.val() || {};
          const peopleList = Array.isArray(peopleData) ? peopleData : Object.keys(peopleData);

          // Normalizar nombre del usuario: Priorizar capitalización de slot existente
          const matchingPerson = peopleList.find(p => p.toLowerCase() === userName.toLowerCase());
          if (matchingPerson) {
            userName = matchingPerson;
          }

          // Resolver rename pendiente (el usuario fue renombrado mientras estaba offline)
          const pendingRenames = metadata.renames || {};
          const originalName = userName;
          let hops = 0;
          while (pendingRenames[userName] && hops++ < 10) {
            userName = pendingRenames[userName];
          }
          if (userName !== originalName) {
            this.addNotification(`Tu nombre fue actualizado a "${userName}" mientras estabas desconectado.`, 'info');
            this.newUserName = userName;
          }

          this.eventCreator = metadata.creator;
          this.isOnline = true;
          this.eventId = eventId;
          this.eventName = metadata.name;
          this.currentUser = userName;
          this.showOnlineModal = false;
          window.history.pushState({}, '', `?e=${eventId}`);
          document.title = `DVDr - ${metadata.name} - ${eventId}`;

          this.lastUsers[eventId] = userName;
          this.saveData();

          this.people = [];
          this.transactions = [];

          if (metadata.creator_uid === this.uid) {
            this.confirmedAdmin = true;
          } else {
            this.confirmedAdmin = false;
          }

          await set(ref(db, `events/${eventId}/members/${this.uid}`), { name: userName, joinedAt: Date.now() });

          // Registrar usuario y limpiar renames consumidos en una sola operación
          const userUpdates = { [userName]: this.uid };
          if (userName !== originalName) { userUpdates[originalName] = null; }
          await update(ref(db, `events/${eventId}/metadata/users`), userUpdates);
          if (userName !== originalName) {
            // Limpiar todas las entradas de rename de la cadena
            const renameCleanup = {};
            let cleanName = originalName;
            let cleanHops = 0;
            while (pendingRenames[cleanName] && cleanHops++ < 10) {
              renameCleanup[cleanName] = null;
              cleanName = pendingRenames[cleanName];
            }
            await update(ref(db, `events/${eventId}/metadata/renames`), renameCleanup);
          }

          // Config presence
          const myPresenceRef = ref(db, `events/${eventId}/presence/${this.uid}`);
          onDisconnect(myPresenceRef).remove();
          set(myPresenceRef, userName);

          let initialPresenceLoaded = false;
          let presenceBuffer = { connected: [], disconnected: [] };
          let presenceTimeout = null;

          this._firebaseUnsubs.push(onValue(ref(db, `events/${eventId}/presence`), (res) => {
            const newPresence = res.exists() ? res.val() : {};
            if (initialPresenceLoaded) {
              const oldNames = this._presenceNameMap(this.onlinePresence);
              const newNames = this._presenceNameMap(newPresence);
              const connected = Object.keys(newNames).filter(u => !oldNames[u] && u !== this.currentUser);
              const disconnected = Object.keys(oldNames).filter(u => !newNames[u] && u !== this.currentUser);

              if (connected.length > 0 || disconnected.length > 0) {
                presenceBuffer.connected.push(...connected);
                presenceBuffer.disconnected.push(...disconnected);

                if (presenceTimeout) clearTimeout(presenceTimeout);

                presenceTimeout = setTimeout(() => {
                  const conns = [...new Set(presenceBuffer.connected)];
                  let disconns = [...new Set(presenceBuffer.disconnected)];
                  const renames = this.eventRenames || {};

                  // Revisamos los conectados para ver si coinciden con un cambio de nombre
                  conns.forEach(c => {
                    const oldName = Object.keys(renames).find(k => renames[k] === c);
                    if (oldName && disconns.includes(oldName)) {
                      // Es un cambio de nombre (se desconectó el viejo y se conectó el nuevo)
                      this.addNotification(`${oldName} cambió su nombre a ${c}`, 'info', 3000);
                      disconns = disconns.filter(d => d !== oldName); // Quitamos el aviso de desconexión
                      delete this.eventRenames[oldName]; // Limpiamos para evitar conflictos futuros
                    } else {
                      this.addNotification(`${c} se ha conectado`, 'info', 2000);
                    }
                  });

                  // Avisamos de los desconectados reales restantes
                  disconns.forEach(d => {
                    if (renames[d] === this.currentUser) {
                      // Si el admin cambió mi nombre, ignoro que mi nombre viejo se desconectó
                      delete this.eventRenames[d];
                    } else {
                      this.addNotification(`${d} se ha desconectado`, 'info', 2000);
                    }
                  });

                  // Vaciamos el búfer
                  presenceBuffer = { connected: [], disconnected: [] };
                }, 800); // 800ms de ventana para emparejar eventos simultáneos
              }
            }
            this.onlinePresence = newPresence;
            initialPresenceLoaded = true;
          }));

          this._firebaseUnsubs.push(onValue(ref(db, `events/${eventId}/metadata`), (res) => {
            if (!res.exists() && this.isOnline && this.eventId === eventId) {
              this.addNotification('El evento fue eliminado por el creador.', 'warning', 5000);
              this.disconnectOnline(true);
            } else if (res.exists()) {
              const md = res.val();
              this.eventName = md.name;
              this.claimedUsers = md.users || {};
              const renames = md.renames || {};

              // Almacenamos temporalmente los nombres cambiados para la lógica de presencia
              this.eventRenames = { ...(this.eventRenames || {}), ...renames };

              if (this.isOnline && this.currentUser && this.claimedUsers && !this.claimedUsers[this.currentUser]) {
                if (renames[this.currentUser]) {
                  const oldName = this.currentUser;
                  const newName = renames[oldName];
                  this.addNotification(`Tu nombre fue actualizado a ${newName}`, 'info');
                  this.currentUser = newName;
                  this.lastUsers[this.eventId] = newName;
                  this.saveData();

                  // Reconectar la presencia con el nuevo nombre y limpiar rename consumido
                  if (db && this.isFirebaseConnected && this.uid) {
                    const newPresenceRef = ref(db, `events/${this.eventId}/presence/${this.uid}`);
                    onDisconnect(newPresenceRef).remove();
                    set(newPresenceRef, newName);
                    update(ref(db, `events/${this.eventId}/metadata/renames`), { [oldName]: null });
                  }
                } else {
                  this.addNotification('Fuiste expulsado de la sala.', 'error', 5000);
                  this.disconnectOnline(true);
                }
              }
            }
          }));

          this._firebaseUnsubs.push(onValue(ref(db, `events/${eventId}/data`), (res) => {
            if (res.exists()) {
              const d = res.val();
              this.people = d.people ? (Array.isArray(d.people) ? d.people : Object.keys(d.people)) : [];
              this.transactions = d.transactions ? (Array.isArray(d.transactions) ? d.transactions : Object.values(d.transactions).sort((a, b) => a.id.toString().localeCompare(b.id.toString()))) : [];
              this.saveData();
            } else {
              if (this.isOnline && this.eventId === eventId) {
                this.people = []; this.transactions = []; this.saveData();
              }
            }
          }));

          setTimeout(() => {
            if (!this.people.includes(this.currentUser) && this.isFirebaseConnected) {
              this.updateRemote({ [`data/people/${this.currentUser}`]: true });
            }
          }, 800);

          this.addNotification('Conectado a la sala compartida.', 'success');
        } else {
          this.addNotification('El código no existe', 'warning');
        }
      } catch (e) {
        this.addNotification('Error de conexión a Firebase', 'error');
      } finally {
        this.isJoining = false;
      }
    },

    _cleanupFirebaseListeners() {
      this._firebaseUnsubs.forEach(unsub => { try { unsub(); } catch (e) { } });
      this._firebaseUnsubs = [];
    },

    disconnectOnline(forced = false) {
      const exitLogic = () => {
        this._cleanupFirebaseListeners();
        if (db && this.eventId && this.uid) {
          remove(ref(db, `events/${this.eventId}/presence/${this.uid}`));
        }
        this.isOnline = false;
        this.eventId = null;
        this.currentUser = null;
        this.eventCreator = null;
        this.confirmedAdmin = false;
        this.onlinePresence = {};
        this.eventRenames = {};
        window.history.pushState({}, '', window.location.pathname);
        document.title = 'DVDr - Calculadora de gastos compartidos';
        this.loadData();
        if (!forced) this.addNotification('Desconectado. Modo local restaurado.', 'info');
      };
      if (forced) { exitLogic(); return; }
      this.askConfirm({
        title: 'Desconectar de la sala',
        message: '¿Seguro que quieres salir de la sala compartida? Volverás al modo local.',
        confirmText: 'Salir',
        confirmClass: 'danger',
        onConfirm: exitLogic
      });
    },

    deleteOnlineEvent() {
      if (!this.isOnline || !this.isAdmin) return;
      this.askConfirm({
        title: 'Borrar evento online',
        message: '¿Seguro que quieres borrar esta sala para todos? No se puede deshacer.',
        confirmText: 'Borrar permanentemente',
        confirmClass: 'danger',
        onConfirm: async () => {
          try {
            const eventId = this.eventId;
            await update(ref(db, `events/${eventId}`), {
              metadata: null,
              data: null,
              presence: null,
              members: null,
              adminToken: null
            });
            this.disconnectOnline(true);
            this.addNotification('Evento eliminado permanentemente.', 'success');
          } catch (e) {
            console.error('Error eliminando evento:', e);
            this.addNotification('Error eliminando evento', 'error');
          }
        }
      });
    },

    // --- MÉTODOS DE DIVISIONES GUARDADAS ---
    saveToHistory() {
      const name = this.newHistoryName.trim();
      if (!name) return;
      if (this.people.length === 0) { return this.addNotification('Añade al menos una persona para poder guardar la división.', 'warning'); }
      const historyItem = { id: Date.now(), date: new Date().toISOString(), name: name, data: { people: JSON.parse(JSON.stringify(this.people)), transactions: JSON.parse(JSON.stringify(this.transactions)) }, eventId: this.isOnline ? this.eventId : null, eventUser: this.isOnline ? this.currentUser : null };
      this.history.unshift(historyItem);
      this.newHistoryName = '';
      this.saveData();
      this.addNotification(`'${name}' guardado en divisiones guardadas.`, 'success');
    },
    loadFromHistory(id) {
      const item = this.history.find(h => h.id === id);
      if (item) {
        if (item.eventId) {
          this.askConfirm({
            title: `Conectar a '${item.name}'`,
            message: `Esta historia está vinculada a una sala online. ¿Deseas reconectar?`,
            confirmText: 'Reconectar',
            onConfirm: async () => {
              try {
                const snap = await get(ref(db, `events/${item.eventId}/metadata`));
                if (snap.exists()) {
                  this.joinEventId = item.eventId;
                  this.newUserName = item.eventUser || 'Usuario';
                  this.enterEvent();
                } else {
                  this._loadLocalHistoryCopy(item, 'El evento online ya no existe. Se ha cargado la copia local.');
                }
              } catch (e) {
                this._loadLocalHistoryCopy(item, 'Error de conexión. Cargando copia local.');
              }
            }
          });
        } else {
          if (this.isOnline && !this.isAdmin) return this.addNotification('Solo el creador puede restaurar historias offline en la sala.', 'warning');
          this.askConfirm({
            title: `Cargar '${item.name}'`,
            message: `Se reemplazarán los datos actuales (personas y transacciones). ¿Deseas continuar?`,
            confirmText: 'Cargar',
            onConfirm: () => {
              this._loadLocalHistoryCopy(item, `'${item.name}' cargado.`);
            }
          });
        }
      }
    },
    _loadLocalHistoryCopy(item, msg) {
      this.people = JSON.parse(JSON.stringify(item.data.people));
      this.transactions = JSON.parse(JSON.stringify(item.data.transactions));
      this.cancelEditTransaction();
      this.saveData();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      this.addNotification(msg, 'success');
    },
    removeFromHistory(id) {
      const item = this.history.find(h => h.id === id);
      if (item) {
        this.askConfirm({
          title: `Eliminar '${item.name}'`,
          message: `¿Seguro que quieres eliminar esta división guardada?`,
          confirmText: 'Eliminar',
          confirmClass: 'danger',
          onConfirm: () => {
            this.history = this.history.filter(h => h.id !== id);
            this.saveData();
            this.addNotification(`'${item.name}' eliminado de divisiones guardadas.`, 'success');
          }
        });
      }
    },

    // --- MÉTODOS DE PERSONAS ---
    addPerson() {
      let name = this.newPersonName.trim();
      name = name.replace(/[.#$\[\]]/g, '').substring(0, 30);
      if (!name) return;
      const duplicate = this.people.find(p => p.toLowerCase() === name.toLowerCase());
      if (duplicate) {
        return this.addNotification(duplicate === name ? 'Esta persona ya existe.' : `Ya existe "${duplicate}" con un nombre similar.`, 'warning');
      }
      this.people = [...this.people, name];
      this.newPersonName = '';
      if (this.isOnline) { this.updateRemote({ [`data/people/${name}`]: true }); }
      this.saveData();
    },
    removePerson(name) {
      if (this.isOnline && this.claimedUsers[name] && name !== this.currentUser) {
        if (!this.isAdmin) {
          return this.addNotification('Solo el creador puede eliminar a un usuario en línea.', 'warning');
        }
      }
      this.askConfirm({
        title: `Eliminar a ${name}`,
        message: `¿Seguro que quieres eliminar a ${name}? Los gastos que pagó se borrarán, pero donde solo participó se recalcularán entre el resto.`,
        confirmText: 'Eliminar',
        confirmClass: 'danger',
        onConfirm: async () => {
          const removedTxs = [];
          const updatedTxs = [];
          this.people = this.people.filter(p => p !== name);
          this.transactions = this.transactions.filter(tx => {
            let keep = true;
            let modified = false;
            if (tx.type === 'expense') {
              if (tx.payer === name) {
                keep = false;
              } else {
                const shareIndex = tx.shares.findIndex(s => s.person === name);
                if (shareIndex !== -1) {
                  tx.shares.splice(shareIndex, 1);
                  modified = true;
                  if (tx.shares.length > 0) {
                    const sumRemaining = tx.shares.reduce((sum, s) => sum + s.amount, 0);
                    if (sumRemaining > 0) {
                      tx.shares.forEach(s => { s.amount = (s.amount / sumRemaining) * tx.amount; });
                    } else {
                      const equalPart = tx.amount / tx.shares.length;
                      tx.shares.forEach(s => { s.amount = equalPart; });
                    }
                  } else {
                    keep = false;
                  }
                }
              }
            } else if (tx.type === 'adjustment') {
              if (tx.beneficiary === name) {
                keep = false;
              } else {
                const contIndex = tx.contributors.indexOf(name);
                if (contIndex !== -1) {
                  tx.contributors.splice(contIndex, 1);
                  modified = true;
                  if (tx.contributors.length === 0) keep = false;
                }
              }
            } else if (tx.type === 'transfer') {
              if (tx.from === name || tx.to === name) {
                keep = false;
              }
            }

            if (!keep) removedTxs.push(tx.id);
            else if (modified) updatedTxs.push(tx);
            return keep;
          });

          if (this.isOnline) {
            const updates = { [`data/people/${name}`]: null };
            if (this.isAdmin && this.claimedUsers[name]) {
              const kickedUid = this.claimedUsers[name];
              updates[`metadata/users/${name}`] = null;
              if (typeof kickedUid === 'string') {
                updates[`members/${kickedUid}`] = null;
              }
            }
            if (name === this.currentUser) {
              updates[`metadata/users/${name}`] = null;
              if (this.uid) updates[`members/${this.uid}`] = null;
            }
            removedTxs.forEach(id => { updates[`data/transactions/${id}`] = null; });
            updatedTxs.forEach(tx => { updates[`data/transactions/${tx.id}`] = tx; });
            this.updateRemote(updates);
          }
          this.saveData();
          if (name === this.currentUser) {
            this.disconnectOnline(true);
          } else {
            this.addNotification(`${name} ha sido eliminado/a.`, 'success');
          }
        }
      });
    },
    startEditPerson(name) {
      if (this.isOnline && this.claimedUsers[name] && name !== this.currentUser && !this.isAdmin) {
        return this.addNotification('Solo el propio usuario o el creador pueden cambiar este nombre.', 'warning');
      }
      this.editingPerson.oldName = name; this.editingPerson.newName = name;
    },
    cancelEditPerson() { this.editingPerson.oldName = null; this.editingPerson.newName = ''; },
    async savePersonName(oldName) {
      let newName = this.editingPerson.newName.trim();
      newName = newName.replace(/[.#$\[\]]/g, '').substring(0, 30);
      if (!newName || newName === oldName) { this.cancelEditPerson(); return; }
      if (this.people.find(p => p.toLowerCase() === newName.toLowerCase() && p !== oldName)) {
        this.addNotification('Este nombre ya existe.', 'warning');
        return;
      }

      this.people = this.people.map(p => p === oldName ? newName : p);

      const updatedTxs = [];
      this.transactions.forEach(tx => {
        let changed = false;
        if (tx.type === 'expense') { if (tx.payer === oldName) { tx.payer = newName; changed = true; } tx.shares.forEach(s => { if (s.person === oldName) { s.person = newName; changed = true; } }); }
        if (tx.type === 'adjustment') { if (tx.beneficiary === oldName) { tx.beneficiary = newName; changed = true; } if (tx.contributors.includes(oldName)) { tx.contributors = tx.contributors.map(c => c === oldName ? newName : c); changed = true; } }
        if (tx.type === 'transfer') { if (tx.from === oldName) { tx.from = newName; changed = true; } if (tx.to === oldName) { tx.to = newName; changed = true; } }
        if (tx.addedBy === oldName) { tx.addedBy = newName; changed = true; }
        if (changed) updatedTxs.push(tx);
      });

      if (this.expenseForm.customSplit[oldName] !== undefined) {
        this.expenseForm.customSplit[newName] = this.expenseForm.customSplit[oldName];
      }

      if (this.isOnline) {
        const updates = { [`data/people/${oldName}`]: null, [`data/people/${newName}`]: true };
        if (this.claimedUsers[oldName]) {
          const memberUid = this.claimedUsers[oldName];
          updates[`metadata/users/${oldName}`] = null;
          updates[`metadata/users/${newName}`] = typeof memberUid === 'string' ? memberUid : this.uid;
          updates[`metadata/renames/${oldName}`] = newName;
        }
        updatedTxs.forEach(tx => { updates[`data/transactions/${tx.id}`] = tx; });

        if (this.eventCreator === oldName) {
          updates[`metadata/creator`] = newName;
          this.eventCreator = newName;
        }

        if (this.currentUser === oldName) {
          this.currentUser = newName;
          this.lastUsers[this.eventId] = newName;
          if (this.uid) {
            updates[`members/${this.uid}/name`] = newName;
            updates[`presence/${this.uid}`] = newName;
          }
        }

        this.updateRemote(updates);
      }
      this.saveData();
      this.cancelEditPerson();
    },

    // --- MÉTODOS DE TRANSACCIONES ---
    removeTransaction(id) {
      this.transactions = this.transactions.filter(tx => tx.id !== id);
      if (this.isOnline) { this.updateRemote({ [`data/transactions/${id}`]: null }); }
      this.saveData();
    },
    editTransaction(tx) {
      if (this.isMobile) {
        this.showMobileForm = true;
      } else {
        const card = this.$el.closest('.main-grid').querySelector('.right-column .card');
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      this.editingTransactionId = tx.id;
      this.activeTab = tx.type;
      if (tx.type === 'expense') { this.expenseForm = { description: tx.description, amount: tx.amount, payer: tx.payer, participants: tx.shares.map(s => s.person), splitType: 'equal', customSplit: {} }; }
      else if (tx.type === 'adjustment') { this.adjustmentForm = { description: tx.description, amount: tx.amount, beneficiary: tx.beneficiary, contributors: [...tx.contributors] }; }
      else if (tx.type === 'transfer') { this.transferForm = { from: tx.from, to: tx.to, amount: tx.amount }; }
    },
    cancelEditTransaction() { this.editingTransactionId = null; this.resetForm('expenseForm'); this.resetForm('adjustmentForm'); this.resetForm('transferForm'); },

    addExpense() {
      const { description, amount, payer, participants, splitType, customSplit } = this.expenseForm;
      if (!description || !amount || !payer || participants.length === 0) return this.addNotification('Completa todos los campos del gasto.', 'warning');

      let shares = [];
      if (splitType === 'equal') { shares = participants.map(p => ({ person: p, amount: amount / participants.length })); }
      else {
        const totalParts = Object.values(customSplit).reduce((sum, part) => sum + (part || 0), 0);
        if (totalParts <= 0) return this.addNotification('La suma de partes personalizadas debe ser mayor que cero.', 'warning');
        shares = participants.map(p => ({ person: p, amount: ((customSplit[p] || 0) / totalParts) * amount }));
      }

      if (this.editingTransactionId) {
        const txIndex = this.transactions.findIndex(t => t.id === this.editingTransactionId);
        if (txIndex > -1) {
          this.transactions[txIndex] = { ...this.transactions[txIndex], description, amount, payer, shares };
          if (this.isOnline) { this.updateRemote({ [`data/transactions/${this.editingTransactionId}`]: this.transactions[txIndex] }); }
        }
        this.cancelEditTransaction();
      } else {
        const newId = Date.now() + '-' + Math.random().toString(36).substring(2, 9);
        const newTx = { id: newId, type: 'expense', description, amount, payer, shares, addedBy: this.currentUser };
        this.transactions.push(newTx);
        if (this.isOnline) { this.updateRemote({ [`data/transactions/${newTx.id}`]: newTx }); }
        this.resetForm('expenseForm');
      }
      this.saveData();
      if (this.isMobile) { this.showMobileForm = false; this.mobileTab = 'historial'; }
    },
    _proceedWithAdjustment() {
      const { description, amount, beneficiary, contributors } = this.adjustmentForm;
      if (!description || !amount || !beneficiary || contributors.length === 0) return this.addNotification('Completa todos los campos del ajuste.', 'warning');

      const newTxData = { description, amount, beneficiary, contributors };
      if (this.editingTransactionId) {
        const txIndex = this.transactions.findIndex(t => t.id === this.editingTransactionId);
        if (txIndex > -1) {
          this.transactions[txIndex] = { ...this.transactions[txIndex], ...newTxData };
          if (this.isOnline) { this.updateRemote({ [`data/transactions/${this.editingTransactionId}`]: this.transactions[txIndex] }); }
        }
        this.cancelEditTransaction();
      } else {
        const newId = Date.now() + '-' + Math.random().toString(36).substring(2, 9);
        const newTx = { id: newId, type: 'adjustment', ...newTxData, addedBy: this.currentUser };
        this.transactions.push(newTx);
        if (this.isOnline) { this.updateRemote({ [`data/transactions/${newTx.id}`]: newTx }); }
        this.resetForm('adjustmentForm');
      }
      this.saveData();
      if (this.isMobile) { this.showMobileForm = false; this.mobileTab = 'historial'; }
    },
    addAdjustment() {
      const { beneficiary, contributors } = this.adjustmentForm;
      if (contributors.includes(beneficiary)) {
        this.askConfirm({
          title: 'Confirmación de ajuste', message: 'El beneficiario también está marcado como contribuyente. ¿Deseas continuar?',
          confirmText: 'Continuar', confirmClass: 'warning', onConfirm: () => this._proceedWithAdjustment()
        });
      } else { this._proceedWithAdjustment(); }
    },
    addTransfer() {
      const { from, to, amount } = this.transferForm;
      if (!from || !to || !amount) return this.addNotification('Completa todos los campos de la transferencia.', 'warning');
      if (from === to) return this.addNotification('Una persona no puede transferirse a sí misma.', 'warning');

      const newTxData = { from, to, amount, description: 'Transferencia' };
      if (this.editingTransactionId) {
        const txIndex = this.transactions.findIndex(t => t.id === this.editingTransactionId);
        if (txIndex > -1) {
          this.transactions[txIndex] = { ...this.transactions[txIndex], ...newTxData };
          if (this.isOnline) { this.updateRemote({ [`data/transactions/${this.editingTransactionId}`]: this.transactions[txIndex] }); }
        }
        this.cancelEditTransaction();
      } else {
        const newId = Date.now() + '-' + Math.random().toString(36).substring(2, 9);
        const newTx = { id: newId, type: 'transfer', ...newTxData, addedBy: this.currentUser };
        this.transactions.push(newTx);
        if (this.isOnline) { this.updateRemote({ [`data/transactions/${newTx.id}`]: newTx }); }
        this.resetForm('transferForm');
      }
      this.saveData();
      if (this.isMobile) { this.showMobileForm = false; this.mobileTab = 'historial'; }
    },

    resetForm(formName) {
      if (formName === 'expenseForm') this.expenseForm = { description: '', amount: null, payer: '', participants: [...this.people], splitType: 'equal', customSplit: {} };
      else if (formName === 'adjustmentForm') this.adjustmentForm = { description: '', amount: null, beneficiary: '', contributors: [...this.people] };
      else if (formName === 'transferForm') this.transferForm = { from: '', to: '', amount: null };
    },

    // --- MÉTODOS MOBILE ---
    setMobileTab(tab) {
      this.mobileTab = tab;
      this.showMobileForm = false;
      this.$nextTick(() => {
        document.querySelector('.mobile-scroll-area')?.scrollTo(0, 0);
      });
    },
    toggleMobileForm() {
      this.showMobileForm = !this.showMobileForm;
    },
    closeMobileForm() {
      this.showMobileForm = false;
      if (this.editingTransactionId) this.cancelEditTransaction();
    },

    async openChangelog() {
      this.changelog.show = true;
      // Si ya tenemos datos en memoria, no volver a pedir
      if (this.changelog.data.length > 0) return;
      this.changelog.loading = true;
      this.changelog.error = false;
      try {
        // Intentar obtener de sessionStorage primero
        const cached = sessionStorage.getItem('dvdr_releases');
        if (cached) {
          this.changelog.data = JSON.parse(cached);
          this.changelog.loading = false;
          return;
        }
        const response = await fetch('https://api.github.com/repos/CrysoK/DVDr/releases');
        if (!response.ok) throw new Error('Error al cargar releases');
        const data = await response.json();
        // Formatear datos para visualización simple
        this.changelog.data = data.map(release => ({
          tag: release.tag_name,
          date: new Date(release.created_at).toLocaleDateString(),
          name: release.name || release.tag_name,
          type: this.getReleaseType(release.tag_name),
          body: this.formatReleaseBody(release.body)
        }));
        sessionStorage.setItem('dvdr_releases', JSON.stringify(this.changelog.data));
      } catch (e) {
        console.error(e);
        this.changelog.error = true;
      } finally {
        this.changelog.loading = false;
      }
    },
    formatReleaseBody(markdown) {
      if (!markdown) return '';
      const escaped = markdown
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return escaped
        .replace(/### (.*)/g, '<strong>$1</strong>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/- (.*)/g, '• $1')
        .replace(/\r\n/g, '<br>')
        .replace(/\n/g, '<br>');
    },
    getReleaseType(tag) {
      const match = tag.match(/v?(\d+)\.(\d+)(?:\.(\d+))?/);
      if (!match) return 'patch';
      const minor = parseInt(match[2]);
      const patch = match[3] ? parseInt(match[3]) : 0;
      if (patch > 0) return 'patch';
      if (minor > 0) return 'minor';
      return 'major';
    },
    closeChangelog() {
      this.changelog.show = false;
    },

    // --- GETTERS (CÁLCULOS) ---
    get balances() {
      const balances = Object.fromEntries(this.people.map(p => [p, 0]));
      this.transactions.forEach(tx => {
        switch (tx.type) {
          case 'expense': balances[tx.payer] += tx.amount; tx.shares.forEach(share => { balances[share.person] -= share.amount; }); break;
          case 'adjustment': balances[tx.beneficiary] += tx.amount; const costPer = tx.amount / tx.contributors.length; tx.contributors.forEach(c => { balances[c] -= costPer; }); break;
          case 'transfer': balances[tx.from] += tx.amount; balances[tx.to] -= tx.amount; break;
        }
      });
      return balances;
    },
    get simplifiedDebts() {
      const balances = this.balances; const debtors = [], creditors = [];
      Object.keys(balances).forEach(p => {
        if (balances[p] < -0.01) debtors.push({ person: p, amount: -balances[p] });
        else if (balances[p] > 0.01) creditors.push({ person: p, amount: balances[p] });
      });
      const transactions = [];
      while (debtors.length > 0 && creditors.length > 0) {
        const debtor = debtors[0], creditor = creditors[0]; const amount = Math.min(debtor.amount, creditor.amount);
        transactions.push({ from: debtor.person, to: creditor.person, amount });
        debtor.amount -= amount; creditor.amount -= amount;
        if (debtor.amount < 0.01) debtors.shift();
        if (creditor.amount < 0.01) creditors.shift();
      }
      return transactions;
    },
    get totals() {
      const totalPaidNet = Object.fromEntries(this.people.map(p => [p, 0])); const totalShare = Object.fromEntries(this.people.map(p => [p, 0]));
      this.transactions.forEach(tx => {
        if (tx.type === 'expense') { totalPaidNet[tx.payer] += tx.amount; tx.shares.forEach(s => { totalShare[s.person] += s.amount; }); }
        if (tx.type === 'transfer') { totalPaidNet[tx.from] += tx.amount; totalPaidNet[tx.to] -= tx.amount; }
      });
      return { totalPaidNet, totalShare };
    },
    get customSplitTotal() { return Object.values(this.expenseForm.customSplit).reduce((sum, val) => sum + (val || 0), 0); },

    // --- SISTEMA DE MENSAJES ---
    addNotification(message, type = 'info', duration = 3500) {
      const id = Date.now() + Math.random();
      this.notifications.push({ id, message, type, visible: true });
      setTimeout(() => { this.removeNotification(id); }, duration);
    },
    removeNotification(id) {
      const notification = this.notifications.find(n => n.id === id);
      if (notification) {
        notification.visible = false;
        setTimeout(() => { this.notifications = this.notifications.filter(n => n.id !== id); }, 500);
      }
    },
    askConfirm({ title = '¿Estás seguro?', message, onConfirm, onCancel = () => { }, confirmText = 'Confirmar', cancelText = 'Cancelar', confirmClass = 'primary' }) {
      this.confirmation = { show: true, title, message, onConfirm: () => onConfirm(), onCancel: () => onCancel(), confirmText, cancelText, confirmClass };
    },
    handleConfirm() { this.confirmation.onConfirm(); this.resetConfirmation(); },
    handleCancel() { this.confirmation.onCancel(); this.resetConfirmation(); },
    resetConfirmation() { this.confirmation = { show: false, title: '', message: '', onConfirm: () => { }, onCancel: () => { }, confirmText: 'Confirmar', cancelText: 'Cancelar', confirmClass: 'primary' }; },

    // --- HELPERS Y ACCIONES DE COPIADO ---
    formatAmount(amount) { return (amount || 0).toFixed(2); },
    formatDate(isoString) { return new Date(isoString).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }); },
    getUniqueAbbreviations(names) {
      const result = {};
      for (let i = 0; i < names.length; i++) {
        let name = names[i];
        let len = 1;
        let isUnique = false;
        while (!isUnique && len <= name.length) {
          let abbr = name.substring(0, len);
          isUnique = true;
          for (let j = 0; j < names.length; j++) {
            if (i === j) continue;
            if (names[j].toLowerCase().startsWith(abbr.toLowerCase())) {
              isUnique = false;
              break;
            }
          }
          if (!isUnique) len++;
          else result[name] = abbr;
        }
        if (!isUnique) result[name] = name;
      }
      return result;
    },
    copyShortSummary() {
      if (this.people.length === 0) return this.addNotification("Añade personas y gastos primero.", 'info');
      let summary = "💰 *Resumen de deudas - DVDr*\n";
      if (this.isOnline) summary += `Sala: *${this.eventName}*\n`;
      summary += "\n";
      if (this.simplifiedDebts.length > 0) {
        this.simplifiedDebts.forEach(debt => {
          summary += `- *${debt.from}* ➡️ *${debt.to}*: *$${this.formatAmount(debt.amount)}*\n`;
        });
      } else {
        summary += "✅ ¡Todo saldado! No hay deudas pendientes.\n";
      }
      summary += "\nGenerado con dvdr.vercel.app";
      navigator.clipboard.writeText(summary);
      this.addNotification('¡Resumen para WhatsApp copiado!', 'success');
    },
    copyDetailedSummary() {
      if (this.people.length === 0) return this.addNotification("Añade personas y gastos primero.", 'info');
      let summary = "📊 *Resumen detallado - DVDr*\n";
      if (this.isOnline) summary += `Sala: *${this.eventName}*\n`;
      summary += "\n🤝 *¿QUIÉN PAGA A QUIÉN?*\n";
      if (this.simplifiedDebts.length > 0) {
        this.simplifiedDebts.forEach(debt => {
          summary += `- *${debt.from}* debe pagar a *${debt.to}*: *$${this.formatAmount(debt.amount)}*\n`;
        });
      } else {
        summary += "- ¡Todos están a mano!\n";
      }

      const abbrs = this.getUniqueAbbreviations(this.people);
      summary += "\n📝 *LISTA DE TRANSACCIONES*\n";
      this.transactions.slice().reverse().forEach(tx => {
        const amount = `*$${this.formatAmount(tx.amount)}*`;
        if (tx.type === 'expense') {
          const participants = tx.shares.map(s => s.person);
          const partsStr = participants.length === this.people.length ? "Todos" : participants.map(p => abbrs[p]).join(',');
          summary += `- *${tx.description}*: ${amount} (Pagó *${tx.payer}* | ${partsStr})\n`;
        }
        if (tx.type === 'adjustment') {
          const contributors = tx.contributors;
          const partsStr = contributors.length === this.people.length ? "Todos" : contributors.map(p => abbrs[p]).join(',');
          summary += `- *${tx.description}*: ${amount} (Para *${tx.beneficiary}* | ${partsStr})\n`;
        }
        if (tx.type === 'transfer') summary += `- *${tx.from}* envió ${amount} a *${tx.to}*\n`;
      });
      summary += "\nGenerado con dvdr.vercel.app";
      navigator.clipboard.writeText(summary);
      this.addNotification('¡Resumen detallado copiado!', 'success');
    },
    generateShareLink() {
      if (this.people.length === 0 && this.transactions.length === 0) return this.addNotification("Añade datos antes de compartir.", 'info');

      if (this.isOnline) {
        this.addNotification('Sugerencia: Usa el enlace de la sala (arriba) para colaboración en tiempo real.', 'info', 5000);
      }

      const dataToShare = { version: this.version, people: this.people, transactions: this.transactions, history: this.history };
      const jsonStr = JSON.stringify(dataToShare);
      const base64Data = btoa(unescape(encodeURIComponent(jsonStr)));
      const url = `${window.location.origin}${window.location.pathname}#${base64Data}`;

      if (url.length > 2000) {
        this.addNotification('Advertencia: El enlace es muy largo y podría no funcionar en algunos servicios de mensajería.', 'warning', 5000);
      }

      navigator.clipboard.writeText(url);
      this.addNotification('¡Enlace de respaldo (snapshot) copiado!', 'success');
    },
    copyOnlineLink() {
      if (!this.eventId) return;
      const url = `${window.location.origin}${window.location.pathname}?e=${this.eventId}`;
      navigator.clipboard.writeText(url);
      this.addNotification('¡Enlace de la sala copiado!', 'success');
    },
    copyPersonLink(name) {
      if (!this.eventId) return;
      const url = `${window.location.origin}${window.location.pathname}?e=${this.eventId}&u=${encodeURIComponent(name)}`;
      navigator.clipboard.writeText(url);
      this.addNotification(`¡Invitación directa para ${name} copiada!`, 'success');
    }
  }
});
Alpine.store('__dbAvailable', !!db);
Alpine.start();
