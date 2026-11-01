/**
 * keyboard.ts — Clavier virtuel Android.
 *
 * Le clavier reste ouvert tant que le champ garde le focus : il masque alors les résultats.
 * On le referme dès que l'utilisateur fait défiler la liste.
 */

export function dismissKeyboardOnScroll(): void {
  const active = document.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    active.blur();
  }
}
