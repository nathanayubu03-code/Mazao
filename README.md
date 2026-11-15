# KivuTrace & Market (MVP)

Plateforme de traçabilité agricole pour les coopératives du Kivu (RDC) : enregistrement des producteurs, cartographie GPS des parcelles avec pré-contrôle EUDR, pesées, paiements Mobile Money simulés, groupage logistique et tableau d'impact pour bailleurs.

Tout tient dans `index.html` (HTML, CSS et JS vanilla). Les librairies (Leaflet 1.9.4, Chart.js 4.4.1, qrcode.js 1.0.0, Font Awesome 6.5.2) viennent de cdn.jsdelivr.net. Les fichiers `sw.js`, `manifest.webmanifest` et `icon.svg` rendent l'application installable et utilisable hors ligne après une première visite en ligne.

## Déploiement Cloudflare Pages

Aucun build. Dans Cloudflare : Workers & Pages, Create, Pages, Connect to Git, choisir ce dépôt. Framework preset : None. Build command : vide. Build output directory : `/`. Le fichier `_headers` empêche la mise en cache de `sw.js` et `index.html`, pour que chaque mise à jour arrive tout de suite sur les téléphones.

Alternative sans Git : `npx wrangler pages deploy . --project-name kivutrace`.

## Ce qui est réel et ce qui est simulé

Réel : stockage local (localStorage), calcul de surface géodésique, détection de polygone auto-sécant, test de chevauchement avec les aires protégées, QR codes, exports GeoJSON (RFC 7946, anneaux fermés, 6 décimales) et CSV (séparateur `;`, décimale `,`, BOM UTF-8 pour Excel FR), impression PDF via le navigateur, GPS réel (HTTPS requis).

Simulé : serveur central (la synchronisation vide la file locale), API Mobile Money (référence générée au format `MP261115.8942`), passerelle SMS, et contours des parcs Virunga et Kahuzi-Biega (simplifiés, à remplacer par les couches WDPA officielles pour un audit).

## Tester

Ouvrir le site, puis : onglet Agent, enregistrer un producteur, cartographier sa parcelle avec « Simuler le tour complet », basculer « Hors ligne » dans l'en-tête, saisir une pesée (popup SMS swahili), revenir « En ligne » (sync automatique), payer dans l'onglet Coopérative, programmer un ramassage, puis exporter depuis l'onglet Bailleurs. Pour voir un cas non conforme, tracer une parcelle à la main (clic sur la carte) dans la zone rouge du parc des Virunga au nord de Goma.

Le bouton « Réinitialiser les données démo » est dans Paramètres (roue dentée).
