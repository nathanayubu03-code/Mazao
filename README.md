# KivuTrace & Market

PWA de traçabilité agricole et de paiement Mobile Money pour les coopératives du Kivu (RDC). Trois espaces dans un seul `index.html` : l'application terrain (inscription des producteurs, QR code, tracé GPS des parcelles avec pré-contrôle EUDR, pesées, SMS en swahili), le portail bailleurs (indicateurs, carte, graphiques, histoires de réussite, exports) et l'administration protégée par compte (producteurs avec import CSV, parcelles, collectes et paiements, logistique, analyse d'impact, gestion du contenu, sauvegarde, sécurité).

## Fichiers

`index.html` contient tout le CSS et le JS. `logo-mark.png` est le logo, `icon-192.png` et `icon-512.png` servent à l'installation sur téléphone, `sw.js` et `manifest.webmanifest` gèrent le hors ligne, `wrangler.jsonc` et `.assetsignore` configurent Cloudflare. Les librairies (Leaflet 1.9.4, Chart.js 4.4.1, qrcode.js 1.0.0) viennent de cdn.jsdelivr.net.

## Déploiement

Le projet Cloudflare `mazao` est relié à ce dépôt : chaque push sur la branche de production redéploie le site en une à deux minutes.

## Compte administrateur

Identifiant `admin`. Le mot de passe initial a été transmis au propriétaire du dépôt hors de ce fichier et doit être changé à la première connexion (l'application l'impose). Seul son hachage PBKDF2-SHA256 figure dans le code.

Limite à connaître : sans serveur, la vérification se fait dans le navigateur et chaque appareil garde ses propres données et son propre mot de passe. Pour un déploiement réel, ajouter une base (Cloudflare D1 + Worker) ou protéger l'accès avec Cloudflare Access.

## Ce qui est réel et ce qui est simulé

Réel : stockage local, calcul de surface géodésique, détection de polygone auto-sécant, chevauchement avec les aires protégées, QR codes, import CSV, exports GeoJSON (RFC 7946, 6 décimales) et CSV (séparateur `;`, Excel en français), sauvegarde et restauration JSON, impression PDF, GPS du téléphone (HTTPS requis).

Simulé : serveur central, API Mobile Money (références au format `MP261115.8942`), passerelle SMS, contours des parcs Virunga et Kahuzi-Biega (simplifiés, à remplacer par la base WDPA pour un audit).
