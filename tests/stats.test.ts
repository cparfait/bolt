import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  agregerAssiduite,
  agregerFiabilite,
  agregerIndicateurs,
  agregerMensuel,
  agregerParActivite,
  agregerParService,
  attenduA,
  bilanSeance,
  motifNormalise,
  placesOffertes,
  repartirEnParts,
  type InscriptionPourPlaces,
  type PresencePourBilan,
} from "../src/lib/stats";
import { cleComparaison } from "../src/lib/services";
import { jourUtc } from "../src/lib/dates";

/**
 * Lot D — les formules du bilan, sur des séances en mémoire.
 *
 * Chaque test recompose à la main le chiffre attendu : c'est la définition
 * documentée en tête de src/lib/stats.ts qui est vérifiée ici, pas le code.
 */

const ACTIVITE = { id: "a1", nom: "Yoga", couleur: "#000", suiviPresence: true };

type Statut = "VALIDEE" | "DESISTEE" | "LISTE_ATTENTE";

function inscrit(
  userId: string,
  statut: Statut = "VALIDEE",
  entree = "2026-09-01",
  sortie?: string,
): InscriptionPourPlaces {
  return {
    userId,
    statut,
    demandeAt: jourUtc(entree),
    decisionAt: sortie ? jourUtc(sortie) : jourUtc(entree),
    promuAt: null,
  };
}

function seance(opts: {
  id?: string;
  date: string;
  statut?: "FAITE" | "PLANIFIEE" | "ANNULEE";
  capacite?: number;
  partagee?: boolean;
  inscriptions?: InscriptionPourPlaces[];
  presences?: PresencePourBilan[];
  motif?: string | null;
  activite?: typeof ACTIVITE;
}) {
  const activite = opts.activite ?? ACTIVITE;
  return {
    id: opts.id ?? `s-${opts.date}`,
    creneauId: `c-${activite.id}`,
    date: jourUtc(opts.date),
    statut: opts.statut ?? "FAITE",
    motifAnnulation: opts.motif ?? null,
    creneau: {
      jour: "LUNDI" as const,
      heureDebut: "12:15",
      capacite: opts.capacite ?? 10,
      activite: { ...activite, capacitePartagee: opts.partagee ?? false, capacite: 12 },
      inscriptions: opts.inscriptions ?? [],
    },
    presences: opts.presences ?? [],
  };
}

const present = (userId: string): PresencePourBilan => ({ userId, etat: "PRESENT" });
const absent = (userId: string): PresencePourBilan => ({ userId, etat: "ABSENT" });

describe("attenduA — qui la séance attendait", () => {
  const seanceDu = jourUtc("2026-10-05");

  it("attend un validé depuis son entrée", () => {
    assert.equal(attenduA(inscrit("u1", "VALIDEE", "2026-09-01"), seanceDu), true);
    assert.equal(attenduA(inscrit("u1", "VALIDEE", "2026-11-01"), seanceDu), false);
  });

  it("attend un désisté entre son entrée et sa sortie, sortie exclue", () => {
    const parti = inscrit("u1", "DESISTEE", "2026-09-01", "2026-10-20");
    assert.equal(attenduA(parti, seanceDu), true);
    assert.equal(attenduA(parti, jourUtc("2026-10-20")), false, "le jour du départ");
    assert.equal(attenduA(parti, jourUtc("2026-11-02")), false);
  });

  it("prend la promotion comme entrée d'un désisté qui a attendu son tour", () => {
    const promu = { ...inscrit("u1", "DESISTEE", "2026-09-01", "2026-10-20"), promuAt: jourUtc("2026-10-10") };
    assert.equal(attenduA(promu, seanceDu), false, "encore en file le 5 octobre");
    assert.equal(attenduA(promu, jourUtc("2026-10-12")), true);
  });

  it("n'attend jamais une liste d'attente", () => {
    assert.equal(attenduA(inscrit("u1", "LISTE_ATTENTE"), seanceDu), false);
  });
});

