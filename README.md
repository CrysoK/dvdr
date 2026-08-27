# 💸 DVDr - Calculadora de gastos compartidos

DVDr es una herramienta web simple, gratuita y de código abierto para calcular y
dividir gastos compartidos entre amigos, familiares o compañeros de viaje.
Registra quién pagó qué y salda las deudas fácilmente, todo sin necesidad de
crear una cuenta.

## ✨ Características principales

* **Sin cuentas, sin servidores:** Todo se ejecuta en tu navegador y los datos
  se guardan localmente.
* **Gestión de personas:** Añade, edita y elimina participantes fácilmente.
* **Registro flexible de transacciones:**
  * **Gastos:** Con división a partes iguales o personalizadas.
  * **Ajustes:** Para premios, multas o bonificaciones.
  * **Transferencias:** Para registrar pagos directos entre personas.
* **Cálculo automático:** Obtén un resumen simplificado de quién debe pagar a
  quién.
* **Divisiones guardadas y persistencia:** Guarda tus divisiones para más tarde y cárgalas
  cuando las necesites.
* **Comparte fácilmente:** Genera un enlace único para compartir el estado
  actual de la división con otros.

### 🌐 Salas colaborativas en tiempo real

* **Crea o únete a una sala:** Trabaja en la misma división con otras personas
  en tiempo real usando Firebase Realtime Database.
* **Presencia en línea:** Ve quién está conectado con indicadores de estado
  (🟢 online / ⚪ offline).
* **Roles:** El creador de la sala tiene permisos de administrador (👑) para
  gestionar participantes y datos.
* **Invitaciones directas:** Genera enlaces personalizados con nombre
  pre-asignado para que otros se unan con un solo clic.
* **Renombrado remoto:** El admin puede cambiar nombres de usuarios conectados,
  y estos reciben la actualización en tiempo real.
* **Auto-reconexión:** Si abrís un enlace de sala, DVDr recuerda tu nombre de
  la última sesión y te reconecta automáticamente.
* **Limpieza automática:** Las salas inactivas por más de 7 días se eliminan
  automáticamente.

### 📱 Aplicación web progresiva (PWA)

* **Instalable:** Añadí DVDr a tu pantalla de inicio desde el navegador para
  usarla como una app nativa.
* **Funciona offline:** Gracias al Service Worker, la app se carga incluso sin
  conexión a internet.
* **Actualizaciones automáticas:** Recibí un aviso cuando haya una nueva versión
  disponible y actualizá con un toque.

### 🆕 Otras funcionalidades

* **Datos de demostración:** Cargá datos de ejemplo para explorar todas las
  funciones sin tener que ingresar datos reales.
* **Copiado de resúmenes:** Copiá al portapapeles un resumen corto o detallado
  de las deudas, ideal para compartir por chat.
* **Resumen de totales:** Consultá cuánto pagó cada persona y cuánto le
  correspondía pagar.
* **Changelog integrado:** Consultá las novedades de cada versión directamente
  desde la app. Las notas viajan con la build, así también funcionan offline.
* **Edición de transacciones:** Editá cualquier transacción existente sin
  necesidad de borrarla y volver a crearla.
* **Confirmaciones de seguridad:** Todas las acciones destructivas requieren
  confirmación explícita.

## 🚀 Cómo usarlo

Simplemente abre [dvdr.vercel.app](https://dvdr.vercel.app) y empieza a usarla.

1. **Añade personas:** Usa el primer formulario para añadir a todos los
   participantes.
2. **Registra transacciones:** Ve a la sección de "Registra las transacciones"
   para añadir gastos, ajustes o transferencias.
3. **Consulta las deudas:** El "Resumen de deudas" se actualizará
   automáticamente mostrando la forma más simple de saldar las cuentas.

### Modo colaborativo

1. Hacé clic en el botón **"👤 Personal"** en la cabecera.
2. **Creá una sala** con un nombre de evento y tu nombre, o **uníte** con un
   código existente.
3. Compartí el enlace o código de sala para que otros se sumen en tiempo real.

## 🛠️ Tecnologías

* [Alpine.js](https://alpinejs.dev/) — Framework reactivo ligero
* [Firebase Realtime Database](https://firebase.google.com/docs/database) —
  Sincronización en tiempo real
* Vanilla CSS — Estilos personalizados sin frameworks
* Service Worker — Soporte offline y PWA

## 💻 Desarrollo local

Para ejecutar este proyecto localmente:

1. Clona el repositorio: `git clone https://github.com/CrysoK/DVDr.git`
2. Abre el archivo `index.html` en tu navegador web.

> **Nota:** Las funciones de salas colaborativas requieren conexión a internet
> para comunicarse con Firebase.

## 🚢 Lanzar una nueva versión

La fuente de las notas es `changelog.json`. La app lee ese archivo; el GitHub
Release se genera a partir de la misma lista. Publicar el Release dispara
GitHub Actions: frontend a Vercel y, si `database.rules.json` cambió, las
reglas a Firebase. Producción solo sale de un Release; los pushes a ramas
no actualizan `dvdr.vercel.app`.

1. **Escribir las novedades** en `unreleased` de `changelog.json`
   (`title` + `body`, en el tono que ve el usuario). El resto del trabajo
   de esa versión tiene que estar commiteado antes del siguiente paso.

2. **Cerrar la versión:**

   ```bash
   node scripts/release.js X.Y.Z
   ```

   Mueve `unreleased` a `vX.Y.Z`, y actualiza `APP_VERSION` en `script.js` y
   `CACHE_NAME` en `sw.js`.

3. **Revisar el diff** y publicar:

   ```bash
   node scripts/release.js X.Y.Z --publish
   ```

   Crea el commit, pushea el tag `vX.Y.Z` y publica el GitHub Release.
   El Action `.github/workflows/release.yml` hace el deploy.
