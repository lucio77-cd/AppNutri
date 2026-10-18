import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection, doc, getDoc, getDocs, query, runTransaction,
  setDoc, updateDoc, where,
} from "firebase/firestore";
import { publicarCardapioAtomico } from "../shared/cardapio-publicacao-core.js";

const projectId = "demo-app-nutri";
const NUTRI_UID = "Tzcb9pugJvN57n5YI1TUQ5zRu4h1";
const CLIENTE_UID = "cliente-uid";
const CLIENTE_ID = "cliente-teste";

let env;
let dbNutri;
let dbCliente;

const sdk = { collection, doc, getDocs, query, where, runTransaction };

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: {
      // Importante: os testes usam as regras reais do projeto, não regras permissivas.
      rules: await readFile("firestore.rules", "utf8"),
    },
  });
});

beforeEach(async () => {
  await env.clearFirestore();
  dbNutri = env.authenticatedContext(NUTRI_UID).firestore();
  dbCliente = env.authenticatedContext(CLIENTE_UID).firestore();
});

after(async () => {
  await env.cleanup();
});

async function prepararCliente({ comCardapioVigente = true } = {}) {
  await env.withSecurityRulesDisabled(async (context) => {
    const adminDb = context.firestore();
    await setDoc(doc(adminDb, "clientes", CLIENTE_ID), {
      nome: "Cliente de teste",
      authUid: CLIENTE_UID,
      ativo: true,
      acompanhaDiario: true,
      ...(comCardapioVigente ? { cardapioVigenteId: "cardapio-antigo" } : {}),
    });

    if (comCardapioVigente) {
      await setDoc(
        doc(adminDb, "clientes", CLIENTE_ID, "cardapios", "cardapio-antigo"),
        { status: "vigente", titulo: "Cardápio anterior", refeicoes: [] }
      );
    }
  });
}

