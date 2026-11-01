/**
 * Identifiants Xtream dans les adresses : un mot de passe contenant & # + ? / % ou une
 * espace cassait la connexion ou la lecture.
 */

/**
 * Identifiant placé dans le chemin d'un flux (`/live/USER/PASS/123.ts`). Seuls les caractères qui
 * cassent l'adresse sont encodés : un identifiant ordinaire donne exactement la même adresse
 * qu'avant (les adresses de flux déjà enregistrées restent valables).
 */
export function encodeXtreamPathSegment(value: string): string {
  return value.replace(/[%/?#\s]/g, (c) => encodeURIComponent(c));
}

/**
 * Valeur d'un paramètre d'un lien M3U (`get.php?username=…&password=…`) collé par l'utilisateur.
 * Les séquences %XX sont décodées, mais un « + » reste un « + » : `URLSearchParams` le changeait en
 * espace, ce qui cassait un mot de passe comme « ab+cd ».
 */
export function readM3uParam(url: URL, name: string): string {
  const query = url.search.startsWith('?') ? url.search.slice(1) : url.search;
  for (const pair of query.split('&')) {
    const eq = pair.indexOf('=');
    const key = eq === -1 ? pair : pair.slice(0, eq);
    if (key !== name) continue;
    const raw = eq === -1 ? '' : pair.slice(eq + 1);
    try {
      return decodeURIComponent(raw);
    } catch {
      // Séquence % invalide (« 100%sur ») : la valeur telle quelle
      return raw;
    }
  }
  return '';
}

/**
 * Extension d'un flux (`container_extension` du fournisseur, ou d'une position reçue du cloud),
 * collée à la fin du chemin (`…/123.mkv`). Seule une extension ordinaire (lettres et chiffres,
 * 8 caractères au plus, comme `mpegts`) est gardée, sans son éventuel point initial (`.mkv` → `mkv`) :
 * une valeur comme `mkv/../x` ou `ts?a=b` changerait l'adresse demandée au fournisseur et casserait
 * la lecture. `undefined` sinon (extension par défaut).
 */
export function safeContainerExtension(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return /^\.?([a-z0-9]{1,8})$/i.exec(value)?.[1];
}
