import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { borneDesRappels } from "../src/lib/rappels";
import { isoDate } from "../src/lib/dates";

/**
 * Heure d'envoi des rappels de séance.
 *
 * Le réglage dit « la veille à midi » ; le serveur, lui, vit en UTC. Tout le
 * risque est là : à Paris, midi tombe à 10 h UTC en été et à 11 h en hiver, et
 * un décalage d'une heure ne se remarque pas — les rappels partent, un peu
 * trop tôt ou un peu trop tard, et personne ne le signale jamais.
 *
 * Le second piège est la fin de soirée : à 23 h 30 UTC on est déjà au lendemain
 * à Paris, et la borne doit suivre le calendrier de la collectivité, pas celui
 * du conteneur.
 */

const REGLAGE = { rappelJoursAvant: 1, rappelHeure: "12:00" };

/** Un instant UTC, écrit tel qu'on le lit dans un journal. */
const t = (iso: string) => new Date(iso);

describe("borne des rappels", () => {
  it("attend l'heure réglée, à l'heure de Paris et non celle du serveur", () => {
    // Été : 12 h à Paris = 10 h UTC.
    assert.equal(borneDesRappels(REGLAGE, t("2026-07-08T09:59:00Z")), null);
    assert.equal(isoDate(borneDesRappels(REGLAGE, t("2026-07-08T10:00:00Z"))!), "2026-07-09");

    // Hiver : la même heure locale tombe une heure plus tard en UTC.
    assert.equal(borneDesRappels(REGLAGE, t("2026-01-15T10:59:00Z")), null);
    assert.equal(isoDate(borneDesRappels(REGLAGE, t("2026-01-15T11:00:00Z"))!), "2026-01-16");
  });

  it("bascule de jour au minuit de la collectivité, pas à celui d'UTC", () => {
    // 23 h 30 UTC = 1 h 30 le lendemain à Paris : la journée d'envoi a changé,
    // et l'heure réglée n'est pas encore revenue.
    assert.equal(borneDesRappels(REGLAGE, t("2026-07-08T23:30:00Z")), null);
    // Le même jour à 22 h locale, on est encore dans la journée d'envoi.
    assert.equal(isoDate(borneDesRappels(REGLAGE, t("2026-07-08T20:00:00Z"))!), "2026-07-09");
  });

  it("rappelle le jour même quand l'avance est nulle", () => {
    const g = { rappelJoursAvant: 0, rappelHeure: "08:30" };
    assert.equal(borneDesRappels(g, t("2026-07-08T06:00:00Z")), null); // 8 h locales
    assert.equal(isoDate(borneDesRappels(g, t("2026-07-08T06:30:00Z"))!), "2026-07-08");
  });

  it("borne l'avance à la semaine et retombe sur midi si l'heure est illisible", () => {
    const g = { rappelJoursAvant: 99, rappelHeure: "n'importe quoi" };
    assert.equal(borneDesRappels(g, t("2026-07-08T09:00:00Z")), null); // avant midi
    assert.equal(isoDate(borneDesRappels(g, t("2026-07-08T10:00:00Z"))!), "2026-07-15");
  });
});
