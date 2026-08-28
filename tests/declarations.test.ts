import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TEXTES_PAR_DEFAUT,
  champDeclaration,
  declarationsCompletes,
  declarationsManquantes,
  libelleDeclaration,
  prochaineVersion,
  textesModifies,
  type TextesLegaux,
} from "../src/lib/declarations";

/**
 * Déclarations acceptées à l'inscription.
 *
 * Ce qui se joue ici est la valeur d'une preuve : si une seule déclaration peut
 * être contournée, l'inscription en ligne devient plus légère que la fiche
 * papier qu'elle remplace, et la commune perd la décharge qu'elle recueillait.
 * Depuis que les textes sont modifiables, s'y ajoute une seconde exigence :
 * une modification ne doit jamais réécrire ce qu'un agent a déjà accepté.
 */

const DECLARATIONS = TEXTES_PAR_DEFAUT.declarations;

describe("textes par défaut", () => {
  it("reprend les cinq déclarations de la fiche papier", () => {
    assert.equal(DECLARATIONS.length, 5);
  });

  it("reprend les huit mentions d'information", () => {
    assert.equal(TEXTES_PAR_DEFAUT.mentions.length, 8);
  });

  it("donne à chaque déclaration une clé distincte", () => {
    // Deux clés identiques feraient partager une case à cocher : l'agent en
    // cocherait une et en accepterait deux.
    assert.equal(new Set(DECLARATIONS.map((d) => d.cle)).size, DECLARATIONS.length);
  });

  it("préfixe les champs de formulaire, pour ne heurter aucun autre nom", () => {
    assert.equal(champDeclaration("sante"), "declaration_sante");
  });

  it("désigne chaque déclaration par son amorce en gras", () => {
    assert.deepEqual(DECLARATIONS.map(libelleDeclaration), [
      "Je certifie",
      "Je m'engage",
      "J'atteste",
      "Je suis informé.e",
      "Je prends acte",
    ]);
  });
});

describe("declarationsCompletes", () => {
  const toutes = DECLARATIONS.map((d) => d.cle);

  it("accepte le jeu complet", () => {
    assert.equal(declarationsCompletes(DECLARATIONS, toutes), true);
  });

  it("refuse s'il en manque une, quelle qu'elle soit", () => {
    for (const d of DECLARATIONS) {
      const sansElle = toutes.filter((c) => c !== d.cle);
      assert.equal(
        declarationsCompletes(DECLARATIONS, sansElle),
        false,
        `« ${libelleDeclaration(d)} » contournée`,
      );
    }
  });

  it("refuse une liste vide", () => {
    assert.equal(declarationsCompletes(DECLARATIONS, []), false);
  });

  it("ne se laisse pas remplir de clés inventées", () => {
    // Un formulaire forgé à la main n'accepte rien en envoyant du bruit.
    assert.equal(declarationsCompletes(DECLARATIONS, ["autre", "sante", "encore"]), false);
  });

  it("ignore les doublons", () => {
    assert.equal(declarationsCompletes(DECLARATIONS, [...toutes, ...toutes]), true);
  });

  it("suit les déclarations en vigueur, pas une liste figée", () => {
    // Une déclaration ajoutée en paramètres devient obligatoire aussitôt.
    const ajoutee = [...DECLARATIONS, { cle: "dabc1234", texte: "**Je m'engage** encore" }];
    assert.equal(declarationsCompletes(ajoutee, toutes), false);
    assert.equal(declarationsCompletes(ajoutee, [...toutes, "dabc1234"]), true);
  });
});

describe("declarationsManquantes", () => {
  it("nomme celles qui manquent, dans l'ordre du formulaire", () => {
    const manquantes = declarationsManquantes(DECLARATIONS, ["sante", "arret"]);
    assert.deepEqual(
      manquantes.map((d) => d.cle),
      ["exactitude", "responsabilite", "accident"],
    );
  });

  it("ne renvoie rien quand tout est coché", () => {
    assert.deepEqual(
      declarationsManquantes(
        DECLARATIONS,
        DECLARATIONS.map((d) => d.cle),
      ),
      [],
    );
  });
});

describe("prochaineVersion", () => {
  it("prend la date du jour quand elle est libre", () => {
    assert.equal(prochaineVersion("2026-08-28", ["2026-08-27"]), "2026-08-28");
  });

  it("suffixe quand la journée a déjà vu une version", () => {
    assert.equal(prochaineVersion("2026-08-28", ["2026-08-28"]), "2026-08-28-2");
  });

  it("continue de compter au-delà de la deuxième", () => {
    assert.equal(
      prochaineVersion("2026-08-28", ["2026-08-28", "2026-08-28-2", "2026-08-28-3"]),
      "2026-08-28-4",
    );
  });
});

describe("textesModifies", () => {
  const base: TextesLegaux = TEXTES_PAR_DEFAUT;

  it("ne voit pas de modification dans un enregistrement à l'identique", () => {
    // Sans cela, ouvrir l'écran et enregistrer par réflexe publierait une
    // version fantôme, et l'historique deviendrait illisible.
    assert.equal(textesModifies(base, { ...base }), false);
  });

  it("ignore le seul changement de version", () => {
    assert.equal(textesModifies(base, { ...base, version: "2030-01-01" }), false);
  });

  it("repère un texte de déclaration modifié", () => {
    const apres = {
      ...base,
      declarations: base.declarations.map((d, i) =>
        i === 0 ? { ...d, texte: `${d.texte} (précision)` } : d,
      ),
    };
    assert.equal(textesModifies(base, apres), true);
  });

  it("repère une déclaration retirée", () => {
    assert.equal(
      textesModifies(base, { ...base, declarations: base.declarations.slice(1) }),
      true,
    );
  });

  it("repère une mention RGPD modifiée", () => {
    const apres = {
      ...base,
      mentions: base.mentions.map((m, i) => (i === 3 ? { ...m, texte: "24 mois" } : m)),
    };
    assert.equal(textesModifies(base, apres), true);
  });
});
