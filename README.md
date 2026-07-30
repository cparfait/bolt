# Bolt — suivi des activités sportives

Outil de suivi de présence aux activités sportives proposées aux agents dans le
cadre de la démarche QVT. Auto-hébergé, authentification Active Directory en
LDAPS, émargement par les animateurs depuis leur téléphone.

Même socle technique que **Sésame** (Next.js 16 / React 19 / TypeScript /
Tailwind 4 / Prisma / PostgreSQL) : une seule stack à maintenir pour la DSI.
L'écran d'émargement reprend l'ergonomie mobile de la page de signature de
**SimCity**.

---

## Le problème d'architecture, et sa réponse

Les animateurs sont souvent des prestataires extérieurs : **ils ne sont pas sur
le réseau de la collectivité**. Il leur faut donc un accès depuis Internet.
Mais publier une authentification Active Directory sur Internet — ou confier
l'annuaire à un SaaS — n'est pas acceptable.

Bolt sépare les deux populations :

| | Qui | Comment il se connecte | Exposé sur Internet |
|---|---|---|---|
| **Animateur** | souvent prestataire extérieur | lien à jeton + code à 6 chiffres, **aucun compte de domaine** | oui, `/emargement/*` uniquement |
| **Agent** | agent de la collectivité | identifiant Windows, LDAPS | non (interne / VPN) |
| **Service des sports, DSI** | agents | identifiant Windows, LDAPS | non (interne / VPN) |

Conséquence : **aucune identité Active Directory ne transite jamais hors du
réseau**, et le contrôleur de domaine n'est joignable que depuis le serveur
applicatif. C'est ce qu'un SaaS ne permet pas.

Le cloisonnement est appliqué à deux niveaux : par le reverse proxy, et par le
proxy applicatif `src/proxy.ts` (`INTERNAL_CIDRS`), qui refuse tout ce qui n'est pas
`/emargement/*` aux requêtes venues d'une IP hors des plages internes.

### Accès des animateurs — trois modes au choix

Configurable **par animateur**, selon sa situation :

- **Lien sécurisé (sans compte)** — recommandé pour les prestataires. Jeton
  aléatoire de 32 octets + code PIN à 6 chiffres stocké haché (bcrypt).
  Verrouillage 15 minutes après 5 essais, persisté en base. Expiration
  facultative, révocation immédiate, chaque accès journalisé avec IP.
- **Compte Active Directory** — pour un animateur agent de la collectivité.
- **Identifiant local** — géré dans Bolt, indépendant de l'annuaire.

### Agents sans poste sur le réseau (option)

Terrain, crèches, gardiennage : ces agents peuvent se connecter par **lien envoyé
par courriel** (option désactivée par défaut). Seules les adresses **déjà
connues de Bolt** reçoivent un lien : impossible de créer une identité en
saisissant un nom, et le rattachement direction / service reste celui de l'AD —
donc pas de doublon ni de statistique faussée.

Deux adresses par agent, et c'est nécessaire. `email` vient de l'annuaire et y
est réécrite à chaque connexion LDAPS. `emailContact` est saisie par le service
des sports sur la fiche de l'agent, prime sur la première, et n'est jamais
touchée par la synchronisation. Sans elle, la population visée restait sans
accès : un agent de terrain a bien une boîte professionnelle sur le papier, mais
ne l'ouvre jamais — et beaucoup sont enregistrés avec une adresse personnelle.
C'est `emailContact` qui commande tout ce que Bolt envoie : lien de connexion,
rappels de séance, annonces d'annulation, relances.

Activation : case dans *Paramètres → Général*.

**Cet accès fonctionne depuis le réseau de la collectivité, pas depuis
Internet — et c'est voulu.** Un agent qui ouvre son courriel depuis chez lui ou
en 4G ne pourra pas suivre le lien : il devra le faire depuis un poste de la
mairie, ce qui lui évite seulement d'avoir à saisir son mot de passe Windows.
Deux raisons, aucune accidentelle : l'Apache en DMZ ne publie que quatre
préfixes (`/emargement/`, `/icones/`, `/_next/static/`, `/favicon.ico`), dont
`/acces` ne fait pas partie ; et l'URL du lien envoyé porte le nom interne du
back-office, absent du DNS public.

