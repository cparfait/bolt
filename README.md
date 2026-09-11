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
| **Agent** | agent de la collectivité | identifiant Windows **ou adresse professionnelle**, LDAPS | non (interne / VPN) |
| **Agent, sans poste sur le réseau** | terrain, crèches, gardiennage, et les personnes hors annuaire | lien envoyé par courriel, **aucun mot de passe** | au choix : interne, ou `/acces` publié (voir plus bas) |
| **Service des sports, DSI** | agents | identifiant Windows ou adresse professionnelle, LDAPS | non (interne / VPN) |

La ligne qui compte est la deuxième : **`/connexion` — le seul écran où se
saisit un mot de passe de domaine — n'est publiée dans aucune configuration.**
Ouvrir l'application à Internet ne rend donc jamais un identifiant Active
Directory volé utilisable de l'extérieur.

L'écran de connexion accepte les deux formes : beaucoup d'agents ne connaissent
que leur adresse, et hésiter sur ce champ suffit à faire renoncer. Le mot de
passe reste celui du domaine. La traduction de l'adresse en `sAMAccountName` se
fait côté serveur (`resoudreIdentifiant`), sur les comptes Bolt puis sur le
miroir d'annuaire — tout ce qui suit, bind LDAPS et appartenance aux groupes,
continue de s'indexer sur le seul `sAMAccountName`. Deux comptes partageant une
adresse ne se départagent pas : la connexion est refusée plutôt que devinée.

Conséquence : **aucune identité Active Directory ne transite jamais hors du
réseau**, et le contrôleur de domaine n'est joignable que depuis le serveur
applicatif. C'est ce qu'un SaaS ne permet pas.

Le cloisonnement est appliqué à deux niveaux : par le reverse proxy, et par le
proxy applicatif `src/proxy.ts` (`INTERNAL_CIDRS`), qui refuse tout ce qui n'est
pas `/emargement/*` ni `/courriel/*` aux requêtes venues d'une IP hors des
plages internes.

### Accès des animateurs — deux chemins, cumulables

**Le lien sécurisé**, d'abord, et pour tous. Jeton aléatoire de 32 octets + code
PIN à 6 chiffres stocké haché (bcrypt). Verrouillage 15 minutes après 5 essais,
persisté en base. Expiration facultative, révocation immédiate, chaque accès
journalisé avec IP. C'est le seul chemin publié sur Internet, et le seul dont
dispose un prestataire extérieur.

**Le compte réseau**, ensuite, si l'animateur en a un. Une seule case sur sa
fiche, réservée à la DSI : son identifiant Windows. Renseignée, elle rattache le
compte de domaine et l'animateur se connecte comme n'importe quel agent ; vidée,
elle le détache. Rien à trancher, rien à cocher — le service des sports ne voit
même pas cette case, et n'a de toute façon aucun moyen de vérifier qu'un
identifiant désigne bien la bonne personne.

*L'identifiant local des versions précédentes n'est plus proposé : il
n'apportait rien que le compte réseau ne fasse pour un agent, ni que le code ne
fasse pour un prestataire, et c'était un mot de passe de plus à gérer. Les fiches
qui en portent un le gardent, avec un rappel de le remplacer.*

**Les deux se cumulent, et c'est le but.** L'éducateur sportif employé par la
ville pointe depuis son poste au bureau, et depuis son téléphone au gymnase, où
il n'y a ni poste ni réseau interne. Lui demander de choisir reviendrait à lui
retirer l'un des deux.

Le cumul n'élargit rien, parce que les deux chemins restent ce qu'ils sont :

- le compte ne franchit pas `requireUser`, qui refuse toute requête venue
  d'Internet — il ne sert que depuis le réseau ou le VPN ;
- valider le code n'ouvre **pas** de session applicative : il pose un `coachId`
  dans le cookie, jamais un `userId` (`verifierPin`, `src/lib/coach-access.ts`),
  et rien de ce qui exige un compte ne le lit ;
- aucune vérification du chemin par lien ne consulte le mode de compte : elle ne
  dépend que du jeton, du code et de l'animateur actif. Un lien qui fuite donne
  la feuille d'émargement, jamais l'identité Active Directory — qui n'est ni
  stockée ici, ni saisissable depuis l'extérieur ;