async function listarVigentes() {
  const q = query(
    collection(dbNutri, "clientes", CLIENTE_ID, "cardapios"),
    where("status", "==", "vigente")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

test("publicação: encerra o anterior e publica o novo", async () => {
  await prepararCliente();

  const idNovo = await publicarCardapioAtomico({
    db: dbNutri,
    clienteId: CLIENTE_ID,
    dadosCardapio: { titulo: "Cardápio novo", refeicoes: [], snapshotNutricional: {} },
    sdk,
  });

  const vigentes = await listarVigentes();
  assert.equal(vigentes.length, 1);
  assert.equal(vigentes[0].id, idNovo);
  assert.equal(vigentes[0].titulo, "Cardápio novo");

  const antigo = await getDoc(doc(dbNutri, "clientes", CLIENTE_ID, "cardapios", "cardapio-antigo"));
  assert.equal(antigo.data().status, "encerrado");

  const cliente = await getDoc(doc(dbNutri, "clientes", CLIENTE_ID));
  assert.equal(cliente.data().cardapioVigenteId, idNovo);
});

test("falha de permissão: preserva o cardápio vigente e não publica parcialmente", async () => {
  await prepararCliente();

  await assert.rejects(
    publicarCardapioAtomico({
      db: dbCliente,
      clienteId: CLIENTE_ID,
      dadosCardapio: { titulo: "Publicação não autorizada", refeicoes: [] },
      sdk,
    })
  );

  const vigentes = await listarVigentes();
  assert.equal(vigentes.length, 1);
  assert.equal(vigentes[0].id, "cardapio-antigo");

  const antigo = await getDoc(doc(dbNutri, "clientes", CLIENTE_ID, "cardapios", "cardapio-antigo"));
  assert.equal(antigo.data().status, "vigente");

  const cliente = await getDoc(doc(dbNutri, "clientes", CLIENTE_ID));
  assert.equal(cliente.data().cardapioVigenteId, "cardapio-antigo");
});

test("concorrência: duas publicações deixam apenas um cardápio vigente", async () => {
  await prepararCliente();

  const [idA, idB] = await Promise.all([
    publicarCardapioAtomico({
      db: dbNutri,
      clienteId: CLIENTE_ID,
      dadosCardapio: { titulo: "Publicação A", refeicoes: [] },
      sdk,
    }),
    publicarCardapioAtomico({
      db: dbNutri,
      clienteId: CLIENTE_ID,
      dadosCardapio: { titulo: "Publicação B", refeicoes: [] },
      sdk,
    }),
  ]);

  assert.notEqual(idA, idB);
  const vigentes = await listarVigentes();
  assert.equal(vigentes.length, 1);

  const cliente = await getDoc(doc(dbNutri, "clientes", CLIENTE_ID));
  assert.equal(cliente.data().cardapioVigenteId, vigentes[0].id);
  assert.ok([idA, idB].includes(vigentes[0].id));
});

test("primeira publicação: funciona sem cardápio anterior", async () => {
  await prepararCliente({ comCardapioVigente: false });

  const idNovo = await publicarCardapioAtomico({
    db: dbNutri,
    clienteId: CLIENTE_ID,
    dadosCardapio: { titulo: "Primeiro cardápio", refeicoes: [] },
    sdk,
  });

  const vigentes = await listarVigentes();
  assert.equal(vigentes.length, 1);
  assert.equal(vigentes[0].id, idNovo);
});

test("cliente lê cardápios publicados próprios, mas não rascunhos nem dados de outro cliente", async () => {
  await prepararCliente();

  await env.withSecurityRulesDisabled(async (context) => {
    const adminDb = context.firestore();
    await setDoc(
      doc(adminDb, "clientes", CLIENTE_ID, "cardapios", "rascunho"),
      { status: "rascunho", titulo: "Privado" }
    );
    await setDoc(doc(adminDb, "clientes", "outro-cliente"), {
      nome: "Outro cliente",
      authUid: "outro-uid",
      ativo: true,
    });
    await setDoc(
      doc(adminDb, "clientes", "outro-cliente", "cardapios", "menu-outro"),
      { status: "vigente", titulo: "Não pertence a este cliente" }
    );
  });

  await assertSucceeds(
    getDoc(doc(dbCliente, "clientes", CLIENTE_ID, "cardapios", "cardapio-antigo"))
  );
  await assertFails(
    getDoc(doc(dbCliente, "clientes", CLIENTE_ID, "cardapios", "rascunho"))
  );
  await assertFails(
    getDoc(doc(dbCliente, "clientes", "outro-cliente", "cardapios", "menu-outro"))
  );
});

test("versões publicadas são imutáveis, exceto para encerrar a vigência", async () => {
  await prepararCliente();

  const menuRef = doc(dbNutri, "clientes", CLIENTE_ID, "cardapios", "cardapio-antigo");
  await assertFails(updateDoc(menuRef, { titulo: "Conteúdo alterado depois de publicado" }));
  await assertSucceeds(updateDoc(menuRef, { status: "encerrado" }));
  await assertFails(updateDoc(menuRef, { titulo: "Tentativa de alterar histórico" }));
  await assertFails(
    import("firebase/firestore").then(({ deleteDoc }) => deleteDoc(menuRef))
  );
});

test("alimentos e receitas são acessíveis somente à nutricionista", async () => {
  await assertSucceeds(
    setDoc(doc(dbNutri, "alimentos", "alimento-teste"), { nome: "Alimento de teste" })
  );
  await assertSucceeds(
    setDoc(doc(dbNutri, "receitas", "receita-teste"), { nome: "Receita de teste" })
  );

  await assertFails(
    getDoc(doc(dbCliente, "alimentos", "alimento-teste"))
  );
  await assertFails(
    getDoc(doc(dbCliente, "receitas", "receita-teste"))
  );
  await assertFails(
    setDoc(doc(dbCliente, "alimentos", "alimento-nao-autorizado"), { nome: "Inválido" })
  );
  await assertFails(
    setDoc(doc(dbCliente, "receitas", "receita-nao-autorizada"), { nome: "Inválida" })
  );
});
