import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js';
import { getDatabase, ref, set, get, onValue, remove, update, onDisconnect, query, orderByChild, endAt } from 'https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js';
import Alpine from 'https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/module.esm.js';

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
let firebaseInitError = false;
try {
  const app = initializeApp(firebaseConfig);
  db = getDatabase(app);
} catch (e) {
  console.warn("Firebase no está configurado.");
  firebaseInitError = true;
}

Alpine.data('app', function () {
  const APP_VERSION = '2.0.1';
  const STORAGE_KEY = 'dvd_data';

  const MIGRATIONS = {
    '1.1.0': (data) => {
      if (!data.hasOwnProperty('history')) { data.history = []; }
      return data;
    }
  };

  function runMigrations(data) {
    let currentData = { ...data };
    let dataVersion = currentData.version;
    if (!dataVersion) return currentData;
    const migrationTargets = Object.keys(MIGRATIONS).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    for (const targetVersion of migrationTargets) {
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
    isFirebaseConnected: true,
    confirmedAdmin: false,
    onlinePresence: {},
    _firebaseUnsubs: [],
    isJoining: false,
    get isAdmin() {
      if (!this.eventId || !this.isOnline) return false;
      return this.confirmedAdmin;
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

      if (firebaseInitError) {
        this.addNotification('No se pudo conectar con Firebase. El modo online no estará disponible.', 'error', 6000);
      }
      if (db) {
        onValue(ref(db, '.info/connected'), (snap) => {
          this.isFirebaseConnected = snap.val() === true;
          if (this.isFirebaseConnected && this.isOnline && this.eventId && this.currentUser) {
            const myPresenceRef = ref(db, `events/${this.eventId}/presence/${this.currentUser}`);
            onDisconnect(myPresenceRef).remove();
            set(myPresenceRef, true);
          }
        });
        this.cleanupOldRooms();
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
          const savedUser = localStorage.getItem('dvdr_last_user_' + this.joinEventId);
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
    cleanupOldRooms() {
      if (!db) return;
      // Throttle: solo limpiar una vez por sesión
      if (sessionStorage.getItem('dvdr_cleanup_done')) return;
      sessionStorage.setItem('dvdr_cleanup_done', '1');
      const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      get(query(ref(db, 'events'), orderByChild('metadata/lastActive'), endAt(oneWeekAgo))).then(snap => {
        if (snap.exists()) {
          snap.forEach(child => {
            const md = child.val().metadata;
            if (md && md.lastActive && md.lastActive <= oneWeekAgo) {
              remove(ref(db, `events/${child.key}`));
            }
          });
        }
      }).catch(e => console.warn("Error cleaning old rooms", e));
    },
    async updateRemote(updates) {
      if (this.isOnline && db && this.eventId) {
        updates['metadata/lastActive'] = Date.now();
        try { await update(ref(db, `events/${this.eventId}`), updates); } catch (e) { console.error("Error sync", e); }
      }
    },
    saveData() {
      const data = { version: this.version, people: this.people, transactions: this.transactions, history: this.history };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    },
    loadData() {
      let data = null;
      if (window.location.hash) {
        try {
          const jsonData = decodeURIComponent(escape(atob(window.location.hash.substring(1))));
          const parsed = JSON.parse(jsonData);
          if (parsed && parsed.version && Array.isArray(parsed.people)) data = parsed;
          else this.addNotification("El enlace para compartir es de una versión antigua o está corrupto.", 'error', 5000);
        } catch (e) {
          console.error("Error al cargar datos desde la URL", e);
          this.addNotification("El enlace para compartir es inválido o está corrupto.", 'error', 5000);
        } finally {
          history.pushState("", document.title, window.location.pathname);
        }
      }
      if (!data) {
        const savedData = localStorage.getItem(STORAGE_KEY);
        if (savedData) {
          try {
            const parsed = JSON.parse(savedData);
            if (parsed && parsed.version) data = parsed;
          } catch (e) { console.error("Error al parsear datos de localStorage", e); localStorage.removeItem(STORAGE_KEY); }
        }
      }
      if (data) {
        if (data.version.localeCompare(this.version, undefined, { numeric: true }) < 0) {
          data = runMigrations(data);
          this.addNotification(`¡DVDr actualizado a v${this.version}!`, 'success', 4000);
          setTimeout(() => {
            this.openChangelog();
          }, 500);
        }
        this.people = data.people || [];
        this.transactions = data.transactions || [];
        this.history = data.history || [];
        this.saveData();
      }
    },
    clearCurrentDivision() {
      if (this.isOnline && !this.isAdmin) return this.addNotification('Solo el creador del evento puede limpiar la división.', 'warning');
      this.askConfirm({
        title: 'Limpiar división actual',
        message: 'Esto borrará las personas y transacciones de la sesión actual (sin afectar al historial guardado). ¿Deseas continuar?',
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
        message: '¿Seguro que quieres borrar TODOS los datos? Esto incluye personas, transacciones y el historial guardado. Esta acción no se puede deshacer.',
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
        this.addNotification('⚡ Datos de demostración cargados.', 'success');
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

    openOnlineModal() { this.showOnlineModal = true; },
    closeOnlineModal() { if (!this.isOnline) this.showOnlineModal = false; },

    async createEvent() {
      if (this.isJoining) return;
      this.createEventName = this.createEventName.replace(/[.#$\[\]]/g, '').trim().substring(0, 40);
      this.newUserName = this.newUserName.replace(/[.#$\[\]]/g, '').trim().substring(0, 30);
      if (!this.createEventName || !this.newUserName) return this.addNotification('Ingresa nombres válidos (sin . # $ [ ])', 'warning');
      // Rate limit: máximo 3 salas por sesión
      const created = parseInt(sessionStorage.getItem('dvdr_rooms_created') || '0');
      if (created >= 3) return this.addNotification('Has creado demasiadas salas en esta sesión. Recarga la página si necesitas crear más.', 'warning');
      this.isJoining = true;
      const eventId = Math.random().toString(36).substring(2, 8).toUpperCase();
      try {
        const adminToken = Math.random().toString(36).substring(2, 15);
        const userName = this.newUserName;
        await set(ref(db, `events/${eventId}/metadata`), { name: this.createEventName, creator: userName, createdAt: Date.now(), lastActive: Date.now() });
        await set(ref(db, `events/${eventId}/adminToken`), { token: adminToken });
        await update(ref(db, `events/${eventId}/metadata/users`), { [userName]: true });
        await set(ref(db, `events/${eventId}/data/people`), { [userName]: true });
        const myAdminKeys = JSON.parse(localStorage.getItem('dvdr_admin_keys') || '{}');
        myAdminKeys[eventId] = adminToken;
        localStorage.setItem('dvdr_admin_keys', JSON.stringify(myAdminKeys));
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
      this.isJoining = true;
      const eventId = this.joinEventId;
      let userName = this.newUserName;

      try {
        const snap = await get(ref(db, `events/${eventId}/metadata`));
        if (snap.exists()) {
          // Limpiar listeners anteriores si había una sesión previa
          this._cleanupFirebaseListeners();

          const metadata = snap.val();

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
          document.title = `Dvdr - Sala ${eventId}`;

          localStorage.setItem('dvdr_last_user_' + eventId, userName);

          this.people = [];
          this.transactions = [];

          // Verify admin: el token ya no es legible por rules, solo validamos con clave local
          const myAdminKeys = JSON.parse(localStorage.getItem('dvdr_admin_keys') || '{}');
          this.confirmedAdmin = !!myAdminKeys[eventId];

          // Registrar usuario y limpiar renames consumidos en una sola operación
          const userUpdates = { [userName]: true };
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
          const myPresenceRef = ref(db, `events/${eventId}/presence/${userName}`);
          onDisconnect(myPresenceRef).remove();
          set(myPresenceRef, true);

          let initialPresenceLoaded = false;
          this._firebaseUnsubs.push(onValue(ref(db, `events/${eventId}/presence`), (res) => {
            const newPresence = res.exists() ? res.val() : {};
            if (initialPresenceLoaded) {
              Object.keys(newPresence).forEach(u => {
                if (!this.onlinePresence[u] && u !== this.currentUser) {
                  this.addNotification(`${u} se ha conectado`, 'info', 2000);
                }
              });
              Object.keys(this.onlinePresence).forEach(u => {
                if (!newPresence[u] && u !== this.currentUser) {
                  this.addNotification(`${u} se ha desconectado`, 'info', 2000);
                }
              });
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

              if (this.isOnline && this.currentUser && this.claimedUsers && !this.claimedUsers[this.currentUser]) {
                if (renames[this.currentUser]) {
                  const oldName = this.currentUser;
                  const newName = renames[oldName];
                  this.addNotification(`Tu nombre fue actualizado a ${newName}`, 'info');
                  this.currentUser = newName;
                  localStorage.setItem('dvdr_last_user_' + this.eventId, newName);

                  // Reconectar la presencia con el nuevo nombre y limpiar rename consumido
                  if (db && this.isFirebaseConnected) {
                    const newPresenceRef = ref(db, `events/${this.eventId}/presence/${newName}`);
                    onDisconnect(newPresenceRef).remove();
                    set(newPresenceRef, true);
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

          this.addNotification('Conectado a la sala compartida 🟢', 'success');
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
        if (db && this.eventId && this.currentUser) {
          remove(ref(db, `events/${this.eventId}/presence/${this.currentUser}`));
        }
        this.isOnline = false;
        this.eventId = null;
        this.currentUser = null;
        this.eventCreator = null;
        this.confirmedAdmin = false;
        this.onlinePresence = {};
        window.history.pushState({}, '', window.location.pathname);
        document.title = 'DVDr - Calculadora de gastos compartidos';
        this.loadData();
        if (!forced) this.addNotification('Desconectado. 🔴 Modo local restaurado.', 'info');
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
            // Delete child nodes individually to comply with Firebase rules
            // (adminToken has restrictive write rules that block full-node removal)
            await Promise.all([
              remove(ref(db, `events/${eventId}/metadata`)),
              remove(ref(db, `events/${eventId}/data`)),
              remove(ref(db, `events/${eventId}/presence`)),
            ]);
            this.disconnectOnline(true);
            this.addNotification('Evento eliminado permanentemente.', 'success');
          } catch (e) {
            console.error('Error eliminando evento:', e);
            this.addNotification('Error eliminando evento', 'error');
          }
        }
      });
    },

    // --- MÉTODOS DE HISTORIAL ---
    saveToHistory() {
      const name = this.newHistoryName.trim();
      if (!name) return;
      if (this.people.length === 0) { return this.addNotification('Añade al menos una persona para poder guardar la división.', 'warning'); }
      const historyItem = { id: Date.now(), date: new Date().toISOString(), name: name, data: { people: JSON.parse(JSON.stringify(this.people)), transactions: JSON.parse(JSON.stringify(this.transactions)) }, eventId: this.isOnline ? this.eventId : null, eventUser: this.isOnline ? this.currentUser : null };
      this.history.unshift(historyItem);
      this.newHistoryName = '';
      this.saveData();
      this.addNotification(`'${name}' guardado en el historial.`, 'success');
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
          message: `¿Seguro que quieres eliminar esta entrada del historial?`,
          confirmText: 'Eliminar',
          confirmClass: 'danger',
          onConfirm: () => {
            this.history = this.history.filter(h => h.id !== id);
            this.saveData();
            this.addNotification(`'${item.name}' eliminado del historial.`, 'success');
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
        message: `¿Seguro que quieres eliminar a ${name}? Se borrarán todas sus transacciones asociadas.`,
        confirmText: 'Eliminar',
        confirmClass: 'danger',
        onConfirm: async () => {
          const removedTxs = [];
          this.people = this.people.filter(p => p !== name);
          this.transactions = this.transactions.filter(tx => {
            let keep = true;
            switch (tx.type) {
              case 'expense': keep = tx.payer !== name && !tx.shares.some(s => s.person === name); break;
              case 'adjustment': keep = tx.beneficiary !== name && !tx.contributors.includes(name); break;
              case 'transfer': keep = tx.from !== name && tx.to !== name; break;
              default: keep = true;
            }
            if (!keep) removedTxs.push(tx.id);
            return keep;
          });

          if (this.isOnline) {
            const updates = { [`data/people/${name}`]: null };
            if (this.isAdmin && this.claimedUsers[name]) { updates[`metadata/users/${name}`] = null; }
            if (name === this.currentUser) { updates[`metadata/users/${name}`] = null; }
            removedTxs.forEach(id => { updates[`data/transactions/${id}`] = null; });
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
      if (this.people.includes(newName)) { this.addNotification('Este nombre ya existe.', 'warning'); return; }

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
          updates[`metadata/users/${oldName}`] = null;
          updates[`metadata/users/${newName}`] = true;
          updates[`metadata/renames/${oldName}`] = newName;
        }
        updatedTxs.forEach(tx => { updates[`data/transactions/${tx.id}`] = tx; });

        if (this.eventCreator === oldName) {
          updates[`metadata/creator`] = newName;
          this.eventCreator = newName;
        }

        if (this.currentUser === oldName) {
          this.currentUser = newName;
          localStorage.setItem('dvdr_last_user_' + this.eventId, newName);
          if (db && this.isFirebaseConnected) {
            const oldPresenceRef = ref(db, `events/${this.eventId}/presence/${oldName}`);
            await onDisconnect(oldPresenceRef).cancel();
            await remove(oldPresenceRef);

            const newPresenceRef = ref(db, `events/${this.eventId}/presence/${newName}`);
            await onDisconnect(newPresenceRef).remove();
            set(newPresenceRef, true);
          }
        } else if (db && this.isFirebaseConnected) {
          // Limpiar presencia vieja del usuario renombrado
          remove(ref(db, `events/${this.eventId}/presence/${oldName}`));
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
      // Limpieza básica de Markdown para HTML seguro
      let html = markdown
        .replace(/### (.*)/g, '<strong>$1</strong>') // Headers h3
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') // Bold
        .replace(/`([^`]+)`/g, '<code>$1</code>') // Code inline
        .replace(/- (.*)/g, '• $1') // List items
        .replace(/\r\n/g, '<br>') // Line breaks
        .replace(/\n/g, '<br>'); // Line breaks
      return html;
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
      const id = Date.now();
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
    copyShortSummary() {
      if (this.people.length === 0) return this.addNotification("Añade personas y gastos primero.", 'info');
      let summary = "Resumen de deudas 💸\n------------------------\n\n";
      if (this.simplifiedDebts.length > 0) {
        summary += "Para quedar a mano:\n"; this.simplifiedDebts.forEach(debt => { summary += `• ${debt.from} ➡️ ${debt.to}:  ${this.formatAmount(debt.amount)}\n`; });
      } else { summary += "¡Todo saldado! ✅ No hay deudas pendientes.\n"; }
      navigator.clipboard.writeText(summary); this.addNotification('¡Resumen corto copiado!', 'success');
    },
    copyDetailedSummary() {
      if (this.people.length === 0) return this.addNotification("Añade personas y gastos primero.", 'info');
      let summary = "📊 Resumen detallado de gastos 📊\n===============================\n\n✅ ¿QUIÉN PAGA A QUIÉN?\n";
      if (this.simplifiedDebts.length > 0) { this.simplifiedDebts.forEach(debt => { summary += `- ${debt.from} debe pagar a ${debt.to}: ${this.formatAmount(debt.amount)}\n`; }); }
      else { summary += "- ¡Todos están a mano! No hay deudas.\n"; }
      summary += "\n📋 HISTORIAL COMPLETO\n";
      this.transactions.forEach(tx => {
        if (tx.type === 'expense') summary += `- Gasto: ${tx.description} (${this.formatAmount(tx.amount)}) pagado por ${tx.payer}\n`;
        if (tx.type === 'adjustment') summary += `- Ajuste: ${tx.description} (${this.formatAmount(tx.amount)}) a favor de ${tx.beneficiary}\n`;
        if (tx.type === 'transfer') summary += `- Transferencia: ${tx.from} envió ${this.formatAmount(tx.amount)} a ${tx.to}\n`;
      });
      navigator.clipboard.writeText(summary); this.addNotification('¡Resumen detallado copiado!', 'success');
    },
    generateShareLink() {
      if (this.people.length === 0 && this.transactions.length === 0) return this.addNotification("Añade datos antes de compartir.", 'info');
      const dataToShare = { version: this.version, people: this.people, transactions: this.transactions, history: this.history };
      const jsonStr = JSON.stringify(dataToShare);
      const base64Data = btoa(unescape(encodeURIComponent(jsonStr)));
      const url = `${window.location.origin}${window.location.pathname}#${base64Data}`;
      if (url.length > 2000) {
        this.addNotification('Advertencia: El enlace es muy largo y podría no funcionar en algunos servicios de mensajería.', 'warning', 5000);
      }
      navigator.clipboard.writeText(url); this.addNotification('¡Enlace para compartir copiado!', 'success');
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
