// shared/db.js
//
// Todas as leituras e escritas no Firestore passam por aqui. Se um dia a
// estrutura de dados mudar, você corrige num lugar só, não em cada página.

import { db } from "./firebase-config.js";
import { criarAcessoCliente, gerarCodigoAcesso } from "./auth.js";
import {
  collection, doc, addDoc, setDoc, getDoc, getDocs, updateDoc, deleteDoc,
  query, where, orderBy, limit, serverTimestamp, writeBatch,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// ============================================================
// CLIENTES
// ============================================================

// Cria o cliente E o acesso dele (código + senha) em uma única chamada.
// Use no botão "+ Novo cliente" do Dashboard.
// Retorna { clienteId, codigo, senha } — a senha só existe neste retorno,
// nunca é salva no Firestore. Mostre na tela para a nutricionista copiar.
export async function cadastrarNovoCliente({ nome, dataNascimento, contato, objetivo }) {
  let codigo;
  for (let tentativa = 0; tentativa < 10; tentativa++) {
    const candidato = gerarCodigoAcesso();
    const existente = await getDocs(query(
      collection(db, "clientes"),
      where("codigo", "==", candidato),
      limit(1)
    ));
    if (existente.empty) {
      codigo = candidato;
      break;
    }
  }
  if (!codigo) throw new Error("Não foi possível gerar um código único. Tente novamente.");

  // Cria o documento e remove-o se a criação/vinculação do acesso falhar.
  const ref = doc(collection(db, "clientes"));
  await setDoc(ref, {
    nome,
    dataNascimento,
    contato,
    objetivo,
    codigo,
    authUid: null,
    acompanhaDiario: false,
    primeiroAcessoConcluido: false,
    ativo: true,
    criadoEm: serverTimestamp(),
  });

  try {
    const { uid, senha } = await criarAcessoCliente(codigo);
    await updateDoc(ref, { authUid: uid });
    return { clienteId: ref.id, codigo, senha };
  } catch (erro) {
    try { await deleteDoc(ref); } catch (erroLimpeza) {
      console.error("Não foi possível limpar o cadastro incompleto:", erroLimpeza);
    }
    throw erro;
  }
}

// Lista clientes ativos, ordenados por nome — para o Dashboard.
export async function listarClientesAtivos() {
  const q = query(
    collection(db, "clientes"),
    where("ativo", "==", true),
    orderBy("nome")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Busca um cliente específico — para abrir a página dele.
export async function obterCliente(clienteId) {
  const snap = await getDoc(doc(db, "clientes", clienteId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// Atualiza campos do cadastro (nome, contato, etc.)
export async function atualizarCliente(clienteId, campos) {
  await updateDoc(doc(db, "clientes", clienteId), campos);
}

// ============================================================
// ANAMNESE INICIAL (preenchida pelo próprio cliente)
// ============================================================

// Cliente salva/atualiza a própria anamnese, no primeiro acesso.
export async function salvarAnamneseInicial(clienteId, dados) {
  const ref = doc(db, "clientes", clienteId, "anamneseInicial", "inicial");
  await setDoc(ref, { ...dados, status: "enviada" }, { merge: true });
}

// Nutricionista busca a anamnese para revisar antes/durante a consulta.
export async function obterAnamneseInicial(clienteId) {
  const ref = doc(db, "clientes", clienteId, "anamneseInicial", "inicial");
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

// Nutricionista marca como revisada — depois disso o cliente não edita mais.
export async function marcarAnamneseRevisada(clienteId) {
  const ref = doc(db, "clientes", clienteId, "anamneseInicial", "inicial");
  await updateDoc(ref, { status: "revisada", revisadaEm: serverTimestamp() });
}

// ============================================================
// SESSÕES (consultas — só a nutricionista usa)
// ============================================================

// Cria uma nova sessão (consulta). `diagnosticos` pode vir como [] (opcional).
export async function criarSessao(clienteId, dadosSessao) {
  const ref = await addDoc(
    collection(db, "clientes", clienteId, "sessoes"),
    {
      ...dadosSessao,
      registro: { dataRealDoLancamento: serverTimestamp(), editadoEm: null },
    }
  );
  return ref.id;
}

// Lista sessões em ordem cronológica reversa — para o Histórico.
export async function listarSessoes(clienteId) {
  const q = query(
    collection(db, "clientes", clienteId, "sessoes"),
    orderBy("data", "desc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ============================================================
// CARDÁPIOS
// ============================================================

// Cria um cardápio novo e encerra o(s) anterior(es) que ainda estiverem
// "vigente". Use sempre esta função (nunca criar cardápio direto),
// para nunca ficar com dois vigentes ao mesmo tempo.
export async function criarCardapio(clienteId, dadosCardapio) {
  // Publica o novo cardápio e encerra os anteriores na mesma operação.
  // Se o lote falhar, o Firestore não aplica nenhuma das alterações.
  const qVigente = query(
    collection(db, "clientes", clienteId, "cardapios"),
    where("status", "==", "vigente")
  );
  const snapVigentes = await getDocs(qVigente);
  const ref = doc(collection(db, "clientes", clienteId, "cardapios"));
  const lote = writeBatch(db);

  snapVigentes.docs.forEach((d) => lote.update(d.ref, { status: "encerrado" }));
  lote.set(ref, { ...dadosCardapio, status: "vigente" });
  await lote.commit();

  return ref.id;
}

// Busca o cardápio vigente do cliente — usado na Home do dia dele
// e no resumo da nutricionista.
export async function obterCardapioVigente(clienteId) {
  const q = query(
    collection(db, "clientes", clienteId, "cardapios"),
    where("status", "==", "vigente"),
    limit(1)
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}

// Lista todos os cardápios (para o histórico, mais antigos por último).
export async function listarCardapios(clienteId) {
  const q = query(
    collection(db, "clientes", clienteId, "cardapios"),
    orderBy("dataInicio", "desc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ============================================================
// MODELOS DE CARDÁPIO (biblioteca reaproveitável da nutricionista)
// ============================================================

export async function salvarModeloCardapio(dadosModelo) {
  const ref = await addDoc(collection(db, "config", "modelosCardapio", "itens"), {
    ...dadosModelo,
    criadoEm: serverTimestamp(),
  });
  return ref.id;
}

export async function listarModelosCardapio() {
  const snap = await getDocs(collection(db, "config", "modelosCardapio", "itens"));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ============================================================
// CHECK-INS DIÁRIOS (cliente)
// ============================================================

// Salva/atualiza o check-in do dia. `data` no formato "2026-09-30".
// `dadosParciais` pode conter só o que mudou (ex: só uma refeição marcada),
// graças ao merge:true — não precisa reenviar o dia inteiro a cada toque.
export async function salvarCheckin(clienteId, data, dadosParciais) {
  const ref = doc(db, "clientes", clienteId, "checkins", data);
  await setDoc(
    ref,
    { ...dadosParciais, data, atualizadoEm: serverTimestamp() },
    { merge: true }
  );
}

export async function obterCheckin(clienteId, data) {
  const ref = doc(db, "clientes", clienteId, "checkins", data);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

// Busca os últimos N check-ins — para o Resumo/Dashboard.
export async function listarUltimosCheckins(clienteId, quantidade = 7) {
  // Ordena pelo ID (AAAA-MM-DD), incluindo registros antigos sem campo "data".
  const snap = await getDocs(collection(db, "clientes", clienteId, "checkins"));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => b.id.localeCompare(a.id))
    .slice(0, quantidade);
}

// ============================================================
// CONSENTIMENTO LGPD
// ============================================================

export async function aceitarConsentimento(clienteId, textoVersao) {
  const ref = doc(db, "clientes", clienteId, "consentimentos", "v1");
  await setDoc(ref, {
    texto: textoVersao,
    aceitoEm: serverTimestamp(),
    revogadoEm: null,
  });
}

export async function revogarConsentimento(clienteId) {
  const ref = doc(db, "clientes", clienteId, "consentimentos", "v1");
  await updateDoc(ref, { revogadoEm: serverTimestamp() });
}

export async function obterConsentimento(clienteId) {
  const ref = doc(db, "clientes", clienteId, "consentimentos", "v1");
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}