- désactiver l'animateur ferme les deux d'un seul geste.

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

**Cet accès est interne par défaut.** Le publier sur Internet est une décision
explicite, qui demande trois gestes simultanés — aucun ne suffit seul :

1. `PUBLIC_AGENT_ACCESS=1`, qui n'ouvre que le filtre applicatif de
   `src/proxy.ts` (`/acces`, `/mes-activites`, `/mentions`, `/demande-acces`) ;
2. le bloc « Espace agent » de `deploy/apache-chatbouge.conf`, reporté dans le
   vhost : sans lui, le proxy refuse ces chemins avant même de contacter
   l'application ;
3. *Paramètres → Général → URL publique*, sur laquelle se construisent les
   liens envoyés aux agents (`urlEspaceAgent`, `src/lib/settings.ts`). Laissée
   vide, les liens portent le nom du back-office, absent du DNS public : une
   impasse pour l'agent qui lit son courriel de chez lui, c'est-à-dire pour
   toute la population visée.

**`/connexion` n'est publiée dans aucun cas.** C'est l'invariant de cette
architecture : aucun mot de passe de domaine n'est saisissable depuis Internet,
donc un identifiant Active Directory volé ou hameçonné n'ouvre rien ici. C'est
plus fort qu'un second facteur posé sur une page de connexion publiée.

Ce que publier coûte, à peser avant et non après : n'importe qui peut déclencher
depuis Internet l'envoi d'un courriel par l'application — borné par les trois
compteurs décrits plus bas — et une adresse enregistrée devient à elle seule un
moyen d'accès. La sécurité de la boîte de l'agent devient donc une partie du
périmètre.

### Les personnes qui n'ont pas de compte de domaine

Vacataire, contrat court, agent d'un autre organisme, élu : ces personnes
n'existent pas dans l'annuaire. Elles ont un compte `no_ad.…` créé dans Bolt —
par le service des sports sur la fiche agent, ou par un animateur en séance —
et se connectent ensuite par le lien e-mail, comme les autres.

Reste à savoir comment elles demandent cet accès. **Pas en se l'accordant.** Un
code ou un lien reçu par courriel prouve qu'on est titulaire d'une boîte : cela
*authentifie*, cela n'*autorise* pas. Si une adresse quelconque suffisait à
obtenir un compte, le formulaire publié sur Internet serait une inscription
libre à un outil interne — et filtrer sur le domaine de la collectivité ne
sauverait rien, puisque la population visée est précisément celle qu'on
enregistre avec une adresse personnelle.

D'où le formulaire de **demande d'accès** (*Paramètres → Général*, désactivé par
défaut), servi sur `/demande-acces`. C'est le seul chemin de l'application qui
accepte une identité inconnue, et il ne délivre rien :

- aucun compte, aucune session, aucun droit — juste une ligne dans une file ;
- **aucun courriel vers l'adresse saisie**. Sinon le formulaire recréerait ce
  que les compteurs du lien de connexion empêchent : un moyen de faire expédier
  du courrier par la collectivité à une adresse arbitraire. Le seul envoi
  immédiat va au service des sports, à son adresse fixe, et il est plafonné à
  20 par heure pour que personne ne puisse noyer cette boîte-là ;
- la réponse est la même dans tous les cas — adresse inconnue, adresse déjà
  titulaire d'un compte, demande déjà déposée. Ce formulaire ne doit pas
  permettre de vérifier qui travaille dans la collectivité, pas plus que
  l'écran de connexion.

Le service des sports arbitre depuis *Demandes d'accès*, qui porte son compteur
dans la navigation. **La validation est le seul endroit où une identité naît
d'une adresse saisie sur Internet** — et c'est un geste humain. Elle crée le
compte `no_ad.…` et envoie à la personne un message lui annonçant que son accès
est ouvert, avec l'adresse de l'espace agent : pas un lien de connexion, dont
l'heure de validité serait écoulée quand elle lira le message. Un refus, lui,
n'envoie rien : le motif reste interne, et c'est au service de reprendre contact
s'il le juge utile.

L'écran `/acces` porte en permanence la mention « contactez le service des
sports » et le lien vers ce formulaire. En permanence, et non en réponse à une
adresse inconnue : afficher « adresse inconnue, contactez le service » ferait de
cette page l'oracle que `envoyerLienConnexion` se garde d'être.

