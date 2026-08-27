#!/usr/bin/env node
/**
 * Pasa `unreleased` de changelog.json a una versión, actualiza APP_VERSION
 * y CACHE_NAME, crea el tag y el GitHub Release, y pushea. El Action
 * `.github/workflows/release.yml` despliega Vercel y las reglas de Firebase.
 *
 *   node scripts/release.js 2.2.1
 *   node scripts/release.js 2.2.1 --publish
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const changelogPath = path.join(root, 'changelog.json');
const scriptPath = path.join(root, 'script.js');
const swPath = path.join(root, 'sw.js');

const args = process.argv.slice(2);
const publish = args.includes('--publish');
const version = args.find((arg) => !arg.startsWith('--'));

function fail(message) {
  console.error(message);
  process.exit(1);
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function write(file, contents) {
  fs.writeFileSync(file, contents);
}

function parseVersion(value) {
  const match = String(value).trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return { raw: `${match[1]}.${match[2]}.${match[3]}`, parts: match.slice(1).map(Number) };
}

function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a.parts[i] !== b.parts[i]) return a.parts[i] - b.parts[i];
  }
  return 0;
}

function releaseType(from, to) {
  if (to.parts[0] !== from.parts[0]) return 'major';
  if (to.parts[1] !== from.parts[1]) return 'minor';
  return 'patch';
}

function toMarkdown(items) {
  return items.map((item) => {
    const body = (item.body || '').trim();
    if (item.title) return `- **${item.title}:** ${body}`;
    return `- ${body}`;
  }).join('\n');
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { cwd: root, stdio: 'inherit', shell: false });
  if (result.error) fail(`No se pudo ejecutar ${command}: ${result.error.message}`);
  if (result.status !== 0) fail(`${command} ${commandArgs.join(' ')} falló (código ${result.status}).`);
}

if (!version) {
  fail('Uso: node scripts/release.js <versión> [--publish]\nEjemplo: node scripts/release.js 2.2.1');
}

const target = parseVersion(version);
if (!target) fail(`Versión inválida: "${version}". Usá el formato X.Y.Z`);

const scriptSource = read(scriptPath);
const currentMatch = scriptSource.match(/const APP_VERSION = '([^']+)'/);
if (!currentMatch) fail('No se encontró APP_VERSION en script.js');

const current = parseVersion(currentMatch[1]);
if (!current) fail(`APP_VERSION actual no es semver: "${currentMatch[1]}"`);

const changelog = JSON.parse(read(changelogPath));
const tag = `v${target.raw}`;
const existing = (changelog.releases || []).find((release) => release.tag === tag);
const alreadyBumped = current.raw === target.raw && existing;

let notes;
if (alreadyBumped) {
  if (!publish) fail(`La versión ${target.raw} ya está aplicada. Usá --publish para crear el tag y el Release.`);
  notes = toMarkdown(existing.items || []);
  console.log(`La versión ${target.raw} ya está en los archivos. Se publica el Release.`);
} else {
  if (compareVersions(target, current) <= 0) {
    fail(`La versión ${target.raw} debe ser mayor que la actual (${current.raw}).`);
  }

  const unreleased = Array.isArray(changelog.unreleased) ? changelog.unreleased : [];
  if (unreleased.length === 0) {
    fail('changelog.json no tiene ítems en "unreleased". Agregá las notas antes de publicar.');
  }
  if (existing) fail(`Ya existe una entrada ${tag} en changelog.json`);

  const today = new Date();
  const date = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0')
  ].join('-');

  changelog.releases = [
    {
      tag,
      date,
      type: releaseType(current, target),
      items: unreleased
    },
    ...(changelog.releases || [])
  ];
  changelog.unreleased = [];

  write(changelogPath, `${JSON.stringify(changelog, null, 2)}\n`);

  const nextScript = scriptSource.replace(
    /const APP_VERSION = '[^']+'/,
    `const APP_VERSION = '${target.raw}'`
  );
  if (nextScript === scriptSource) fail('No se pudo actualizar APP_VERSION en script.js');
  write(scriptPath, nextScript);

  const swSource = read(swPath);
  const nextSw = swSource.replace(
    /const CACHE_NAME = 'dvdr-cache-v[^']+'/,
    `const CACHE_NAME = 'dvdr-cache-v${target.raw}'`
  );
  if (nextSw === swSource) fail('No se pudo actualizar CACHE_NAME en sw.js');
  write(swPath, nextSw);

  notes = toMarkdown(unreleased);
  console.log(`Versión ${current.raw} → ${target.raw} (${releaseType(current, target)})`);
  console.log('Archivos actualizados: changelog.json, script.js, sw.js');
}

console.log('\nNotas para GitHub Release:\n');
console.log(notes);

if (!publish) {
  console.log(`\nRevisá los cambios y, cuando estén listos:\n  node scripts/release.js ${target.raw} --publish`);
  process.exit(0);
}

run('git', ['add', 'changelog.json', 'script.js', 'sw.js']);
const staged = spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: root });
if (staged.status !== 0) {
  run('git', ['commit', '-m', `Bump version to ${target.raw}`]);
} else {
  console.log('No hay cambios para commitear.');
}

const tagExists = spawnSync('git', ['tag', '-l', tag], { cwd: root, encoding: 'utf8' });
if (tagExists.error) fail(`No se pudo consultar el tag: ${tagExists.error.message}`);
if (!String(tagExists.stdout || '').trim()) {
  run('git', ['tag', tag]);
} else {
  console.log(`El tag ${tag} ya existe.`);
}

run('git', ['push', '-u', 'origin', 'HEAD']);
run('git', ['push', 'origin', tag]);
run('gh', ['release', 'create', tag, '--title', tag, '--notes', notes]);
console.log(`\nRelease ${tag} publicado. GitHub Actions despliega Vercel y, si cambiaron, las reglas de Firebase.`);
