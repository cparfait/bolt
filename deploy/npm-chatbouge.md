# Nginx Proxy Manager — le maillon `chatbouge.chatillon92.fr`

Chaîne complète :

```
Internet ──443──> Apache (DMZ) ──80/tcp (pare-feu)──> NPM (LAN) ──> bolt_web:3000
```

Apache porte le cloisonnement (`deploy/apache-chatbouge.conf`) : refus par défaut,
puis réouverture de quatre préfixes. NPM n'a donc qu'un rôle de relais — mais il
doit être réglé correctement sur trois points, sans quoi le pointage se bloque de
lui-même en production.

---

## 1. Onglet *Details*

| Champ | Valeur | Pourquoi |
|---|---|---|
| Domain Names | `chatbouge.chatillon92.fr` | Apache conserve le `Host` (`ProxyPreserveHost On`) : sans ce nom exact, NPM sert son site par défaut et les actions serveur de Next.js échouent. |
| Scheme | `http` | Le conteneur écoute en clair sur 3000. |
| Forward Hostname / IP | `bolt_web` | NPM est sur le réseau `containers-lan` ; il résout le conteneur par son nom. Aucun port à publier sur l'hôte : le `ports:` de `docker-compose.yml` reste commenté. |
| Forward Port | `3000` | |
| Cache Assets | **désactivé** | Les réponses du pointage sont propres à un jeton et à une séance. Next.js pose déjà ses propres `Cache-Control`. |
| Block Common Exploits | activé | Sans effet connu sur le pointage (pas de chaîne de requête, tout passe en POST d'action serveur). Si un pointage échouait sans raison, c'est la première case à décocher pour tester. |
| Websockets Support | désactivé | Inutile en production : Next.js n'ouvre de WebSocket qu'en développement. |

## 2. Onglet *SSL*

**`None`.** Ni « Force SSL », ni « HSTS », ni « HTTP/2 ».

Le TLS est terminé sur Apache ; le tronçon Apache → NPM est en clair. Un « Force
SSL » renverrait un `301` vers `https://` à Apache, qui le suivrait vers
NPM : boucle de redirection, ou pointage cassé sans message clair.

HSTS est déjà posé par Apache et par l'application (`next.config.ts`).

## 3. Onglet *Advanced* — l'IP réelle du client

C'est le réglage indispensable. Par défaut NPM pose :

```nginx
proxy_set_header X-Forwarded-For $remote_addr;
```

Il **écrase** donc la valeur transmise par Apache, et l'application ne voit plus
qu'une seule adresse — celle d'Apache — pour tous les animateurs. Trois
conséquences, toutes vérifiables dans le code :

- le coupe-circuit anti-balayage du PIN est de 20 essais / 10 min **par IP**
  (`src/lib/coach-access.ts:188`) : avec une IP unique partagée, une vingtaine de
  codes mal saisis un lundi matin et **plus aucun animateur ne peut pointer** ;
- le filtre `INTERNAL_CIDRS` (`src/proxy.ts`) considère tout visiteur d'Internet
  comme interne, puisque l'IP d'Apache est dans les plages déclarées : le second
  verrou ne verrouille plus rien ;
- le journal d'audit (`src/lib/audit.ts:20`) horodate chaque pointage au nom
  d'Apache.

### La correction

Coller dans *Advanced* :

```nginx
# Rétablit l'adresse réelle du client à partir de X-Forwarded-For.
# On ne se bat pas contre le proxy_set_header de NPM : on corrige $remote_addr
# en amont, si bien que la valeur que NPM transmet devient la bonne.
set_real_ip_from  192.168.0.0;      # <-- IP de l'Apache en DMZ
real_ip_header    X-Forwarded-For;
real_ip_recursive on;

# Le TLS est terminé sur Apache : que l'application le sache.
proxy_set_header  X-Forwarded-Proto https;
```

Pourquoi `set_real_ip_from` plutôt qu'un `proxy_set_header X-Forwarded-For` ?
Parce qu'un `proxy_set_header` placé dans un bloc `location` l'emporte sur tous
ceux du bloc `server`, et que l'*Advanced* de NPM atterrit en contexte `server`
tandis que le `location` généré repose ses propres en-têtes par-dessus. La
correction serait donc silencieusement annulée selon la version de NPM.
`set_real_ip_from` agit à un autre étage : il réécrit `$remote_addr` lui-même,
avant que le `location` ne s'exécute. NPM continue d'envoyer
`X-Forwarded-For: $remote_addr` — mais `$remote_addr` vaut désormais l'adresse du
téléphone de l'animateur.

Conséquence à connaître : après cette réécriture, `$remote_addr` n'est plus l'IP
d'Apache. Ne mettez donc **pas** de `allow <ip-apache>; deny all;` ici, il
refuserait tout le monde. La restriction de source est le travail de la règle de
pare-feu, qui n'autorise déjà que l'Apache en DMZ vers le port 80 de NPM.

### Optionnel — refus par défaut aussi sur NPM

Apache filtre déjà. Ce bloc n'a d'intérêt que si NPM devait un jour recevoir du
trafic par un autre chemin que l'Apache en DMZ :

```nginx
set $bolt_public 0;
if ($request_uri ~ "^/(emargement|icones|_next/static)/") { set $bolt_public 1; }
if ($request_uri = "/favicon.ico")                        { set $bolt_public 1; }
if ($bolt_public = 0) { return 404; }
```

## 4. DNS interne — qui pointe sur quoi

Le DNS interne (AD) doit connaître les deux noms, avec des cibles différentes :

| Nom | DNS public | DNS interne pointe sur | Sert |
|---|---|---|---|
| `chatbouge.chatillon92.fr` | → IP publique de l'Apache | **Apache DMZ** | le pointage, et rien d'autre — comportement identique depuis le LAN et depuis Internet |
| `bolt.chatillon92.fr` (exemple) | **absent, volontairement** | **NPM** (443, wildcard) | le back-office des gestionnaires, depuis le LAN uniquement |

Ne pas pointer `chatbouge` interne sur NPM : NPM relaie tous les chemins, et
les IP internes passent le filtre `INTERNAL_CIDRS` — le même nom servirait alors
le pointage seul dehors et tout le back-office dedans. Un nom = un contenu.

NPM portant aussi le wildcard, c'est lui qui sert le HTTPS du nom interne du
back-office. Sur le Proxy Host `chatbouge`, en revanche, « Force SSL » doit
rester désactivé : Apache y arrive en HTTP.

## 4 bis. La règle pare-feu DMZ → LAN, et pourquoi elle est contenue

Les conteneurs ne publient aucun port sur l'hôte : tout entre par NPM, via le
réseau Docker dédié. Le flux venant d'Internet emprunte donc une règle
pare-feu Apache (DMZ) → NPM (LAN). Pour que ce trou ne débouche que sur le
pointage :

- la règle n'ouvre que **80/tcp**, d'une seule IP source vers une seule IP
  destination — jamais le 443 ;
- **tous les Proxy Hosts internes de NPM ont « Force SSL » coché** : sur le
  port 80, ils ne répondent qu'un 301 vers un 443 que le pare-feu bloque.
  Une requête au Host forgé depuis la DMZ tombe dans une impasse ;
- `chatbouge` est le **seul** host sans Force SSL : le seul servi sur le
  port 80, donc le seul joignable depuis la DMZ.

Le port 80 de NPM devient le couloir « venant du WAN » (une seule application),
le 443 reste le couloir interne. À chaque création d'un nouveau host interne,
cocher Force SSL fait partie de la recette — c'est ce qui le garde hors de
portée de la DMZ.

## 5. Vérifier — sans rien deviner

Depuis un téléphone **en 4G** (donc hors du réseau), ouvrir un lien d'émargement
et saisir le PIN. Puis, côté back-office, *Paramètres → Journal* : la ligne
`EMARGEMENT_ACCES` (c'est l'action journalisée à la validation du PIN,
`src/lib/coach-access.ts`) doit porter l'**IP publique du téléphone**.

- IP du téléphone → la chaîne est correcte, les trois problèmes ci-dessus sont écartés.
- IP d'Apache → `set_real_ip_from` n'a pas pris. Vérifier que l'IP indiquée est
  bien celle d'Apache vue par NPM, et que le module `realip` est présent
  (`nginx -t` dans le conteneur NPM signale une directive inconnue le cas échéant).

Et depuis l'extérieur, ces cinq chemins doivent tous répondre `403` — c'est
Apache qui refuse, sans même contacter NPM :

```bash
for p in / /connexion /parametres /api/health /inscriptions; do printf '%s ' "$p"; curl -sk -o /dev/null -w '%{http_code}\n' "https://chatbouge.chatillon92.fr$p"; done
```
