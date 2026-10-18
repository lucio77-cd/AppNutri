import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection, doc, getDoc, getDocs, getFirestore, query, where,
  runTransaction,
} from "firebase/firestore";
import { publicarCardapioAtomico } from "../shared/cardapio-publicacao-core.js";

const projectId = "demo-app-nutri";
let env;
let db;

const sdk = { collection, doc, getDocs, getFirestore, query, where, runTransaction };

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: await readFile("tests/firestore.test.rules", "utf8"),
    },
  });
});

beforeEach(async () => {
  await env.clearFirestore();
  db = env.authenticatedContext("nutri-teste").firestore();
});

after(async () => {
  await env.cleanup();
});

async function prepararCliente({ comCardapioVigente = true } = {}) {
  await env.withSecurityRulesDisabled(async (context) => {
    const adminDb = context.firestore();
    await import("firebase/firestore").then(({ setDoc }) =>
      setDoc(doc(adminDb, "clientes", "cliente-teste"), {
        nome: "Cliente de teste",
        ...(comCardapioVigente ? { cardapioVigenteId: "cardapio-antigo" } : {}),
      })
    );
    if (comCardapioVigente) {
      const ref = doc(adminDb, "clientes", "cliente-teste", "cardapios", "cardapio-antigo");
      const { setDoc } = await import("firebase/firestore");
      await setDoc(ref, { status: "vigente", titulo: "Cardápio anterior" });
    }
  });
}

async function listarVigentes() {
  const q = query(
    collection(db, "clientes", "cliente-teste", "cardapios"),
    where("status", "==", "vigente")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

test("sucesso: encerra o anterior e publica o novo", async () => {
  await prepararCliente();
  const idNovo = await publicarCardapioAtomico({
    db,
    clienteId: "cliente-teste",
    dadosCardapio: { titulo: "Cardápio novo" },
    sdk,
  });

  const vigentes = await listarVigentes();
  assert.equal(vigentes.length, 1);
  assert.equal(vigentes[0].id, idNovo);
  assert.equal(vigentes[0].titulo, "Cardápio novo");

  const antigo = await getDoc(doc(db, "clientes", "cliente-teste", "cardapios", "cardapio-antigo"));
  assert.equal(antigo.data().status, "encerrado");
  const cliente = await getDoc(doc(db, "clientes", "cliente-teste"));
  assert.equal(cliente.data().cardapioVigenteId, idNovo);
});

test("falha de gravação: preserva o cardápio anterior", async () => {
  await prepararCliente();
  await assert.rejects(
    publicarCardapioAtomico({
      db,
      clienteId: "cliente-teste",
      dadosCardapio: { titulo: "Não deve publicar", simularFalha: true },
      sdk,
    })
  );

  const vigentes = await listarVigentes();
  assert.equal(vigentes.length, 1);
  assert.equal(vigentes[0].id, "cardapio-antigo");
  const antigo = await getDoc(doc(db, "clientes", "cliente-teste", "cardapios", "cardapio-antigo"));
  assert.equal(antigo.data().status, "vigente");
  const cliente = await getDoc(doc(db, "clientes", "cliente-teste"));
  assert.equal(cliente.data().cardapioVigenteId, "cardapio-antigo");
});

test("concorrência: duas publicações deixam apenas um vigente", async () => {
  await prepararCliente();

  const [idA, idB] = await Promise.all([
    publicarCardapioAtomico({
      db,
      clienteId: "cliente-teste",
      dadosCardapio: { titulo: "Publicação A" },
      sdk,
    }),
    publicarCardapioAtomico({
      db,
      clienteId: "cliente-teste",
      dadosCardapio: { titulo: "Publicação B" },
      sdk,
    }),
  ]);

  assert.notEqual(idA, idB);
  const vigentes = await listarVigentes();
  assert.equal(vigentes.length, 1);
  const cliente = await getDoc(doc(db, "clientes", "cliente-teste"));
  assert.equal(cliente.data().cardapioVigenteId, vigentes[0].id);
  assert.ok([idA, idB].includes(vigentes[0].id));
});

test("primeira publicação: funciona sem cardápio anterior", async () => {
  await prepararCliente({ comCardapioVigente: false });
  const idNovo = await publicarCardapioAtomico({
    db,
    clienteId: "cliente-teste",
    dadosCardapio: { titulo: "Primeiro cardápio" },
    sdk,
  });
  const vigentes = await listarVigentes();
  assert.equal(vigentes.length, 1);
  assert.equal(vigentes[0].id, idNovo);
});