`PUBLIC_AGENT_ACCESS=1` **ne suffit donc pas** à publier cet espace : la variable
n'ouvre que le filtre applicatif de `src/proxy.ts`, elle ne touche pas au vhost
Apache. L'activer seule n'a aucun effet visible pour l'agent, et affaiblit le
second verrou pour rien. Publier réellement cet accès demanderait d'ajouter
`/acces` et `/mes-activites` aux `ProxyPass`, un nom DNS public, et d'accepter
deux conséquences : n'importe qui pourrait déclencher depuis Internet l'envoi de
courriels par l'application, et une adresse professionnelle deviendrait à elle
seule un moyen d'accès. À peser avant, pas après.

---

## Ce que fait l'outil

**Pour l'animateur** — sur son téléphone, sans installer d'application : ses
séances du jour, une ligne par inscrit, deux gros boutons (présent, absent —
qu'un agent ait prévenu ou non s'affiche en face de son nom, cela ne se pointe
pas), un bouton « tout le monde est là », un compteur permanent, et
la transmission de la feuille en un geste. Un collègue se présente sans être
inscrit ? Il l'**ajoute à la volée** — sa venue compte alors dans la
fréquentation — et propose son inscription au créneau, que le service des sports
arbitre. Il peut aussi déclarer qu'une séance n'a pas eu lieu, avec le motif, ou
**prévenir à l'avance** qu'une prochaine séance n'aura pas lieu — les inscrits
sont alors informés par courriel.
L'enregistrement est optimiste : la saisie reste fluide même sur un réseau mobile
médiocre.

**Pour l'agent** — catalogue des créneaux avec places restantes, inscription en
ligne, liste d'attente automatique, historique de sa propre assiduité.

**Pour le service des sports** — activités et créneaux, calendrier généré
automatiquement hors vacances et jours fériés, arbitrage des demandes,
promotion automatique de la liste d'attente à chaque désistement, correction
des feuilles, relance des agents qui ne viennent plus. L'inscription d'un agent
se fait par **recherche dans l'annuaire** : nul besoin qu'il se soit déjà
connecté — son compte est créé au moment de l'inscription, avec sa direction et
son service. Un créneau peut ne couvrir **qu'une partie de la saison** (bornes
de première et dernière séance). Quand une série de séances tombe — piscine en
vidange, gymnase réquisitionné, animateur en arrêt —, l'**annulation groupée**
les traite d'un coup et n'envoie qu'un courriel par agent, quel que soit le
nombre de séances qui le concernent.

**Pour le bilan QVT** — taux de présence, fréquentation moyenne par séance,
évolution mensuelle, taux de remplissage par activité, participation par
direction, détection des décrocheurs. Deux exports : **CSV** pour retraiter,
**classeur Excel** en quatre onglets (synthèse, évolution, directions, détail
des séances) prêt à circuler en comité.

**Pour la DSI** — paramétrage LDAPS avec test de connexion, **autocomplétion des
groupes** depuis l'annuaire (une faute de frappe y verrouillerait l'accès de
tous), synchronisation en lecture seule, gestion des rôles, journal d'audit
complet. Les erreurs SMTP courantes sont traduites en conseil actionnable
plutôt qu'en message OpenSSL.

**Rappels de séance** — facultatifs, envoyés aux inscrits N heures avant. Le
déclenchement se fait au fil du trafic sur l'application : aucun ordonnanceur
n'est nécessaire dans le conteneur. Si vous disposez d'un cron, définissez
`CRON_TOKEN` et appelez `GET /api/taches/rappels` — sans ce jeton la route reste
fermée. Une séance n'est rappelée qu'une fois, quelle que soit la voie.

---

## Modèle de données

```
Saison ──┬── Fermeture ══════╗  (vacances, fériés : exclues du calendrier,
         │                   ║   sauf pour les créneaux « maintenus » ══╗)
         └── Créneau ───────┬── Séance ─── Présence                     ║
                            ├── Inscription                             ║
                            └── fermeturesMaintenues ═══════════════════╝
Activité ── Créneau
Animateur ── Créneau
```

Un **créneau** est une récurrence hebdomadaire (« Musculation, lundi 12h30 ») ;
la **musculation 2×/semaine** est donc deux créneaux rattachés à la même
activité. Les **séances** sont matérialisées en base plutôt que calculées à la
volée : une séance porte un état, un commentaire, une annulation et des
présences, qui ne se déduisent pas de la règle de récurrence.