describe("bilanSeance — présents / attendus", () => {
  it("compte comme absent l'attendu sans ligne, pas seulement le pointé absent", () => {
    const s = seance({
      date: "2026-10-05",
      inscriptions: [inscrit("u1"), inscrit("u2"), inscrit("u3")],
      presences: [present("u1"), absent("u2")], // u3 : rien
    });
    assert.deepEqual(bilanSeance(s), { presents: 1, attendus: 3, absents: 2 });
  });

  it("ajoute le ponctuel pointé au numérateur et au dénominateur", () => {
    const s = seance({
      date: "2026-10-05",
      inscriptions: [inscrit("u1")],
      presences: [present("u1"), present("invite")],
    });
    assert.deepEqual(bilanSeance(s), { presents: 2, attendus: 2, absents: 0 });
  });

  it("ne compte pas un inscrit entré après la séance", () => {
    const s = seance({
      date: "2026-10-05",
      inscriptions: [inscrit("u1"), inscrit("u2", "VALIDEE", "2026-11-01")],
      presences: [present("u1")],
    });
    assert.deepEqual(bilanSeance(s), { presents: 1, attendus: 1, absents: 0 });
  });

  it("attend encore un désisté aux séances d'avant son départ", () => {
    const s = seance({
      date: "2026-10-05",
      inscriptions: [inscrit("u1"), inscrit("u2", "DESISTEE", "2026-09-01", "2026-10-20")],
      presences: [present("u1")],
    });
    assert.deepEqual(bilanSeance(s), { presents: 1, attendus: 2, absents: 1 });
  });
});

describe("placesOffertes — avec les ponctuels", () => {
  it("ajoute les ponctuels pointés à la capacité du créneau", () => {
    const s = seance({
      date: "2026-10-05",
      capacite: 10,
      inscriptions: [inscrit("u1")],
      presences: [present("u1"), present("invite")],
    });
    assert.equal(placesOffertes(s), 11);
  });

  it("en capacité mutualisée, compte les attendus du jour — désistés compris — plus les ponctuels", () => {
    const s = seance({
      date: "2026-10-05",
      partagee: true,
      inscriptions: [inscrit("u1"), inscrit("u2", "DESISTEE", "2026-09-01", "2026-11-01")],
      presences: [present("u1"), present("u2"), present("invite")],
    });
    assert.equal(placesOffertes(s), 3);
  });

  it("ne dépasse donc plus 100 % de remplissage avec un invité", () => {
    const s = seance({
      date: "2026-10-05",
      capacite: 1,
      inscriptions: [inscrit("u1")],
      presences: [present("u1"), present("invite")],
    });
    assert.equal(bilanSeance(s).presents / placesOffertes(s), 1);
  });
});

describe("agregerIndicateurs", () => {
  const today = jourUtc("2026-10-15");
  const seances = [
    seance({
      id: "s1",
      date: "2026-10-05",
      inscriptions: [inscrit("u1"), inscrit("u2")],
      presences: [present("u1")],
    }),
    seance({
      id: "s2",
      date: "2026-10-12",
      inscriptions: [inscrit("u1"), inscrit("u2")],
      presences: [present("u1"), present("u2"), present("invite")],
    }),
    seance({ id: "s3", date: "2026-10-14", statut: "PLANIFIEE", inscriptions: [inscrit("u1")] }),
    seance({ id: "s4", date: "2026-10-15", statut: "PLANIFIEE", inscriptions: [inscrit("u1")] }),
    seance({ id: "s5", date: "2026-10-07", statut: "ANNULEE" }),
    seance({ id: "s6", date: "2026-10-22", statut: "PLANIFIEE" }),
  ];

  it("mesure le taux de présence en présents / attendus", () => {
    const ind = agregerIndicateurs(seances, new Set(["s1", "s2", "s3"]), 2, today);
    // s1 : 1 présent sur 2 attendus ; s2 : 3 présents sur 3 (2 inscrits + 1 invité).
    assert.equal(ind.presents, 4);
    assert.equal(ind.absents, 1);
    assert.equal(ind.tauxPresence, 80);
    assert.equal(ind.agentsUniques, 3);
    assert.equal(ind.frequentationMoyenne, 2);
  });

  it("rapporte les feuilles remplies aux feuilles attendues jusqu'à la veille", () => {
    // s4 est du jour même : pas encore en retard, hors dénominateur.
    const ind = agregerIndicateurs(seances, new Set(["s1", "s2", "s3"]), 2, today);
    assert.equal(ind.seancesPassees, 3);
    assert.equal(ind.tauxEmargement, 67, "2 émargées sur 3 attendues");
    assert.equal(ind.seancesSansEmargement, 0);
  });

  it("écarte du dénominateur une séance passée sans feuille attendue", () => {
    const ind = agregerIndicateurs(seances, new Set(["s1", "s2"]), 2, today);
    assert.equal(ind.seancesPassees, 2);
    assert.equal(ind.seancesSansEmargement, 1, "s3, passée mais sans feuille attendue");
    assert.equal(ind.tauxEmargement, 100);
  });

  it("ne rapporte pas le remplissage à plus de 100 %", () => {
    const ind = agregerIndicateurs(seances, new Set(), 2, today);
    assert.equal(ind.capacite, 10 + 11);
    assert.equal(ind.tauxRemplissage, 19);
  });
});

