# Scripts d'animation hébergés avec le site

Copiés depuis npm le 11/10/2026, au lieu d'être chargés depuis jsDelivr : la politique de sécurité
du site (CSP de `web/vercel.json`) n'autorise que les scripts du site lui-même, et aucun service
tiers ne voit passer les visiteurs.

| Fichier | Paquet npm | Licence |
| --- | --- | --- |
| `gsap.min.js` | `gsap@3.15.0` (`dist/gsap.min.js`) | licence GSAP gratuite (« Standard No Charge », https://gsap.com/standard-license), en tête du fichier |
| `ScrollTrigger.min.js` | `gsap@3.15.0` (`dist/ScrollTrigger.min.js`) | idem |
| `lenis.min.js` | `lenis@1.3.26` (`dist/lenis.min.js`) | MIT, `LICENSE-Lenis.txt` |

Seule retouche : la dernière ligne `//# sourceMappingURL=…` est retirée (les fichiers `.map` ne sont
pas copiés ; sans cette ligne, les outils du navigateur ne cherchent pas un fichier absent).

Mettre à jour : `npm pack gsap@<version> lenis@<version>`, recopier les mêmes fichiers de `dist/`
et changer les versions ci-dessus.