Les **places** se comptent par défaut sur le créneau : le yoga du mardi et celui
du jeudi sont deux groupes distincts, dimensionnés séparément. Une activité peut
au contraire n'ouvrir **qu'un seul groupe réparti sur plusieurs créneaux** —
la musculation prend douze agents, qui viennent le lundi, le jeudi ou les deux.
L'option se coche sur la fiche de l'activité, qui porte alors l'effectif : la
place appartient à l'agent, suivre deux séances n'en consomme qu'une, et la
liste d'attente est commune aux créneaux. Le quota d'inscriptions par agent se
compte lui aussi en activités, jamais en créneaux.

Les **périodes de fermeture** (vacances scolaires, jours fériés, fermeture de la
piscine) sont déclarées au niveau de la saison, mais **dérogeables créneau par
créneau** : le formulaire de créneau liste toutes les périodes et l'on coche
celles que l'activité traverse malgré tout. La musculation en libre accès tourne
souvent pendant les petites vacances quand l'aquagym s'arrête avec la piscine.
La page *Saisons & calendrier* indique, pour chaque période, quelles activités
restent ouvertes.

La génération du calendrier est idempotente. Elle ne supprime jamais une séance
déjà émargée.

---

## Démarrage en développement

```bash
npm install
```

Base PostgreSQL locale :

```bash
docker run -d --name bolt-dev-db -e POSTGRES_USER=bolt -e POSTGRES_PASSWORD=bolt -e POSTGRES_DB=bolt -p 5434:5432 postgres:17-alpine
```

Copiez `.env.example` en `.env`, puis :

```bash
npx prisma migrate deploy && npm run db:seed && npm run dev
```

