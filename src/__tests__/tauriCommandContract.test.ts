/**
 * Contrat des commandes entre l'appli, Rust et le plugin Android (audit de couverture, lot B).
 *
 * Une commande oubliée à un seul endroit (enregistrement Rust, liste COMMANDS du plugin, méthode
 * Kotlin, permission) est refusée à l'exécution alors que tous les autres tests passent. Ce test lit
 * les quatre côtés et vérifie qu'ils concordent, noms de paramètres compris :
 * - appli : chaque `invoke('…', { … })` de `src/` (hors tests et aperçu), plus les commandes
 *   construites à la volée par `androidPlayer.ts` (`call('…')`) et par `addPluginListener` ;
 * - Rust : `generate_handler!` de `src-tauri/src/lib.rs` et la signature des `#[tauri::command]`
 *   (Tauri convertit les clés camelCase de l'appli en paramètres snake_case) ;
 * - plugin Android : `COMMANDS` de `build.rs`, `permissions/default.toml`, les `@Command` Kotlin et
 *   leurs classes `@InvokeArg` (clés reprises telles quelles, sans conversion) ;
 * - capacités : `src-tauri/capabilities/*.json`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import ts from 'typescript';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

const PLUGIN = 'nyx-android';
const PLUGIN_DIR = 'src-tauri/plugins/tauri-plugin-nyx-android';
const KOTLIN_PLUGIN = `${PLUGIN_DIR}/android/src/main/java/com/nyxplayer/nativebridge/NyxAndroidPlugin.kt`;

/** Commandes fournies par la classe `Plugin` de Tauri côté Kotlin, sans `@Command` dans notre code */
const KOTLIN_BASE_COMMANDS = new Set(['register_listener', 'remove_listener']);

/** Paramètres Rust remplis par Tauri lui-même, jamais envoyés par l'appli */
const INJECTED_RUST_TYPE = /^(?:tauri::(?:ipc::)?)?(AppHandle|Window|WebviewWindow|Webview|State|Request|CommandScope|GlobalScope)\b/;

const snakeToCamel = (name: string) => name.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const camelToSnake = (name: string) => name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const snakeToKebab = (name: string) => name.replace(/_/g, '-');

// ---------------------------------------------------------------------------------------------
// Appli (TypeScript)
// ---------------------------------------------------------------------------------------------

interface AppCall {
  /** Nom complet tel que passé à invoke (`plugin:nyx-android|play` ou `iptv_fetch`) */
  command: string;
  /** Clés de l'objet d'arguments ; null si l'objet n'est pas écrit en toutes lettres */
  keys: string[] | null;
  where: string;
}

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Tests et aperçu imitent Tauri : ils ne font pas partie du contrat
      if (entry.name === '__tests__' || entry.name === 'test' || relative(ROOT, path) === join('src', 'dev')) continue;
      files.push(...sourceFiles(path));
    } else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      files.push(path);
    }
  }
  return files;
}

function objectKeys(node: ts.Expression | undefined): string[] | null {
  if (!node) return [];
  if (!ts.isObjectLiteralExpression(node)) return null;
  const keys: string[] = [];
  for (const prop of node.properties) {
    if ((ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))) {
      keys.push(prop.name.text);
    } else {
      return null; // spread ou clé calculée : non vérifiable
    }
  }
  return keys;
}

interface AppScan {
  calls: AppCall[];
  /** Appels à invoke dont le nom n'est pas une chaîne littérale */
  dynamic: string[];
}

