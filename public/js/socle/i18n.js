// Textes de l'application agent en français et en swahili.
// À faire relire par un locuteur du swahili du Kivu avant le pilote.
const T = {
  fr: {
    app: 'Application agent', login: 'Connexion', id: 'Identifiant', password: 'Mot de passe', signin: 'Se connecter', checking: 'Vérification…',
    online: 'En ligne', offline: 'Hors ligne', hello: 'Bonjour', register: 'Inscrire un producteur', producers: 'Mes producteurs', weigh: 'Pesée du jour', soon: 'bientôt',
    install: 'Installer l\'application', installIos: 'Sur iPhone : touchez Partager, puis « Sur l\'écran d\'accueil ».', notAgent: 'Ce compte n\'est pas un compte agent. Connectez-vous sur la page /connexion.',
    logout: 'Déconnexion', lang: 'Kiswahili', next: 'Suivant', back: 'Retour', save: 'Enregistrer', cancel: 'Annuler', step: 'Étape',
    s1: 'Identité', s2: 'Paiement et lieu', s3: 'Ménage', s4: 'Saison précédente',
    fullname: 'Nom complet', sex: 'Sexe', woman: 'Femme', man: 'Homme', birthyear: 'Année de naissance', phone: 'Téléphone',
    operator: 'Mobile Money', point: 'Point de collecte', village: 'Village', commodities: 'Filières',
    household: 'Personnes dans le ménage', femaleHead: 'Ménage dirigé par une femme', yes: 'Oui', no: 'Non', voter: 'Carte d\'électeur : 4 derniers caractères (facultatif)',
    production: 'Production (kg)', income: 'Revenu de la saison (CDF)', lastPrice: 'Dernier prix obtenu par kg', season: 'Saison',
    summary: 'Vérifier et enregistrer', saved: 'Producteur enregistré', consentSent: 'SMS de consentement envoyé. Le producteur doit répondre NDIYO.',
    addPlot: 'Ajouter sa parcelle', done: 'Terminé', search: 'Nom, téléphone ou code', none: 'Aucun producteur',
    plot: 'Parcelle', declared: 'Superficie déclarée (ha)', pointRule: 'Moins de 4 ha : un seul point GPS au centre de la parcelle.', polyRule: '4 ha ou plus : faites le tour de la parcelle et capturez chaque coin (4 points minimum).',
    capture: 'Capturer ma position', simulate: 'Simuler un relevé GPS', undo: 'Annuler le dernier point', points: 'points', area: 'Superficie mesurée',
    plotSaved: 'Parcelle enregistrée', resend: 'Renvoyer le SMS de consentement', consentPending: 'Consentement en attente', consentOk: 'Consentement validé', consentNo: 'Consentement refusé',
    required: 'Champ obligatoire', badPhone: 'Téléphone : +243 suivi de 9 chiffres', gpsWait: 'Recherche du signal GPS…', gpsErr: 'GPS indisponible. Restez à découvert ou utilisez la simulation.',
    accuracy: 'précision', gap: 'Écart de plus de 30 % avec la superficie déclarée : vérifiez le tour de la parcelle.', noPoints: 'Aucun point de collecte affecté. Contactez la coordination.'
  },
  sw: {
    app: 'Programu ya wakala', login: 'Kuingia', id: 'Jina la mtumiaji', password: 'Nenosiri', signin: 'Ingia', checking: 'Inakagua…',
    online: 'Mtandaoni', offline: 'Bila mtandao', hello: 'Jambo', register: 'Andikisha mkulima', producers: 'Wakulima wangu', weigh: 'Kupima leo', soon: 'hivi karibuni',
    install: 'Sakinisha programu', installIos: 'Kwenye iPhone: gusa Shiriki, kisha « Kwenye skrini ya mwanzo ».', notAgent: 'Akaunti hii si ya wakala. Ingia kwenye ukurasa /connexion.',
    logout: 'Toka', lang: 'Français', next: 'Endelea', back: 'Rudi', save: 'Hifadhi', cancel: 'Ghairi', step: 'Hatua',
    s1: 'Utambulisho', s2: 'Malipo na mahali', s3: 'Familia', s4: 'Msimu uliopita',
    fullname: 'Jina kamili', sex: 'Jinsia', woman: 'Mwanamke', man: 'Mwanaume', birthyear: 'Mwaka wa kuzaliwa', phone: 'Simu',
    operator: 'Pesa kwa simu', point: 'Kituo cha kukusanya', village: 'Kijiji', commodities: 'Mazao',
    household: 'Watu katika familia', femaleHead: 'Familia inaongozwa na mwanamke', yes: 'Ndiyo', no: 'Hapana', voter: 'Kadi ya mpiga kura : herufi 4 za mwisho (si lazima)',
    production: 'Mavuno (kg)', income: 'Mapato ya msimu (CDF)', lastPrice: 'Bei ya mwisho kwa kilo', season: 'Msimu',
    summary: 'Kagua na uhifadhi', saved: 'Mkulima ameandikishwa', consentSent: 'SMS ya ridhaa imetumwa. Mkulima lazima ajibu NDIYO.',
    addPlot: 'Ongeza shamba lake', done: 'Imekwisha', search: 'Jina, simu au namba', none: 'Hakuna mkulima',
    plot: 'Shamba', declared: 'Ukubwa uliotajwa (ha)', pointRule: 'Chini ya ha 4 : alama moja ya GPS katikati ya shamba.', polyRule: 'Ha 4 au zaidi : zunguka shamba na uchukue kila kona (alama 4 angalau).',
    capture: 'Chukua mahali nilipo', simulate: 'Iga kipimo cha GPS', undo: 'Futa alama ya mwisho', points: 'alama', area: 'Ukubwa uliopimwa',
    plotSaved: 'Shamba limehifadhiwa', resend: 'Tuma tena SMS ya ridhaa', consentPending: 'Ridhaa inasubiriwa', consentOk: 'Ridhaa imekubaliwa', consentNo: 'Ridhaa imekataliwa',
    required: 'Sehemu ya lazima', badPhone: 'Simu : +243 na tarakimu 9', gpsWait: 'Inatafuta GPS…', gpsErr: 'GPS haipatikani. Simama mahali wazi au tumia kuiga.',
    accuracy: 'usahihi', gap: 'Tofauti ya zaidi ya 30 % na ukubwa uliotajwa : hakikisha umezunguka shamba lote.', noPoints: 'Hakuna kituo ulichopewa. Wasiliana na uratibu.'
  }
};
let lang = (() => { try { return localStorage.getItem('kt.lang') || 'fr'; } catch { return 'fr'; } })();
export const t = (k) => T[lang][k] ?? T.fr[k] ?? k;
export const getLang = () => lang;
export function setLang(l) { lang = l; try { localStorage.setItem('kt.lang', l); } catch {} }
