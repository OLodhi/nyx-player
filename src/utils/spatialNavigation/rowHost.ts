/**
 * Contenu d'une rangée affiché ailleurs dans la page que son emplacement.
 *
 * Les rangées recyclées de l'accueil Films / Séries TV (components/Iptv/rail) restent dans un calque posé sur la liste,
 * glissées à la hauteur de leur emplacement au lieu d'y être déplacées. La navigation retrouve ainsi l'emplacement
 * d'une carte, et le contenu d'un emplacement. Ailleurs, rien n'est relié : le contenu est dans son emplacement.
 */

const hostOf = new WeakMap<Element, Element>();
const contentOf = new WeakMap<Element, Element>();

/** Le contenu `content` est affiché à la hauteur de l'emplacement `place` (et plus à celle de son emplacement d'avant). */
export function linkRowContent(place: Element, content: Element): void {
  const before = hostOf.get(content);
  if (before && contentOf.get(before) === content) contentOf.delete(before);
  const previous = contentOf.get(place);
  if (previous && previous !== content) hostOf.delete(previous);
  hostOf.set(content, place);
  contentOf.set(place, content);
}

/** Le contenu n'est plus affiché nulle part (catégorie retirée, accueil quitté). */
export function unlinkRowContent(content: Element): void {
  const place = hostOf.get(content);
  if (place && contentOf.get(place) === content) contentOf.delete(place);
  hostOf.delete(content);
}

/** Emplacement (`selector`) qui contient l'élément, ou à la hauteur duquel son contenu est affiché. */
export function rowPlaceOf(element: Element, selector: string): Element | null {
  const own = element.closest(selector);
  if (own) return own;
  for (let node: Element | null = element; node; node = node.parentElement) {
    const place = hostOf.get(node);
    if (place) return place;
  }
  return null;
}

/** Contenu affiché pour un emplacement : lui-même s'il n'est relié à rien. */
export function rowContentOf(place: Element): Element {
  return contentOf.get(place) ?? place;
}