function scanApp(): AppScan {
  const calls: AppCall[] = [];
  const dynamic: string[] = [];
  for (const file of sourceFiles(join(ROOT, 'src'))) {
    const text = readFileSync(file, 'utf8');
    if (!text.includes('invoke') && !text.includes('call(')) continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const rel = relative(ROOT, file).replace(/\\/g, '/');
    const isAndroidPlayer = rel === 'src/services/player/androidPlayer.ts';
    // Noms liés à invoke par l'import de '@tauri-apps/api/core' (`invoke as x`, `import * as core`)
    const aliases = new Set(['invoke']);
    const namespaces = new Set<string>();
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== '@tauri-apps/api/core') continue;
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
      if (bindings && ts.isNamedImports(bindings)) {
        for (const spec of bindings.elements) if ((spec.propertyName ?? spec.name).text === 'invoke') aliases.add(spec.name.text);
      }
    }

    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        const isInvoke =
          (ts.isIdentifier(callee) && aliases.has(callee.text)) ||
          (ts.isPropertyAccessExpression(callee) &&
            callee.name.text === 'invoke' &&
            ((ts.isIdentifier(callee.expression) && namespaces.has(callee.expression.text)) || callee.expression.getText(source).includes('__TAURI_INTERNALS__')));
        // androidPlayer.ts passe par `call(cmd, args)` = invoke(`plugin:nyx-android|${cmd}`, args)
        const isAndroidCall = isAndroidPlayer && ts.isIdentifier(callee) && callee.text === 'call';
        if (isInvoke || isAndroidCall) {
          const [nameArg, argsArg] = node.arguments;
          const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
          const where = `${rel}:${line}`;
          if (nameArg && (ts.isStringLiteral(nameArg) || ts.isNoSubstitutionTemplateLiteral(nameArg))) {
            calls.push({ command: isAndroidCall ? `plugin:${PLUGIN}|${nameArg.text}` : nameArg.text, keys: objectKeys(argsArg), where });
          } else {
            dynamic.push(where);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return { calls, dynamic };
}

// ---------------------------------------------------------------------------------------------
// Rust
// ---------------------------------------------------------------------------------------------

interface RustParam {
  name: string;
  optional: boolean;
}

/** Découpe au premier niveau (hors <>, (), []) */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if ('<([{'.includes(ch)) depth++;
    if ('>)]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Toutes les variantes (cfg Windows / autres) de chaque `#[tauri::command]` d'un fichier */
function rustCommands(file: string): Map<string, RustParam[][]> {
  const text = read(file);
  const commands = new Map<string, RustParam[][]>();
  const re = /#\[tauri::command(\([^)]*\))?\]\s*(?:#\[[^\]]*\]\s*)*pub\s+(?:async\s+)?fn\s+(\w+)\s*(?:<[^>]*>)?\s*\(/g;
  for (const match of text.matchAll(re)) {
    if (match[1]) throw new Error(`${file} : ${match[2]} a des options de commande (${match[1]}) que ce test ne sait pas lire`);
    let depth = 1;
    let i = (match.index ?? 0) + match[0].length;
    const start = i;
    for (; i < text.length && depth > 0; i++) {
      if (text[i] === '(') depth++;
      if (text[i] === ')') depth--;
    }
    const params = splitTopLevel(text.slice(start, i - 1))
      .map((param) => {
        const [name, ...type] = param.split(':');
        // La macro de Tauri retire le « _ » de tête d'un paramètre inutilisé
        return { name: name.replace(/^mut\s+/, '').trim().replace(/^_+/, ''), type: type.join(':').trim() };
      })
      .filter(({ type }) => !INJECTED_RUST_TYPE.test(type))
      .map(({ name, type }) => ({ name, optional: /^(?:(?:std|core)::option::)?Option\s*</.test(type) }));
    const variants = commands.get(match[2]) ?? [];
    variants.push(params);
    commands.set(match[2], variants);
  }
  return commands;
}

function registeredRustCommands(): Map<string, RustParam[][]> {
  const lib = read('src-tauri/src/lib.rs');
  const code = lib.replace(/\/\/.*$/gm, '');
  // Bloc lu en comptant les crochets : un `#[cfg(…)]` devant une entrée ne le coupe pas
  const start = code.indexOf('generate_handler![') + 'generate_handler!['.length;
  let depth = 1;
  let end = start;
  for (; end < code.length && depth > 0; end++) {
    if (code[end] === '[') depth++;
    if (code[end] === ']') depth--;
  }
  const block = code.slice(start, end - 1).replace(/#\[[^\]]*\]/g, '');
  const registered = new Map<string, RustParam[][]>();
  for (const [, module, fn] of block.matchAll(/(\w+)::(\w+)/g)) {
    const file = `src-tauri/src/${module}.rs`;
    const variants = existsSync(join(ROOT, file)) ? rustCommands(file).get(fn) : undefined;
    registered.set(fn, variants ?? []);
  }
  return registered;
}

// ---------------------------------------------------------------------------------------------
// Plugin Android
// ---------------------------------------------------------------------------------------------

function buildRsCommands(): string[] {
  const block = /const COMMANDS: &\[&str\] = &\[([\s\S]*?)\];/.exec(read(`${PLUGIN_DIR}/build.rs`))?.[1] ?? '';
  return [...block.matchAll(/"(\w+)"/g)].map((m) => m[1]);
}

function defaultPermissions(): string[] {
  const block = /permissions\s*=\s*\[([\s\S]*?)\]/.exec(read(`${PLUGIN_DIR}/permissions/default.toml`))?.[1] ?? '';
  return [...block.matchAll(/"([\w-]+)"/g)].map((m) => m[1]);
}

interface KotlinArgs {
  fields: Set<string>;
  required: Set<string>;
}

function kotlinPlugin() {
  const text = read(KOTLIN_PLUGIN);
  const argClasses = new Map<string, KotlinArgs>();
  for (const [, name, body] of text.matchAll(/@InvokeArg\s+class\s+(\w+)\s*\{([\s\S]*?)\n\}/g)) {
    const fields = new Set<string>();
    const required = new Set<string>();
    for (const [, lateinit, field, type, init] of body.matchAll(/(lateinit\s+)?va[rl]\s+(\w+)\s*:\s*([^=\n]+?)\s*(=|$)/gm)) {
      fields.add(field);
      if (lateinit || (init !== '=' && !type.replace(/\s+/g, '').endsWith('?'))) required.add(field);
    }
    argClasses.set(name, { fields, required });
  }

  // Chaque @Command, avec la classe d'arguments lue dans son corps (jusqu'à la commande suivante)
  const commands = new Map<string, KotlinArgs | null>();
  const parts = text.split(/@Command\b/).slice(1);
  for (const raw of parts) {
    const fn = /^\s*fun\s+(\w+)\s*\(/.exec(raw)?.[1];
    if (!fn) continue;
    // Corps de la commande seulement : jusqu'au membre suivant de la classe (même retrait)
    const afterSignature = raw.slice(raw.indexOf(fn));
    const next = /\n {4}(?:(?:private|override|public|internal)\s+)*(?:fun|val|var|companion|@)\b/.exec(afterSignature);
    const part = next ? afterSignature.slice(0, next.index) : afterSignature;
    const argsClass = /parseArgs\((\w+)::class\.java\)/.exec(part)?.[1];
    commands.set(camelToSnake(fn), argsClass ? (argClasses.get(argsClass) ?? { fields: new Set(), required: new Set(['<classe introuvable>']) }) : null);
  }
  return commands;
}

// ---------------------------------------------------------------------------------------------
// Plugin iOS (Swift) : même nom JS, commandes `@objc public func x(_ invoke: Invoke)` (nom camelCase)
// et types d'arguments `Decodable` (clés reprises telles quelles, comme en Kotlin)
// ---------------------------------------------------------------------------------------------

const SWIFT_PLUGIN_DIR = `${PLUGIN_DIR}/ios/Sources/NyxIosPlugin`;

/** Mise à jour par APK : Android seulement, appelée derrière isAndroid() ; iOS la refuse */
const APK_UPDATE_COMMANDS = new Set(['update_info', 'fetch_update_manifest', 'request_install_permission', 'download_update', 'install_update']);

/** Les `.swift` du dossier et de ses sous-dossiers */
function swiftFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return swiftFiles(path);
    return entry.name.endsWith('.swift') ? [path] : [];
  });
}

/**
 * Le code Swift, commentaires et chaînes remplacés par des espaces (positions et fins de ligne
 * gardées) : une accolade ou un `parseArgs` écrit dans un commentaire ou une chaîne ne compte pas.
 */
function swiftCode(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    let end: number;
    if (text.startsWith('//', i)) {
      end = text.indexOf('\n', i);
      if (end === -1) end = text.length;
    } else if (text.startsWith('/*', i)) {
      end = text.indexOf('*/', i + 2);
      end = end === -1 ? text.length : end + 2;
    } else if (text[i] === '"') {
      // Chaîne sur une ligne, ou sur plusieurs entre """ ; « \" » ne la ferme pas
      const quote = text.startsWith('"""', i) ? '"""' : '"';
      end = i + quote.length;
      while (end < text.length && !text.startsWith(quote, end) && (quote.length > 1 || text[end] !== '\n')) end += text[end] === '\\' ? 2 : 1;
      if (text.startsWith(quote, end)) end += quote.length;
    } else {
      out += text[i++];
      continue;
    }
    out += text.slice(i, end).replace(/[^\r\n]/g, ' ');
    i = end;
  }
  return out;
}