Le jeu de démonstration crée une saison **calée sur la date du jour** (quatre
mois derrière, huit devant — sans quoi les statistiques seraient vides ou il n'y
aurait aucune séance à émarger aujourd'hui), les cinq activités, six créneaux,
quatre animateurs (un par mode d'accès), trente agents fictifs répartis sur
quatre directions, et un historique de fréquentation. La dernière séance passée
de chaque créneau reste volontairement non émargée, pour illustrer le
rattrapage côté animateur et l'alerte « feuilles non transmises ».

**Comptes de démonstration**, mot de passe `bolt` :

| Identifiant | Rôle |
|---|---|
| `admin` | administrateur (DSI) |
| `sports` | service des sports |
| `cmoreau` | animatrice, compte local |
| `camille.martin`, `julien.bernard`, `sarah.dubois` | agents |

Pour tester l'émargement distant : *Animateurs → Nadia BENALI → Générer le lien*.
Ouvrez-le sur un téléphone via `http://<ip-du-poste>:3000` — les plages IP
privées sont autorisées en développement.

---

## Déploiement

```bash
docker compose up -d --build
```

Variables obligatoires : `POSTGRES_PASSWORD`, `SESSION_SECRET` (32 caractères
minimum), `BOLT_ADMIN_PASSWORD` (8 minimum), `BOLT_PUBLIC_URL`. Le conteneur
refuse de démarrer si elles manquent, et applique les migrations au démarrage.

### Reverse proxy — l'essentiel

Le proxy doit renseigner `X-Forwarded-For` **en écrasant** toute valeur fournie
par le client : c'est cette adresse que `src/proxy.ts` compare à
`INTERNAL_CIDRS`.

Pour Apache, une configuration complète et commentée est fournie :
[`deploy/apache-emargement.conf`](deploy/apache-emargement.conf). Elle refuse tout
par défaut, puis rouvre les quatre seuls préfixes nécessaires.

Exemple nginx, exposition minimale (émargement seul sur Internet) :

```nginx
# Les trois préfixes publics : la feuille, ses icônes d'installation, ses
# fichiers JS/CSS. Sans les deux derniers, la page s'affiche sans mise en forme.
location ~ ^/(emargement|icones|_next/static)/ {
    proxy_pass http://127.0.0.1:3100;
    proxy_set_header Host              $host;
    proxy_set_header X-Forwarded-For   $remote_addr;   # écrase, ne concatène pas
    proxy_set_header X-Forwarded-Proto $scheme;
}

location / {
    allow 10.0.0.0/8;
    deny  all;
    proxy_pass http://127.0.0.1:3100;
    proxy_set_header Host              $host;
    proxy_set_header X-Forwarded-For   $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

En-têtes de sécurité (HSTS, CSP, `X-Frame-Options`, `Permissions-Policy`)
appliqués par l'application elle-même — voir `next.config.ts`.

### Configuration Active Directory

*Paramètres → Annuaire*. Le compte de service n'a besoin que de la **lecture** :
Bolt n'écrit jamais dans l'annuaire.

| Champ | Exemple |
|---|---|
| Serveur | `ldaps://dc01.collectivite.lan` |
| Base DN | `DC=collectivite,DC=lan` |
| Compte de service | `svc-bolt@collectivite.lan` |
| Groupe AD requis | `GG-Bolt-Utilisateurs` |
| Groupe service des sports | `GG-Bolt-Sports` |

Pour une autorité de certification interne, renseignez le **certificat de l'AC**
(chemin PEM ou contenu collé) plutôt que de désactiver la vérification du
certificat.

L'appartenance aux groupes est évaluée récursivement (matching rule AD
`1.2.840.113556.1.4.1941`), et en *fail-closed* : une vérification impossible
refuse l'accès.

#### Connexion et synchronisation : deux choses distinctes

**La connexion n'exige aucune synchronisation.** Bolt interroge le contrôleur de
domaine en direct, et **crée le compte à la première connexion** — nom, adresse,
direction et service repris de l'annuaire, rôle déduit de l'appartenance au
groupe du service des sports. Il n'y a donc aucune démarche préalable à faire
pour qu'un agent puisse se connecter.

**La synchronisation alimente un miroir** (`AdAccount`), qui sert à trois
choses : inscrire un agent qui ne s'est *jamais* connecté, ouvrir la connexion
par lien e-mail, et tenir les statistiques par direction. Elle tourne
**automatiquement une fois par jour** (au premier passage sur le tableau de bord,
et par le cron s'il est configuré), et reste déclenchable à la main depuis
*Paramètres → Annuaire*. Elle exige un compte de service : sans lui, la lecture
en masse est impossible et le geste reste manuel.

#### Les départs

La synchronisation ferme l'accès des agents dont le compte d'annuaire est
**désactivé ou supprimé**, et retire leurs inscriptions — les places repartent
aussitôt à la liste d'attente. Sans cela, un agent parti gardait un compte Bolt
actif indéfiniment : sa place restait réservée, il figurait sur les feuilles
d'émargement, et il pouvait encore recevoir un lien de connexion par courriel.

Trois garde-fous, parce que ce traitement est le plus destructeur de
l'application :

- **Ne sont concernés que les comptes adossés à l'annuaire.** Les comptes locaux
  (administrateur de secours, animateurs en accès LOCAL) et les participants hors
  annuaire (`no_ad.…` : élus, stagiaires, invités d'un organisme partenaire) n'y
  existent légitimement pas et ne sont jamais touchés.
- **Une absence ne vaut pas un départ tant que la lecture n'est pas crue.** Un
  Base DN mal recopié ou un groupe filtrant trop étroit rend une liste courte.
  Bolt compare donc la lecture à une population témoin — les comptes Bolt actifs
  adossés à l'annuaire, qui s'y sont forcément connectés : s'il n'en retrouve pas
  au moins 80 %, il refuse d'interpréter les absents, ne nettoie pas le miroir, et
  le dit en avertissement. Un compte explicitement marqué désactivé, lui, est une
  affirmation de l'annuaire et non une déduction : il est traité dans tous les cas.
- **Désinscrire, pas supprimer.** L'inscription passe en `DESISTEE` : la place est
  rendue et la personne ne figure plus comme inscrite, mais les présences déjà
  émargées gardent leur rattachement et la fréquentation des saisons passées reste
  juste.

Ces règles sont testées — `tests/annuaire.test.ts` pour les garde-fous en
fonctions pures, `tests/integration/departs.db.test.ts` pour l'effet réel sur la
base.

Le service des sports peut aussi désactiver un compte à la main depuis la fiche
de l'agent, où le retrait des activités est **proposé** — décochable pour une
absence longue au terme de laquelle l'agent retrouve son créneau.

---

## Points RGPD

- **Donnée traitée** : identité professionnelle (nom, adresse, direction,
  service) et présence à une activité sportive. Ce n'est pas une donnée de
  santé, mais elle reste personnelle et permet un suivi individuel.
- **Finalité** : suivi de fréquentation et pilotage de l'offre. À inscrire au
  registre des traitements.
- **Base légale** : mission d'intérêt public / intérêt légitime de l'employeur
  au titre de la QVT. L'inscription reste volontaire.
- **Destinataires** : service des sports, DSI, animateurs pour leurs seuls
  créneaux. Aucun transfert à un tiers, aucun sous-traitant : hébergement
  interne.
- **Conservation des inscriptions et présences** : à définir avec la DPO. Une
  durée de deux saisons glissantes couvre le besoin de comparaison annuelle.
  Cette durée-là n'est pas encore appliquée automatiquement.
- **Restitution managériale** : les statistiques par direction sont agrégées.
  Ne pas diffuser d'assiduité nominative en dehors du service des sports.
- **Journal d'audit** : accès, décisions et émargements sont horodatés avec
  l'adresse IP. Deux durées, appliquées automatiquement (`src/lib/purge.ts`,
  déclenchée une fois par jour depuis le tableau de bord et par le cron s'il
  existe) :
  - **adresses IP effacées à 90 jours** — journal d'audit et dernier accès des
    animateurs. Passé un trimestre, une adresse ne répond plus à aucune question
    qu'on se pose encore ;
  - **lignes du journal supprimées à 365 jours** — la trace de l'action, elle,
    est la mémoire administrative du service : qui a validé cette inscription,
    qui a annulé cette séance. Elle sert une saison entière.

  Les jetons de connexion par courriel, valables trente minutes, sont supprimés
  au bout de 30 jours. Les durées sont réunies en tête de `src/lib/purge.ts`,
  pour être recopiables au registre des traitements et modifiables sans relire
  l'application. Elles sont également affichées en clair sous le titre de
  *Paramètres → Journal*.

---

## Structure du code

```
prisma/schema.prisma           modèle de données
prisma/seed.ts                 jeu de démonstration
src/proxy.ts                   cloisonnement réseau (INTERNAL_CIDRS)
src/lib/ldap.ts                LDAPS, groupes imbriqués, synchronisation
src/lib/coach-access.ts        jeton + PIN des animateurs
src/lib/seances.ts             génération du calendrier
src/lib/emargement.ts          construction et écriture des feuilles
src/lib/inscriptions.ts        capacité, liste d'attente, promotions
src/lib/stats.ts               indicateurs QVT et export CSV
src/lib/xlsx.ts                classeur Excel du bilan
src/lib/rappels.ts             rappels de séance et déclenchement
src/lib/annuaire.ts            miroir de l'annuaire et prise en compte des départs
src/lib/departs.ts             désactivation d'un compte et retrait des activités
src/lib/purge.ts               durées de conservation (journal, IP, jetons)
src/lib/net.ts                 adresse cliente et plages internes (estInterne)
src/lib/actions/               actions serveur, par domaine
src/app/emargement/            feuille publique des animateurs (mobile)
src/app/(app)/                 back-office et espace agent
tests/                         règles de calcul, en fonctions pures
tests/integration/             moteur d'inscription, sur une vraie base
```

## Tests

Deux niveaux, selon ce qu'ils peuvent prouver.

**`npm test`** — les règles dont tout le reste dépend, en fonctions pures :
génération du calendrier et exclusion des périodes de fermeture, date à partir
de laquelle un inscrit participe, places offertes par une séance, bornes de
semaine et de mois, robustesse des codes animateur, et les garde-fous qui
autorisent ou interdisent la prise en compte d'un départ. Ni base ni serveur, une
seconde.

**`npm run test:integration`** — capacité, liste d'attente, promotions, quota, et
les départs (place rendue au suivant, présences émargées conservées).
Ces règles enchaînent des états et changent de sens selon que l'activité
mutualise sa capacité : les vérifier contre un faux client Prisma aurait validé
nos propres approximations de `distinct` et des tris. Elles tournent donc sur
PostgreSQL, dans une base **dédiée** que la suite efface entre chaque cas :

```bash
npm run test:db:create   # une fois, la base de développement doit tourner
npm run test:integration
```

Les fichiers s'exécutent **un par un** (`--test-concurrency=1`) : chacun vide
toutes les tables entre deux cas, et deux fichiers en parallèle se retireraient
mutuellement leurs données sous les pieds.

La cible est `bolt_test`, fixée dans `.env.test`. La suite refuse de démarrer si
`DATABASE_URL` ne la désigne pas — elle vide toutes les tables, et se tromper de
base coûterait le jeu de démonstration.

## Commandes

```bash
npm run dev            # développement
npm run build          # build de production
npm run typecheck      # vérification TypeScript
npm run lint           # ESLint
npm test               # tests unitaires (sans base de données)
npm run test:db:create # crée la base bolt_test et y applique les migrations
npm run test:integration # tests du moteur d'inscription (sur bolt_test)
npm run db:migrate     # créer une migration
npm run db:deploy      # appliquer les migrations
npm run db:seed        # jeu de démonstration
```