Le premier de ces deux risques est borné par **trois** compteurs, et il en
fallait trois. Cinq demandes par quart d'heure et par adresse empêchent de
noyer la boîte d'un agent ; cinq par quart d'heure et par IP empêchent une
machine de balayer l'annuaire. Mais ces deux-là sont indexés sur une identité :
une source distribuée les contourne en faisant varier les deux, et aucun ne se
remplit jamais. Avec un millier d'adresses IP — quelques euros —, l'action
expédierait 20 000 courriels par heure sous le domaine de la collectivité. Le
dommage ne serait pas la fuite (chaque lien part à son seul destinataire et
expire en une heure) mais la **réputation d'expéditeur** : des semaines à se
réparer, et tout le courrier de la mairie en indésirable entre-temps. D'où un
troisième compteur, sans clé d'identité, plafonné à 200 envois par heure. Il ne
s'applique qu'aux demandes venues de l'extérieur : pendant une attaque, un
agent sur le réseau ou en VPN continue de recevoir son lien, faute de quoi le
plafond serait lui-même un déni de service à bas prix. Chaque déclenchement est
journalisé (`LIEN_MAGIQUE_PLAFOND`) — c'est le seul signal qui dira qu'on vous
attaque.

---

## Nommer l'application

« Bolt » est un nom de code. *Paramètres → Général* permet de le remplacer, ainsi
que la ligne qui l'accompagne (« Gestion des activités sportives »), **sans
reconstruire l'image** : le nouveau nom prend effet immédiatement partout —
écrans de connexion, navigation, titre de l'onglet, objet et signature des
courriels, application installée sur le téléphone des animateurs, propriétés du
classeur Excel exporté.

Le reste des textes ne cite jamais l'application par son nom : ils disent
« l'application ». C'est ce qui permet au renommage d'être complet plutôt que
d'un demi-écran.

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
ligne, liste d'attente automatique, historique de sa propre assiduité. Chaque
demande vaut **accusé de réception par courriel**, dont le texte dépend de ce
qui s'est réellement passé : inscription confirmée, demande transmise au
service des sports, ou place en liste d'attente avec son rang. Sans lui, l'agent
refermait son onglet sans plus aucune trace de sa demande — beaucoup en
concluaient que « ça n'avait pas marché » et recommençaient.

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

**Rappels de séance** — facultatifs, envoyés aux inscrits à un moment fixé :
tant de jours avant la séance, à telle heure (par défaut la veille à midi). Le
message porte un bouton **« Je ne pourrai pas venir »**.

Chaque inscrit reçoit son propre message, jamais une liste de destinataires,
et la campagne est cadencée à 25 messages par minute : c'est le plafond de
Microsoft 365 en soumission SMTP (30 par boîte et par minute), sous lequel
trois cents rappels partent en douze minutes sans qu'aucun ne soit refusé.
Chaque remise est notée par inscrit (`RappelEnvoye`) : si la messagerie cesse
de servir en cours de route — débit, authentification, réseau —, la campagne
s'interrompt et reprend au battement suivant, cinq minutes plus tard, là où
elle s'est arrêtée. Seule une adresse rejetée pour elle-même n'est pas
retentée. Une messagerie en panne se lit dans le journal (`RAPPELS_INTERROMPUS`,
au plus une ligne par heure).

### Deux boutons dans les courriels, et pourquoi ils ne demandent pas de compte

Prévenir d'une absence, ou rendre une place dont on ne veut plus, n'a de valeur
que fait vite : la place profite au suivant de la file, et l'animateur n'attend
pas. Or ces messages se lisent sur un téléphone, hors du réseau, et souvent par
ceux-là mêmes qui n'ont pas de poste au bureau. Exiger une connexion — réclamer
un lien, attendre un second courriel, retrouver la bonne séance dans une liste —
revient à ne rien demander : personne ne prévient, et l'information n'existe pas.

