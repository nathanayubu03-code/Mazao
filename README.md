# KivuTrace & Market (v2, pilote)

Plateforme modulaire pour un pilote réel au Nord-Kivu et au Sud-Kivu : un acheteur, deux agents de collecte, 20 à 50 producteurs.

- **Socle** : rôles et connexion, producteurs, localisation hiérarchique, consentement par SMS, canal SMS/USSD, paiement Mobile Money, application agent, tableau de bord.
- **Module 1** : traçabilité café/cacao (EUDR) et ordres d'achat (étapes c à f).
- **Modules 2 à 4** : préparés dans le modèle de données, interrupteurs « bientôt disponible » dans /admin.

## Architecture

```
worker/                API Cloudflare Workers + D1
  index.js             routeur /api/*
  socle/               schéma et migrations automatiques, authentification, admin, producteurs, messagerie, démo
  providers/index.js   interface unique SMS / USSD / Mobile Money (simulée aujourd'hui)
  socle/portal.js      portail public : contenu du site, inscriptions, démonstrations, fichiers
public/                fichiers statiques
  index.html           site public (accueil), avec services, acheteurs, producteurs,
                       partenaires, impact, confidentialite, mentions-legales
  inscription.html     inscription (acheteur, coopérative, ONG) en 3 étapes
  connexion.html       connexion unique, redirection selon le rôle
  app.html             application agent hors ligne (/app ; /agent redirige ici)
  acheteur.html        espace acheteur ; coordination.html : coordination, coopératives, ONG
  admin.html           administration (/admin, double authentification TOTP)
  js/site             site public (textes FR, EN, SW, LN dans js/site/i18n)
  js/socle, js/ui, js/pages
wrangler.jsonc         configuration Cloudflare
```

Pas d'outil de compilation : modules JavaScript natifs. Le schéma D1 s'installe et se met à jour tout seul au premier appel de l'API.

## Mise en route sur Cloudflare

1. Créer une base D1 nommée `kivutrace` (Stockage & bases de données › D1) et copier son identifiant dans `wrangler.jsonc` (`database_id`).
2. Pousser sur la branche : Cloudflare construit et déploie.
3. Ouvrir `/admin`, se connecter avec `admin` et le mot de passe initial transmis hors du dépôt, scanner le QR code avec une application d'authentification, choisir un mot de passe personnel.
4. Facultatif : ajouter un secret `TOTP_KEY` (Paramètres du Worker › Variables et secrets) pour chiffrer les secrets de double authentification en base.

## Sécurité

- Le mot de passe est dérivé sur l'appareil (PBKDF2-SHA256, 100 000 tours) ; le serveur stocke SHA-256 de la clé dérivée. Compatible avec le plan gratuit de Workers.
- Administrateurs : double authentification TOTP obligatoire. Blocage 15 minutes après 5 échecs.
- Les droits sont vérifiés par le serveur à chaque requête. L'agent ne voit que les producteurs de ses points de collecte, avec un téléphone masqué et sans coordonnées GPS.
- Journal de toutes les modifications ; corbeille de 30 jours (purge quotidienne planifiée).

## Données de démonstration

Activées par défaut, signalées par un bandeau « Données fictives ». Comptes (mot de passe `Demo-Kivu-2026`) : `agent.demo`, `agent2.demo`, `coord.demo`, `acheteur.demo`, `attente.demo` (acheteur en attente de validation). À désactiver dans /admin › Paramètres avant le pilote réel : cela supprime toutes les lignes marquées démo.

## Portail public

- Une seule adresse : le site de présentation (`/`) et l'entrée vers chaque espace (`/connexion`).
- Les inscriptions du site arrivent dans /admin › Demandes d'inscription. Tant qu'un compte n'est pas validé, il ne voit qu'un écran d'attente ; l'API refuse ordres et listes de producteurs.
- E-mails simulés (Cloudflare n'envoie pas vers n'importe quelle adresse sur le plan gratuit) ; ils sont visibles dans /admin et dans l'espace du destinataire. Interface prête pour un vrai service dans `worker/providers/index.js`.
- Documents et photos stockés dans D1 (1,5 Mo maximum par fichier).
- Textes, statut des services, coordonnées et photos : /admin › Contenu du site. Traductions anglaises, swahilies et lingala à faire relire.
