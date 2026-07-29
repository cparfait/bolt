#!/bin/sh
set -e

# Validation au démarrage (fail-fast : mieux vaut un conteneur qui refuse de
# démarrer qu'une faille de configuration découverte au premier émargement).
if [ "${#SESSION_SECRET}" -lt 32 ]; then
  echo "ERREUR : SESSION_SECRET absent ou trop court (32 caractères minimum)." >&2
  exit 1
fi
if [ "${#BOLT_ADMIN_PASSWORD}" -lt 8 ]; then
  echo "ERREUR : BOLT_ADMIN_PASSWORD absent ou trop court (8 caractères minimum)." >&2
  exit 1
fi
if [ -z "$DATABASE_URL" ]; then
  echo "ERREUR : DATABASE_URL non défini." >&2
  exit 1
fi
if [ -z "$INTERNAL_CIDRS" ]; then
  echo "AVERTISSEMENT : INTERNAL_CIDRS vide — le back-office et la connexion AD" >&2
  echo "                seront joignables depuis toutes les adresses autorisées" >&2
  echo "                par le reverse proxy." >&2
fi

echo "Bolt — application des migrations…"
node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma

echo "Bolt — démarrage du serveur…"
exec node server.js