Le lien porte donc son autorisation : une **signature HMAC** (192 bits, dérivée
de `SESSION_SECRET`) qui ne vaut que pour un agent et un objet précis, et
n'ouvre aucune session. Aucune table, aucun jeton à expirer — c'est l'objet visé
qui périme le lien, une séance passée ou une place déjà rendue refusant l'action.
Rien ne se produit à l'ouverture de l'adresse : les passerelles de sécurité des
messageries visitent tous les liens d'un message avant de le remettre, le geste
demande donc un clic sur la page. Voir `src/lib/liens-courriel.ts`.

Deux usages aujourd'hui : **« Je ne pourrai pas venir »** sur le rappel de
séance, réversible d'un second clic ; et **« Je ne veux plus cette place »** sur
le courriel de promotion depuis la liste d'attente — une place attribuée sans
avoir été demandée, parfois des mois après l'inscription, restait sinon tenue
par quelqu'un qui ne viendrait pas pendant que le suivant attendait toujours.
Rendue, elle repart au suivant dans la seconde.

Le déclenchement vient d'un **ordonnanceur interne au conteneur**
(`src/lib/ordonnanceur.ts`, démarré par `src/instrumentation.ts`), qui bat
toutes les cinq minutes que quelqu'un soit connecté ou non. Aucun conteneur
supplémentaire, aucune crontab sur l'hôte. Il porte aussi les durées de
conservation et la synchronisation quotidienne de l'annuaire.

Ces trois tâches étaient auparavant déclenchées au fil du trafic, à l'affichage
du tableau de bord. C'était commode à écrire et faux en exploitation : sur une
application consultée par à-coups, personne ne passe la nuit ni le week-end, et
un rappel dû à 18 h pour le lendemain partait à la première connexion du matin
— parfois le jour même de la séance. La panne était en outre invisible : rien
n'échoue, les courriels sortent simplement trop tard.

Si vous préférez un ordonnanceur externe, définissez `CRON_TOKEN` et appelez
`GET /api/taches/rappels` — sans ce jeton la route reste fermée. Les deux voies
coexistent sans risque sur une instance unique : les verrous sont en base, et un inscrit n'est rappelé
qu'une fois par séance quelle que soit la voie.

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
liste d'attente est commune aux créneaux.

Le **quota par agent**, lui, se compte en créneaux : les deux séances
hebdomadaires d'une même activité en consomment deux, car ce sont deux places
sur le planning et deux collègues qui ne les auront pas. La **liste d'attente
est comptée à part**, avec son propre plafond — un agent limité à une activité
et dont le premier choix est complet peut ainsi prendre ce qui reste *et* rester
dans la file de ce qu'il voulait. Les deux plafonds se règlent dans
Paramètres → Général ; par défaut, une inscription et une attente.

Une activité peut se pratiquer **sans émargement** — salle de musculation en
libre accès, sans animateur pour pointer. La case se décoche sur la fiche de
l'activité, et la conséquence est surtout statistique : ses séances passées ne
sont plus comptées comme des feuilles jamais transmises, elles disparaissent de
l'alerte du tableau de bord, et le bilan affiche « — » au lieu de « 0 % » sur
ses colonnes de présence. Une fréquentation qu'on ne mesure pas n'est pas une
fréquentation nulle : un zéro dans un classeur qui circule en comité se lit
comme un échec, et se cite comme tel. Les inscriptions et le remplissage, eux,
restent comptés — c'est souvent l'activité la plus courue.

Décocher n'interdit pas de pointer : si une feuille est malgré tout remplie,
ses présences comptent normalement. Le drapeau dit « aucune feuille n'est
attendue », pas « aucune donnée n'est acceptée ».

Les **périodes de fermeture** (vacances scolaires, jours fériés, fermeture de la
piscine) sont déclarées au niveau de la saison, mais **dérogeables créneau par
créneau** : le formulaire de créneau liste toutes les périodes et l'on coche
celles que l'activité traverse malgré tout. La musculation en libre accès tourne
souvent pendant les petites vacances quand l'aquagym s'arrête avec la piscine.
La page *Saisons & calendrier* indique, pour chaque période, quelles activités
restent ouvertes.

La génération du calendrier est idempotente. Elle ne supprime jamais une séance
déjà émargée.

### Supprimer sans perdre la fréquentation

