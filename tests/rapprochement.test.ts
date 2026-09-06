import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rapprocher, regrouperLibelles } from "../src/lib/rapprochement";
import { analyserCollage, cleComparaison, resoudreService } from "../src/lib/services";

/**
 * Référentiel des services et rapprochement des libellés d'annuaire.
 *
 * Tout l'écran repose sur des règles qu'on ne voit pas en relisant le code :
 * que « Services Techniques » et « Service Technique » sont le même service,
 * que « CTM » désigne le centre technique municipal sans partager un caractère
 * avec lui, et qu'une proposition douteuse doit sortir sans être appliquée.
 */

describe("clé de comparaison", () => {
  it("ignore la casse, les accents et la ponctuation", () => {
    assert.equal(cleComparaison("Petite Enfance"), cleComparaison("petite-enfance"));
    assert.equal(cleComparaison("Citoyenneté"), cleComparaison("CITOYENNETE"));
  });

  it("ignore le pluriel, source de la moitié des doublons", () => {
    assert.equal(
      cleComparaison("Services Techniques"),
      cleComparaison("Service Technique"),
    );
  });

  it("rend l'esperluette et sa forme écrite équivalentes", () => {
    assert.equal(
      cleComparaison("Population & Citoyenneté"),
      cleComparaison("Population et Citoyenneté"),
    );
  });

  it("ne rapproche pas deux services réellement différents", () => {
    assert.notEqual(cleComparaison("Service jeunesse"), cleComparaison("Service technique"));
  });
});

describe("analyse d'un collage", () => {
  it("accepte une liste par lignes, par virgules ou par points-virgules", () => {
    assert.deepEqual(analyserCollage("Voirie\nÉcoles;Sports, CCAS"), [
      "Voirie",
      "Écoles",
      "Sports",
      "CCAS",
    ]);
  });

  it("retire la numérotation d'une liste copiée", () => {
    assert.deepEqual(analyserCollage("1. Voirie\n2) Écoles\n3 - Sports"), [
      "Voirie",
      "Écoles",
      "Sports",
    ]);
  });

  it("ne rend rien pour un collage vide", () => {
    assert.deepEqual(analyserCollage("  \n\n ;; "), []);
  });
});

describe("résolution d'un libellé", () => {
  const referentiel = ["Petite enfance", "Services techniques"];

  it("applique la règle posée à la main avant tout le reste", () => {
    const regles = new Map([[cleComparaison("CTM"), "Services techniques"]]);
    assert.equal(resoudreService("CTM", regles, referentiel), "Services techniques");
  });

  it("retrouve un service du référentiel à la graphie près", () => {
    assert.equal(
      resoudreService("service technique", new Map(), referentiel),
      "Services techniques",
    );
  });

  it("retombe sur le service dont le nom ouvre le libellé", () => {
    assert.equal(
      resoudreService("Petite enfance — Crèche La Cigogne", new Map(), referentiel),
      "Petite enfance",
    );
  });

  it("conserve le libellé brut quand rien ne correspond", () => {
    // Ne rien reconnaître ne doit jamais effacer ce que dit l'annuaire.
    assert.equal(resoudreService("Cabinet du Maire", new Map(), referentiel), "Cabinet du Maire");
  });

  it("ne rend rien pour un libellé vide", () => {
    assert.equal(resoudreService("   ", new Map(), referentiel), null);
  });
});

describe("inventaire des libellés", () => {
  const ad = (brut: string | null) => ({ login: "cparfait", brut });
  const horsAd = (brut: string | null) => ({ login: "no_ad.camille.martin", brut });

  it("écarte ce qui figure déjà au référentiel, graphie comprise", () => {
    assert.deepEqual(regrouperLibelles([horsAd("DSI"), horsAd("dsi")], ["DSI"]), []);
  });

  it("sépare les comptes d'annuaire des autres", () => {
    const [e] = regrouperLibelles(
      [horsAd("Service info"), ad("Service info"), ad("Service info")],
      ["DSI"],
    );
    assert.equal(e.horsAnnuaire, 1);
    assert.equal(e.annuaire, 2);
  });

  it("classe les plus nombreux d'abord", () => {
    const noms = regrouperLibelles(
      [horsAd("Rare"), horsAd("Fréquent"), horsAd("Fréquent")],
      [],
    ).map((e) => e.libelle);
    assert.deepEqual(noms, ["Fréquent", "Rare"]);
  });
});

describe("rapprochement", () => {
  const referentiel = [
    "Centre technique municipal",
    "Service jeunesse",
    "Petite enfance",
    "Affaires scolaires",
  ];
  const un = (libelle: string) => ({ libelle, horsAnnuaire: 1, annuaire: 0 });
  const propose = (libelle: string) => rapprocher([un(libelle)], referentiel)[0];

  it("reconnaît un sigle", () => {
    const r = propose("CTM");
    assert.equal(r.proposition, "Centre technique municipal");
    assert.equal(r.confiance, "sure");
  });

  it("reconnaît l'inclusion, aux mots vides près", () => {
    const r = propose("Jeunesse");
    assert.equal(r.proposition, "Service jeunesse");
    assert.equal(r.confiance, "sure");
  });

  it("rattrape une faute de frappe sur un mot long", () => {
    const r = propose("Affaires scolaries");
    assert.equal(r.proposition, "Affaires scolaires");
    assert.notEqual(r.confiance, "aucune");
  });

  it("ne propose rien quand aucun mot ne rapproche", () => {
    const r = propose("Cabinet du Maire");
    assert.equal(r.proposition, null);
    assert.equal(r.confiance, "aucune");
  });

  it("ne propose rien quand le référentiel est vide", () => {
    const r = rapprocher([un("CTM")], [])[0];
    assert.equal(r.proposition, null);
    assert.deepEqual(r.candidats, []);
  });

  it("signale l'ambiguïté quand deux services se valent", () => {
    // « Maison des arts » hésite entre plusieurs « Maison des … » : la
    // proposition sort, mais jamais comme sûre.
    const r = rapprocher([un("Maison des arts")], [
      "Maison des jeunes",
      "Maison des associations",
    ])[0];
    assert.equal(r.ambigu, true);
    assert.notEqual(r.confiance, "sure");
  });

  it("reporte l'effectif, qui dit ce que le rattachement pèse", () => {
    const r = rapprocher([{ libelle: "CTM", horsAnnuaire: 2, annuaire: 5 }], referentiel)[0];
    assert.equal(r.horsAnnuaire, 2);
    assert.equal(r.annuaire, 5);
  });
});