describe("agregerParActivite", () => {
  it("applique la même formule que la synthèse, activité par activité", () => {
    const lignes = agregerParActivite(
      [
        seance({
          date: "2026-10-05",
          inscriptions: [inscrit("u1"), inscrit("u2")],
          presences: [present("u1")],
        }),
        seance({ date: "2026-10-12", statut: "ANNULEE", inscriptions: [inscrit("u1")] }),
      ],
      [
        { userId: "u1", activiteId: "a1" },
        { userId: "u2", activiteId: "a1" },
        { userId: "u1", activiteId: "inconnue" },
      ],
    );
    assert.equal(lignes.length, 1);
    const [yoga] = lignes;
    assert.equal(yoga.seancesEmargees, 1);
    assert.equal(yoga.inscrits, 2);
    assert.equal(yoga.presents, 1);
    assert.equal(yoga.absents, 1);
    assert.equal(yoga.tauxPresence, 50);
  });
});

describe("agregerMensuel", () => {
  it("regroupe par mois en UTC et comble les mois vides", () => {
    const points = agregerMensuel([
      seance({ date: "2026-09-28", inscriptions: [inscrit("u1")], presences: [present("u1")] }),
      seance({ date: "2026-10-31", statut: "PLANIFIEE" }),
      seance({ date: "2026-11-02", inscriptions: [inscrit("u1")], presences: [present("u1")] }),
    ]);
    assert.deepEqual(
      points.map((p) => [p.cle, p.seances, p.presents]),
      [
        ["2026-09", 1, 1],
        ["2026-10", 0, 0],
        ["2026-11", 1, 1],
      ],
    );
  });
});

describe("agregerParService — effectifs après regroupement", () => {
  const effectifs = new Map<string, number>([
    [cleComparaison("Petite Enfance"), 40],
    [cleComparaison("Sports"), 5],
  ]);
  const user = (service: string | null, direction: string | null = null) => ({ service, direction });

  it("retrouve l'effectif d'un service résolu quelle que soit la graphie", () => {
    const lignes = agregerParService(
      [
        { userId: "u1", user: user("Petite enfance") },
        { userId: "u2", user: user("Petite Enfance") },
        { userId: "u2", user: user("Petite Enfance") }, // deuxième activité : même agent
      ],
      effectifs,
    );
    assert.equal(lignes.length, 1);
    assert.equal(lignes[0].inscrits, 2);
    assert.equal(lignes[0].effectif, 40);
    assert.equal(lignes[0].couverture, 5);
  });

  it("garde une couverture au-delà de 100 % plutôt que de la plafonner", () => {
    const lignes = agregerParService(
      Array.from({ length: 6 }, (_, i) => ({ userId: `u${i}`, user: user("Sports") })),
      effectifs,
    );
    assert.equal(lignes[0].couverture, 120);
  });

  it("laisse l'effectif inconnu pour un service que l'annuaire ignore", () => {
    const [ligne] = agregerParService([{ userId: "u1", user: user(null, "DGS") }], effectifs);
    assert.equal(ligne.libelle, "DGS");
    assert.equal(ligne.effectif, null);
    assert.equal(ligne.couverture, null);
  });

  it("fait sommer les parts à 100", () => {
    const lignes = agregerParService(
      [
        { userId: "u1", user: user("A") },
        { userId: "u2", user: user("B") },
        { userId: "u3", user: user("C") },
      ],
      new Map(),
    );
    assert.equal(lignes.reduce((n, l) => n + l.part, 0), 100);
  });
});