Un créneau qui n'aura plus lieu, une activité abandonnée : le service des sports
doit pouvoir les retirer. Mais présences et séances pendent au créneau, et une
suppression en cascade ferait changer rétroactivement le bilan d'une saison
close — les totaux présentés en comité social ne se retrouveraient plus, sans
que rien à l'écran n'explique pourquoi.

D'où deux issues, et **c'est l'historique qui tranche, pas l'utilisateur** :

- rien n'a jamais été émargé → la ligne est réellement supprimée ;
- une feuille existe → elle est **archivée**. Le créneau quitte le planning, les
  inscriptions et les feuilles d'émargement, ses séances à venir sont retirées
  du calendrier, celles qui portent déjà une présence ne sont pas touchées. Les
  statistiques, elles, continuent de le compter à l'identique.

Archiver une activité archive ses créneaux. Le geste se défait : *Activités*
liste en bas les activités retirées, la fiche d'une activité ses créneaux
retirés, chacun avec un bouton **Restaurer** — restaurer un créneau regénère
ses séances à venir.

C'est distinct de la **désactivation** (`actif`), qui ferme une activité aux
inscriptions en la laissant sous les yeux du service : ici, elle disparaît des
écrans de travail.

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
aurait aucune séance à émarger aujourd'hui), quatre activités, cinq créneaux,
quatre animateurs (un par mode d'accès), trente et un agents fictifs répartis
sur quatre directions, et un historique de fréquentation. La dernière séance
passée de chaque créneau reste volontairement non émargée, pour illustrer le
rattrapage côté animateur et l'alerte « feuilles non transmises ».

Le même jeu se charge **depuis l'application** — Paramètres → Remise à zéro →
*Jeu de test* — sur une base vide, sans passer par la ligne de commande : c'est
la façon de faire essayer l'outil au service des sports sur son propre serveur.
Le générateur est partagé (`src/lib/jeu-de-test.ts`), et crée exactement ce que
la remise à zéro efface : charger puis remettre à zéro rend la base telle qu'on
l'avait trouvée. Le mot de passe des comptes créés y est tiré au hasard et
affiché une seule fois, au lieu du `bolt` de la ligne de commande.

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

### Portainer — ne pas coller `docker-compose.yml`

Portainer déploie une stack en faisant `pull` avant `up`. Or `docker-compose.yml`
décrit une image à **construire** (`build: .`) : rien ne la publie sous ce nom,
et la stack échoue sur

```
pull access denied for bolt, repository does not exist or may require 'docker login'
```

C'est le symptôme d'un fichier fait pour la ligne de commande, déposé dans un
outil qui ne construit pas. Utilisez
[`deploy/portainer-stack.yml`](deploy/portainer-stack.yml), qui désigne une
image locale et interdit explicitement le `pull` :

```bash
# sur le serveur, une fois par mise à jour
cd /home/sysadmin/docker/bolt/bolt_data && git pull
docker build -t bolt:local .
```

puis, dans Portainer → Stacks → Web editor, coller ce fichier et renseigner les
variables. « Update the stack », même avec « Re-pull image », ne casse alors
plus rien : `pull_policy: never` dit à Docker que cette image n'existe que sur
la machine.

⚠ `docker image prune -a` détruit cette image : aucun registre ne sait la
restituer, et le redéploiement échoue ensuite sur le message ci-dessus.
Préférez `docker image prune` sans `-a`. Les données ne risquent rien — la base
vit dans un répertoire de l'hôte, qu'aucun élagage ne touche.

### Quelle version tourne ?

```
https://votre-domaine/api/health   →   {"status":"ok","version":"K7hR2…"}
```

`version` est l'identifiant de construction de Next : deux images différentes
ne le partagent jamais. Il répond à la question qui suit chaque déploiement, et
qu'on ne savait pas trancher depuis un téléphone — « est-ce l'ancienne version,
ou mon cache ? ». Une mise à jour qui échoue laisse le conteneur précédent en
place et ressemble en tout point à un cache tenace : si l'identifiant n'a pas
bougé après un redéploiement, ce n'est pas le navigateur.

La route est publiée sur Internet, comme sonde du healthcheck Docker. Elle
n'expose qu'une empreinte opaque, sans lien avec le code ni avec les données.

### Reverse proxy — l'essentiel

Le proxy doit renseigner `X-Forwarded-For` **en écrasant** toute valeur fournie
par le client : c'est cette adresse que `src/proxy.ts` compare à
`INTERNAL_CIDRS`.

Deux conséquences sur le réseau Docker, faciles à manquer :

- **`172.16.0.0/12` ne fait pas partie des plages internes.** C'est la plage
  des réseaux Docker : l'y mettre ferait de tout conteneur voisin un visiteur
  « interne », autorisé à atteindre la page de connexion Active Directory. Si
  votre LAN est réellement en 172.16–31, déclarez *votre* plage, pas le /12.
- **Le conteneur ne doit être joignable que par le proxy.** Une requête qui
  arrive sans passer par lui porte un `X-Forwarded-For` que personne n'a
  vérifié. Attachez donc `bolt_web` à un réseau partagé avec le seul reverse
  proxy (`PROXY_NETWORK=bolt_proxy` dans la stack, après
  `docker network create bolt_proxy` et le rattachement de NPM à ce réseau)
  plutôt qu'au réseau commun à toutes les applications du serveur.

Les mots de passe du compte de service LDAP et de la messagerie sont chiffrés
en base avec une clé dérivée de `SESSION_SECRET` (`src/lib/chiffrement.ts`).
Changer ce secret les rend illisibles : l'écran des paramètres le signale et
demande leur ressaisie.

Pour Apache, une configuration complète et commentée est fournie :
[`deploy/apache-chatbouge.conf`](deploy/apache-chatbouge.conf). Elle refuse tout
par défaut, puis rouvre les seuls préfixes nécessaires.

Exemple nginx, exposition minimale (émargement seul sur Internet) :

```nginx
# Les préfixes publics : la feuille d'émargement, les pages à un bouton
# ouvertes depuis un courriel, les icônes d'installation et les fichiers JS/CSS.
# Sans les deux derniers, la page s'affiche sans mise en forme.
location ~ ^/(emargement|courriel|icones|_next/static)/ {
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
**automatiquement une fois par jour**, portée par l'ordonnanceur interne (et
par le cron externe s'il est configuré), et reste déclenchable à la main depuis
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
- **Conservation des inscriptions et présences** : réglable en mois dans
  *Paramètres → Général*, 14 par défaut — la durée annoncée sur la fiche
  d'inscription papier. Elle s'applique **à la main**, par un bouton dans
  *Paramètres → Journal* qui annonce le décompte avant d'effacer : contrairement
  au journal, cet effacement est irréversible et emporte les statistiques de
  fréquentation des saisons concernées, il ne doit donc pas partir tout seul
  parce que quelqu'un a ouvert le tableau de bord. Le seuil se compte en
  saisons closes, jamais au milieu d'une saison. Deux durées à ne pas laisser
  diverger : celle réglée ici et celle qu'annoncent les mentions
  d'information — c'est l'écart entre les deux qu'un contrôle relève d'abord.
- **Déclarations et mentions d'information** : les textes signés à
  l'inscription (état de santé, responsabilité, mentions RGPD) sont éditables
  dans *Paramètres → Déclarations & RGPD*, avec gras, souligné et puces. Chaque
  publication crée une **version archivée** : une inscription enregistre le
  numéro de version acceptée, corriger un texte ne réécrit donc jamais ce qu'un
  agent déjà inscrit a lu. La mise en forme passe par un langage restreint
  (`src/lib/markup.ts`) et jamais par du HTML — la saisie ne peut rien exprimer
  qui devienne du code chez l'agent.
- **Restitution managériale** : les statistiques par direction sont agrégées.
  Ne pas diffuser d'assiduité nominative en dehors du service des sports.
- **Journal d'audit** : accès, décisions et émargements sont horodatés avec
  l'adresse IP. Deux durées, appliquées automatiquement (`src/lib/purge.ts`,
  déclenchée une fois par jour par l'ordonnanceur interne, et par le cron
  externe s'il existe) :
  - **adresses IP effacées à 90 jours** — journal d'audit et dernier accès des
    animateurs. Passé un trimestre, une adresse ne répond plus à aucune question
    qu'on se pose encore ;
  - **lignes du journal supprimées à 365 jours** — la trace de l'action, elle,
    est la mémoire administrative du service : qui a validé cette inscription,
    qui a annulé cette séance. Elle sert une saison entière.

  Les jetons de connexion par courriel, valables une heure, sont supprimés
  au bout de 30 jours. Les durées sont réunies en tête de `src/lib/purge.ts`,
  pour être recopiables au registre des traitements et modifiables sans relire
  l'application. Elles sont également affichées en clair sous le titre de
  *Paramètres → Journal*.

### Remise à zéro

*Paramètres → Remise à zéro*, **administrateurs seuls**. Le cas visé est la fin
de la période d'essai : les activités ont été saisies pour tester, la
collectivité veut repartir de la première inscription réelle — sans refaire le
LDAPS, le SMTP ni le référentiel des services, qui ont coûté des heures et ne
dépendent d'aucune saison.

Sont effacés : présences, absences, participations, inscriptions, séances,
créneaux, activités, saisons et périodes de fermeture, animateurs et leurs
accès, lieux, comptes AGENT et COACH, demandes d'accès, journal d'audit.

Sont conservés : les paramètres (annuaire, messagerie, général), le référentiel
des services et ses regroupements, les déclarations et mentions d'information,
le miroir de l'annuaire — une copie que la synchronisation reconstituerait de
toute façon —, et les comptes ADMIN et GESTIONNAIRE, sans quoi celui qui clique
se déconnecterait lui-même.

La ligne de partage est tenue dans `src/lib/reinitialisation.ts`, et l'effacement
se fait en une transaction : interrompu à mi-chemin, il laisserait des séances
sans saison que rien ne sait rattraper. Le geste est gardé par un mot à recopier
plutôt qu'une case à cocher, et laisse dans le journal vidé une première ligne
`REINITIALISATION` qui dit qui, quand, et combien. Aucune sauvegarde n'est faite
au passage : l'instantané de base, s'il est voulu, se prend avant.

Le même écran porte le **jeu de test** (`src/lib/jeu-de-test.ts`), qui remplit
la base de ce que la remise à zéro vient d'en retirer — une collectivité
fictive complète, pour essayer les écrans qui n'ont rien à montrer à vide. Il
refuse de s'installer tant qu'il reste des données d'exploitation : mêlés à de
vrais agents, ces comptes fictifs ne se distingueraient plus dans les listes ni
dans les statistiques.

---

## Structure du code

```
prisma/schema.prisma           modèle de données
prisma/seed.ts                 amorçage d'une base neuve, en ligne de commande
src/lib/jeu-de-test.ts         jeu de démonstration (seed et bouton d'administration)
src/lib/reinitialisation.ts    remise à zéro : ce qui s'efface, ce qui reste
src/proxy.ts                   cloisonnement réseau (INTERNAL_CIDRS)
src/lib/ldap.ts                LDAPS, groupes imbriqués, synchronisation
src/lib/coach-access.ts        jeton + PIN des animateurs
src/lib/liens-courriel.ts      signature des boutons envoyés par courriel
src/lib/secret.ts              le secret dont dérivent cookies et signatures
src/lib/chiffrement.ts         chiffrement des mots de passe LDAP et SMTP en base
src/lib/seances.ts             génération du calendrier
src/lib/emargement.ts          construction et écriture des feuilles
src/lib/inscriptions.ts        capacité, liste d'attente, promotions
src/lib/stats.ts               indicateurs QVT et export CSV
src/lib/xlsx.ts                classeur Excel du bilan
src/lib/rappels.ts             rappels de séance et déclenchement
src/lib/annuaire.ts            miroir de l'annuaire et prise en compte des départs
src/lib/departs.ts             désactivation d'un compte et retrait des activités
src/lib/purge.ts               durées de conservation (journal, IP, jetons, inscriptions)
src/lib/ordonnanceur.ts        battement des tâches de fond, dans le conteneur
src/instrumentation.ts         démarrage de l'ordonnanceur au lancement du serveur
src/lib/declarations.ts        déclarations et mentions RGPD, versionnées
src/lib/markup.ts              mise en forme restreinte des textes (gras, souligné, puces)
src/lib/net.ts                 adresse cliente et plages internes (estInterne)
src/lib/actions/               actions serveur, par domaine
src/app/emargement/            feuille publique des animateurs (mobile)
src/app/courriel/              pages à un bouton ouvertes depuis un message
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
