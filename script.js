function app() {
  const APP_VERSION = '1.1.0';
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
    people: [],
    transactions: [],
    history: [],
    newPersonName: '',
    newHistoryName: '',
    activeTab: 'expense',
    notifications: [],
    confirmation: {
      show: false, title: '', message: '', onConfirm: () => { }, onCancel: () => { }, confirmText: 'Confirmar', cancelText: 'Cancelar', confirmClass: 'primary'
    },

    editingPerson: { oldName: null, newName: '' },
    editingTransactionId: null,

    expenseForm: { description: '', amount: null, payer: '', participants: [], splitType: 'equal', customSplit: {}, },
    adjustmentForm: { description: '', amount: null, beneficiary: '', contributors: [], },
    transferForm: { from: '', to: '', amount: null, },

    init() {
      this.loadData();
      this.$watch('people', () => {
        if (this.editingTransactionId) return;
        this.expenseForm.participants = [...this.people];
        this.adjustmentForm.contributors = [...this.people];
      });
    },

    saveData() {
      const data = { version: this.version, people: this.people, transactions: this.transactions, history: this.history };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    },
    loadData() {
      let data = null;
      if (window.location.hash) {
        try {
          const jsonData = atob(window.location.hash.substring(1));
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
          this.addNotification('Tus datos se han actualizado a la nueva versión.', 'info', 5000);
        }
        this.people = data.people || [];
        this.transactions = data.transactions || [];
        this.history = data.history || [];
        this.saveData();
      }
    },
    clearCurrentDivision() {
      this.askConfirm({
        title: 'Limpiar división actual',
        message: 'Esto borrará las personas y transacciones de la sesión actual (sin afectar al historial guardado). ¿Deseas continuar?',
        confirmText: 'Sí, limpiar',
        confirmClass: 'warning',
        onConfirm: () => {
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

    // --- MÉTODOS DE HISTORIAL ---
    saveToHistory() {
      const name = this.newHistoryName.trim();
      if (!name) return;
      if (this.people.length === 0) { return this.addNotification('Añade al menos una persona para poder guardar la división.', 'warning'); }
      const historyItem = { id: Date.now(), date: new Date().toISOString(), name: name, data: { people: JSON.parse(JSON.stringify(this.people)), transactions: JSON.parse(JSON.stringify(this.transactions)) } };
      this.history.unshift(historyItem);
      this.newHistoryName = '';
      this.saveData();
      this.addNotification(`'${name}' guardado en el historial.`, 'success');
    },
    loadFromHistory(id) {
      const item = this.history.find(h => h.id === id);
      if (item) {
        this.askConfirm({
          title: `Cargar '${item.name}'`,
          message: `Se reemplazarán los datos actuales (personas y transacciones). ¿Deseas continuar?`,
          confirmText: 'Cargar',
          onConfirm: () => {
            this.people = JSON.parse(JSON.stringify(item.data.people));
            this.transactions = JSON.parse(JSON.stringify(item.data.transactions));
            this.cancelEditTransaction();
            window.scrollTo({ top: 0, behavior: 'smooth' });
            this.addNotification(`'${item.name}' cargado.`, 'success');
          }
        });
      }
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
      const name = this.newPersonName.trim();
      if (name && !this.people.includes(name)) {
        this.people.push(name);
        this.newPersonName = '';
        this.saveData();
      } else if (this.people.includes(name)) { this.addNotification('Esta persona ya existe.', 'warning'); }
    },
    removePerson(name) {
      this.askConfirm({
        title: `Eliminar a ${name}`,
        message: `¿Seguro que quieres eliminar a ${name}? Se borrarán todas sus transacciones asociadas.`,
        confirmText: 'Eliminar',
        confirmClass: 'danger',
        onConfirm: () => {
          this.people = this.people.filter(p => p !== name);
          this.transactions = this.transactions.filter(tx => {
            switch (tx.type) {
              case 'expense': return tx.payer !== name && !tx.shares.some(s => s.person === name);
              case 'adjustment': return tx.beneficiary !== name && !tx.contributors.includes(name);
              case 'transfer': return tx.from !== name && tx.to !== name;
              default: return true;
            }
          });
          this.saveData();
          this.addNotification(`${name} ha sido eliminado/a.`, 'success');
        }
      });
    },
    startEditPerson(name) { this.editingPerson.oldName = name; this.editingPerson.newName = name; },
    cancelEditPerson() { this.editingPerson.oldName = null; this.editingPerson.newName = ''; },
    savePersonName(oldName) {
      const newName = this.editingPerson.newName.trim();
      if (!newName || newName === oldName) { this.cancelEditPerson(); return; }
      if (this.people.includes(newName)) { this.addNotification('Este nombre ya existe.', 'warning'); return; }

      const personIndex = this.people.findIndex(p => p === oldName);
      if (personIndex > -1) this.people[personIndex] = newName;

      this.transactions.forEach(tx => {
        if (tx.type === 'expense') { if (tx.payer === oldName) tx.payer = newName; tx.shares.forEach(s => { if (s.person === oldName) s.person = newName; }); }
        if (tx.type === 'adjustment') { if (tx.beneficiary === oldName) tx.beneficiary = newName; tx.contributors = tx.contributors.map(c => c === oldName ? newName : c); }
        if (tx.type === 'transfer') { if (tx.from === oldName) tx.from = newName; if (tx.to === oldName) tx.to = newName; }
      });
      this.saveData();
      this.cancelEditPerson();
    },

    // --- MÉTODOS DE TRANSACCIONES ---
    removeTransaction(id) {
      this.transactions = this.transactions.filter(tx => tx.id !== id);
      this.saveData();
    },
    editTransaction(tx) {
      const card = this.$el.closest('.main-grid').querySelector('.right-column .card');
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
        if (txIndex > -1) { this.transactions[txIndex] = { ...this.transactions[txIndex], description, amount, payer, shares }; }
        this.cancelEditTransaction();
      } else {
        this.transactions.push({ id: Date.now(), type: 'expense', description, amount, payer, shares });
        this.resetForm('expenseForm');
      }
      this.saveData();
    },
    _proceedWithAdjustment() {
      const { description, amount, beneficiary, contributors } = this.adjustmentForm;
      if (!description || !amount || !beneficiary || contributors.length === 0) return this.addNotification('Completa todos los campos del ajuste.', 'warning');

      const newTxData = { description, amount, beneficiary, contributors };
      if (this.editingTransactionId) {
        const txIndex = this.transactions.findIndex(t => t.id === this.editingTransactionId);
        if (txIndex > -1) { this.transactions[txIndex] = { ...this.transactions[txIndex], ...newTxData }; }
        this.cancelEditTransaction();
      } else {
        this.transactions.push({ id: Date.now(), type: 'adjustment', ...newTxData });
        this.resetForm('adjustmentForm');
      }
      this.saveData();
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
        if (txIndex > -1) { this.transactions[txIndex] = { ...this.transactions[txIndex], ...newTxData }; }
        this.cancelEditTransaction();
      } else {
        this.transactions.push({ id: Date.now(), type: 'transfer', ...newTxData });
        this.resetForm('transferForm');
      }
      this.saveData();
    },

    resetForm(formName) {
      if (formName === 'expenseForm') this.expenseForm = { description: '', amount: null, payer: '', participants: [...this.people], splitType: 'equal', customSplit: {} };
      else if (formName === 'adjustmentForm') this.adjustmentForm = { description: '', amount: null, beneficiary: '', contributors: [...this.people] };
      else if (formName === 'transferForm') this.transferForm = { from: '', to: '', amount: null };
    },

    // --- GETTERS (CÁLCULOS) ---
    get balances() {
      const balances = Object.fromEntries(this.people.map(p => [p, 0]));
      this.transactions.forEach(tx => {
        switch (tx.type) {
          case 'expense': balances[tx.payer] += tx.amount; tx.shares.forEach(share => { balances[share.person] -= share.amount; }); break;
          case 'adjustment': balances[tx.beneficiary] += tx.amount; const costPer = tx.amount / tx.contributors.length; tx.contributors.forEach(c => { balances[c] -= costPer; }); break;
          case 'transfer': balances[tx.from] -= tx.amount; balances[tx.to] += tx.amount; break;
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
      const base64Data = btoa(JSON.stringify(dataToShare));
      const url = `${window.location.origin}${window.location.pathname}#${base64Data}`;
      navigator.clipboard.writeText(url); this.addNotification('¡Enlace para compartir copiado!', 'success');
    }
  }
}