describe("repartirEnParts", () => {
  it("somme à 100 en ajustant la plus grande part", () => {
    assert.deepEqual(repartirEnParts([1, 1, 1]), [34, 33, 33]);
    assert.deepEqual(repartirEnParts([3, 1, 0]), [75, 25, 0]);
    assert.equal(repartirEnParts([49.6, 49.6, 0.8]).reduce((a, b) => a + b, 0), 100);
  });

  it("rend des zéros sans total", () => {
    assert.deepEqual(repartirEnParts([0, 0]), [0, 0]);
  });
});

describe("agregerAssiduite — venus", () => {
  it("distingue les venus des inscrits sans séance émargée", () => {
    const seances = [
      seance({ id: "s1", date: "2026-10-05", presences: [present("u1")] }),
      seance({ id: "s2", date: "2026-10-12", presences: [present("u1")] }),
    ];
    const autreCreneau = { ...seance({ id: "s9", date: "2026-10-12", statut: "PLANIFIEE" }), creneauId: "c-autre" };
    const a = agregerAssiduite([...seances, autreCreneau], [
      { userId: "u1", creneauId: "c-a1", decisionAt: jourUtc("2026-09-01"), demandeAt: jourUtc("2026-09-01") },
      { userId: "u2", creneauId: "c-a1", decisionAt: jourUtc("2026-09-01"), demandeAt: jourUtc("2026-09-01") },
      // Inscrit sur un créneau sans séance émargée : ni venu, ni « jamais venu ».
      { userId: "u3", creneauId: "c-autre", decisionAt: jourUtc("2026-09-01"), demandeAt: jourUtc("2026-09-01") },
    ]);
    assert.equal(a.agents, 3);
    assert.equal(a.venus, 1);
    assert.equal(a.jamaisVenus, 1);
    assert.equal(a.occasionnels, 1);
    assert.equal(a.assidus, 1);
    assert.notEqual(a.agents - a.jamaisVenus, a.venus, "l'ancienne soustraction se trompait");
    assert.equal(a.tauxAssiduite, 50);
  });
});

describe("agregerFiabilite", () => {
  const today = jourUtc("2026-10-15");
  const seances = [
    seance({ id: "s1", date: "2026-10-05", presences: [present("u1"), absent("u2")] }),
    seance({ id: "s2", date: "2026-10-12", presences: [absent("u1")] }),
    seance({ id: "s3", date: "2026-10-07", statut: "ANNULEE", motif: "  Gymnase fermé " }),
    seance({ id: "s4", date: "2026-10-28", statut: "ANNULEE", motif: "" }),
    seance({ id: "s5", date: "2026-10-22", statut: "PLANIFIEE" }),
  ];

  it("rapporte les annulations aux séances passées ou annulées", () => {
    const f = agregerFiabilite(seances, [], today);
    assert.equal(f.seancesPrevues, 4, "s5 est à venir");
    assert.equal(f.tauxAnnulation, 50);
  });

  it("ne compte une absence annoncée que confirmée par une ligne ABSENT", () => {
    const f = agregerFiabilite(
      seances,
      [
        { seanceId: "s1", userId: "u2" }, // pointée absente : confirmée
        { seanceId: "s1", userId: "u1" }, // finalement venue
        { seanceId: "s2", userId: "u3" }, // pas de ligne sur la feuille
        { seanceId: "s5", userId: "u1" }, // séance à venir
      ],
      today,
    );
    assert.equal(f.absencesConstatees, 2);
    assert.equal(f.absencesAnnoncees, 1);
    assert.equal(f.partAnnoncee, 50);
  });

  it("normalise les motifs comme la page de détail", () => {
    const f = agregerFiabilite(seances, [], today);
    assert.deepEqual(f.motifs, [
      { motif: "Gymnase fermé", nombre: 1 },
      { motif: "Motif non renseigné", nombre: 1 },
    ]);
    assert.equal(motifNormalise("   "), "Motif non renseigné");
    assert.equal(motifNormalise(null), "Motif non renseigné");
    assert.equal(motifNormalise(" Pluie "), "Pluie");
  });
});