/** Le corps d'un bloc : du « { » à la position `open` jusqu'à l'accolade qui le ferme */
function braceBody(code: string, open: number, what: string): string {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}' && --depth === 0) return code.slice(open + 1, i);
  }
  throw new Error(`${what} : accolade fermante introuvable`);
}

function swiftPlugin() {
  // Chaque fichier lu à part : le corps d'une commande ne déborde jamais sur le fichier suivant
  const files = swiftFiles(join(ROOT, SWIFT_PLUGIN_DIR)).map((path) => ({
    file: relative(ROOT, path).replace(/\\/g, '/'),
    code: swiftCode(readFileSync(path, 'utf8')),
  }));
  const argTypes = new Map<string, KotlinArgs>();
  for (const { code } of files) {
    for (const [, name, body] of code.matchAll(/(?:struct|class)\s+(\w+)\s*:\s*Decodable\s*\{([\s\S]*?)\r?\n\}/g)) {
      const fields = new Set<string>();
      const required = new Set<string>();
      for (const [, field, type] of body.matchAll(/(?:let|var)\s+(\w+)\s*:\s*([^=\r\n]+)/g)) {
        fields.add(field);
        if (!type.trim().endsWith('?')) required.add(field);
      }
      argTypes.set(name, { fields, required });
    }
  }
  // Chaque commande, avec le type d'arguments lu dans son seul corps (accolades appariées depuis son
  // « { ») : un `parseArgs` d'une fonction écrite plus loin ne lui est pas attribué
  const commands = new Map<string, KotlinArgs | null>();
  for (const { file, code } of files) {
    for (const match of code.matchAll(/@objc\s+public\s+func\s+(\w+)\(_ invoke: Invoke\)\s*\{/g)) {
      const body = braceBody(code, (match.index ?? 0) + match[0].length - 1, `${file} : ${match[1]}`);
      const argsType = /parseArgs\((\w+)\.self\)/.exec(body)?.[1];
      commands.set(camelToSnake(match[1]), argsType ? (argTypes.get(argsType) ?? { fields: new Set(), required: new Set(['<type introuvable>']) }) : null);
    }
  }
  return commands;
}

// ---------------------------------------------------------------------------------------------

const app = scanApp();
const rust = registeredRustCommands();
const pluginCommands = buildRsCommands();
const kotlin = kotlinPlugin();
const swift = swiftPlugin();
interface Capability {
  platforms?: string[];
  permissions: (string | { identifier: string })[];
}
const capabilities = readdirSync(join(ROOT, 'src-tauri/capabilities'))
  .filter((f) => f.endsWith('.json') && !f.startsWith('zz-'))
  .map((f) => JSON.parse(read(`src-tauri/capabilities/${f}`)) as Capability);
const permissionsOf = (list: Capability[]) => list.flatMap((c) => c.permissions).map((p) => (typeof p === 'string' ? p : p.identifier));
const capabilityPermissions = permissionsOf(capabilities);
/** Capacités appliquées sur Android (sans liste `platforms`, ou qui la cite) */
const androidPermissions = permissionsOf(capabilities.filter((c) => !c.platforms || c.platforms.includes('android')));

const pluginCalls = app.calls.filter((c) => c.command.startsWith(`plugin:${PLUGIN}|`));
const rustCalls = app.calls.filter((c) => !c.command.startsWith('plugin:'));
const pluginName = (c: AppCall) => c.command.slice(`plugin:${PLUGIN}|`.length);

/** Commandes appelées par la bibliothèque @tauri-apps/api elle-même (addPluginListener, unregister) */
function tauriApiListenerCommands(): string[] {
  const core = readFileSync(join(ROOT, 'node_modules/@tauri-apps/api/core.js'), 'utf8');
  return [...new Set([...core.matchAll(/plugin:\$\{[\w.]+\}\|(\w+_listener)`/g)].map((m) => m[1]))];
}

describe('contrat des commandes appli ↔ Rust ↔ Android', () => {
  it('la lecture des sources trouve bien les quatre côtés', () => {
    // Garde-fou du test lui-même : un analyseur cassé ne doit pas passer « à vide »
    expect(rustCalls.length).toBeGreaterThan(20);
    expect(pluginCalls.length).toBeGreaterThan(15);
    expect(rust.size).toBeGreaterThan(20);
    expect(pluginCommands.length).toBeGreaterThan(15);
    expect(kotlin.size).toBeGreaterThan(15);
    expect(rust.get('refresh_catalog')?.[0]?.map((p) => p.name)).toEqual(['run_id', 'host', 'username', 'password', 'db_name', 'dns_provider', 'lists', 'mode']);
    expect(kotlin.get('select_track')?.required).toEqual(new Set(['type']));
  });

  it('aucun invoke au nom construit à la volée hors des relais connus', () => {
    // Un nom dynamique échappe à ce test : n'ajouter ici un relais que si ses appels sont eux-mêmes relevés
    // (androidPlayer.ts : `call('…')` ; memoryService.ts : fonction locale nommée `invoke`)
    expect(app.dynamic.map((where) => where.replace(/:\d+$/, '')).sort()).toEqual(['src/services/memoryService.ts', 'src/services/player/androidPlayer.ts']);
  });

  it('chaque objet d\'arguments d\'invoke est écrit en toutes lettres (sinon ses clés ne sont pas vérifiables)', () => {
    expect(app.calls.filter((c) => c.keys === null).map((c) => `${c.where} ${c.command}`)).toEqual([]);
  });

  describe('commandes Rust', () => {
    it('chaque commande appelée par l\'appli est enregistrée dans generate_handler!', () => {
      const missing = rustCalls.filter((c) => !rust.has(c.command)).map((c) => `${c.where} ${c.command}`);
      expect(missing).toEqual([]);
    });

    it('chaque commande enregistrée existe avec #[tauri::command] dans son module', () => {
      expect([...rust].filter(([, variants]) => variants.length === 0).map(([name]) => name)).toEqual([]);
    });

    it('chaque commande enregistrée est appelée par l\'appli (sinon : code mort ou appel oublié)', () => {
      const called = new Set(rustCalls.map((c) => c.command));
      expect([...rust.keys()].filter((name) => !called.has(name))).toEqual([]);
    });

    it('les clés envoyées correspondent aux paramètres Rust (camelCase → snake_case), dans chaque variante', () => {
      const problems: string[] = [];
      for (const call of rustCalls) {
        for (const params of rust.get(call.command) ?? []) {
          const expected = new Set(params.map((p) => snakeToCamel(p.name)));
          const sent = new Set(call.keys ?? []);
          for (const key of sent) {
            if (!expected.has(key)) problems.push(`${call.where} ${call.command} : clé « ${key} » inconnue du Rust (attendu : ${[...expected].join(', ') || 'aucune'})`);
          }
          for (const param of params) {
            if (!param.optional && !sent.has(snakeToCamel(param.name))) {
              problems.push(`${call.where} ${call.command} : paramètre obligatoire « ${snakeToCamel(param.name)} » absent`);
            }
          }
        }
      }
      expect([...new Set(problems)]).toEqual([]);
    });
  });

  describe('plugin Android', () => {
    it('chaque commande appelée par l\'appli est dans COMMANDS de build.rs', () => {
      const listed = new Set(pluginCommands);
      const used = [...pluginCalls.map((c) => ({ name: pluginName(c), where: c.where })), ...tauriApiListenerCommands().map((name) => ({ name, where: '@tauri-apps/api addPluginListener' }))];
      expect(used.filter((u) => !listed.has(u.name)).map((u) => `${u.where} ${u.name}`)).toEqual([]);
    });

    it('addPluginListener utilise bien les commandes d\'écouteur prévues', () => {
      // Si la bibliothèque change de nom de commande, COMMANDS et les permissions doivent suivre
      expect(tauriApiListenerCommands().sort()).toEqual([...KOTLIN_BASE_COMMANDS].sort());
    });

    it('chaque commande de COMMANDS est appelée par l\'appli', () => {
      const called = new Set([...pluginCalls.map(pluginName), ...KOTLIN_BASE_COMMANDS]);
      expect(pluginCommands.filter((name) => !called.has(name))).toEqual([]);
    });

    it('COMMANDS et les @Command Kotlin sont exactement la même liste', () => {
      const kotlinNames = new Set([...kotlin.keys(), ...KOTLIN_BASE_COMMANDS]);
      expect([...pluginCommands].sort()).toEqual([...kotlinNames].sort());
    });

    it('chaque commande de COMMANDS a sa permission dans default.toml, et rien de plus', () => {
      expect(defaultPermissions().sort()).toEqual(pluginCommands.map((name) => `allow-${snakeToKebab(name)}`).sort());
    });

    it('chaque commande de COMMANDS a son fichier de permission généré', () => {
      const missing = pluginCommands.filter((name) => !existsSync(join(ROOT, PLUGIN_DIR, 'permissions/autogenerated/commands', `${name}.toml`)));
      expect(missing).toEqual([]);
    });

    it('les clés envoyées correspondent aux champs @InvokeArg Kotlin (noms identiques)', () => {
      const problems: string[] = [];
      for (const call of pluginCalls) {
        const name = pluginName(call);
        if (!kotlin.has(name)) continue; // déjà signalé plus haut
        const args = kotlin.get(name);
        const sent = new Set(call.keys ?? []);
        const fields = args?.fields ?? new Set<string>();
        for (const key of sent) {
          if (!fields.has(key)) problems.push(`${call.where} ${name} : clé « ${key} » ignorée par Kotlin (champs : ${[...fields].join(', ') || 'aucun'})`);
        }
        for (const field of args?.required ?? []) {
          if (!sent.has(field)) problems.push(`${call.where} ${name} : champ obligatoire « ${field} » absent`);
        }
      }
      expect(problems).toEqual([]);
    });
  });

  describe('plugin iOS', () => {
    it('chaque commande Swift est dans COMMANDS de build.rs', () => {
      expect(swift.size).toBeGreaterThan(0);
      const listed = new Set(pluginCommands);
      expect([...swift.keys()].filter((name) => !listed.has(name))).toEqual([]);
    });

    it('la lecture du Swift attribue à chaque commande son propre type d\'arguments', () => {
      // Garde-fou de l'analyseur, comme pour les quatre côtés plus haut
      expect(swift.get('secure_set')).toEqual({ fields: new Set(['key', 'value']), required: new Set(['key', 'value']) });
      expect(swift.get('secure_delete')?.required).toEqual(new Set(['key']));
      expect(swift.get('network_status')).toBeNull();
    });

    it('les commandes de M2 existent côté Swift', () => {
      for (const name of ['device_info', 'network_status', 'secure_get', 'secure_set', 'secure_delete']) {
        expect([...swift.keys()], name).toContain(name);
      }
    });

    it('les clés envoyées correspondent aux champs Decodable Swift (noms identiques)', () => {
      const problems: string[] = [];
      for (const call of pluginCalls) {
        const name = pluginName(call);
        if (!swift.has(name)) continue; // commande pas encore portée sur iOS
        if (APK_UPDATE_COMMANDS.has(name)) continue; // Android seulement : refusée sur iOS sans lire ses arguments
        const args = swift.get(name);
        const sent = new Set(call.keys ?? []);
        const fields = args?.fields ?? new Set<string>();
        for (const key of sent) {
          if (!fields.has(key)) problems.push(`${call.where} ${name} : clé « ${key} » ignorée par Swift (champs : ${[...fields].join(', ') || 'aucun'})`);
        }
        for (const field of args?.required ?? []) {
          if (!sent.has(field)) problems.push(`${call.where} ${name} : champ obligatoire « ${field} » absent`);
        }
      }
      expect(problems).toEqual([]);
    });
  });

  describe('capacités', () => {
    it('la fenêtre principale reçoit les permissions du plugin Android, sur Android', () => {
      expect(androidPermissions).toContain(`${PLUGIN}:default`);
    });

    it('chaque commande d\'un plugin Tauri appelée directement a sa permission', () => {
      const others = app.calls.filter((c) => c.command.startsWith('plugin:') && !c.command.startsWith(`plugin:${PLUGIN}|`));
      const missing = others.filter((c) => {
        const [plugin, cmd] = c.command.slice('plugin:'.length).split('|');
        return !capabilityPermissions.includes(`core:${plugin}:allow-${snakeToKebab(cmd)}`) && !capabilityPermissions.includes(`${plugin}:allow-${snakeToKebab(cmd)}`);
      });
      expect(missing.map((c) => `${c.where} ${c.command}`)).toEqual([]);
    });
  });
});
