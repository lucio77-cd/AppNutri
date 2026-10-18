// shared/db.js
//
// Todas as leituras e escritas no Firestore passam por aqui. Se um dia a
// estrutura de dados mudar, você corrige num lugar só, não em cada página.

import { db } from "./firebase-config.js";
import { criarAcessoCliente, gerarCodigoAcesso } from "./auth.js";
import {
  collection, doc, addDoc, setDoc, getDoc, getDocs, updateDoc,
  query, where, orderBy, limit, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// ============================================================
// CLIENTES
// ============================================================

// Cria o cliente E o acesso dele (código + senha) em uma única chamada.
// Use no botão "+ Novo cliente" do Dashboard.
// Retorna { clienteId, codigo, senha } — a senha só existe neste retorno,
// nunca é salva no Firestore. Mostre na tela para a nutricionista copiar.
export async function cadastrarNovoCliente({ nome, dataNascimento, contato, objetivo }) {
  const codigo = gerarCodigoAcesso();

  // 1. Cria o documento do cliente (ainda sem authUid)
  const ref = await addDoc(collection(db, "clientes"), {
    nome,
    dataNascimento,
    contato,
    objetivo,
    codigo,
    authUid: null,
    acompanhaDiario: false,
    primeiroAcessoConcluido: false,
    ativo: true,
    statusAcompanhamento: "ativo",
    criadoEm: serverTimestamp(),
  });

  // 2. Cria a conta de login (código + senha gerada)
  const { uid, senha } = await criarAcessoCliente(codigo);

  // 3. Vincula o uid criado ao documento do cliente
  await updateDoc(ref, { authUid: uid });

  return { clienteId: ref.id, codigo, senha };
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

// Lista todos os cadastros para a gestão da nutricionista, inclusive suspensos/arquivados.
export async function listarTodosClientes() {
  const q = query(collection(db, "clientes"), orderBy("nome"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Suspende ou retoma o acompanhamento sem apagar o histórico clínico.
export async function alterarStatusCliente(clienteId, status) {
  if (!["ativo", "suspenso"].includes(status)) {
    throw new Error("Status de acompanhamento inválido.");
  }
  await updateDoc(doc(db, "clientes", clienteId), {
    ativo: status === "ativo",
    statusAcompanhamento: status,
    statusAtualizadoEm: serverTimestamp(),
  });
}

// "Excluir" na interface significa arquivar: preserva prontuário e histórico.
export async function arquivarCliente(clienteId) {
  await updateDoc(doc(db, "clientes", clienteId), {
    ativo: false,
    statusAcompanhamento: "excluido",
    arquivadoEm: serverTimestamp(),
  });
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
export async function salvarAnamneseInicial(clienteId, dados, status = "enviada") {
  if (!["rascunho", "enviada"].includes(status)) {
    throw new Error("Status de anamnese inválido.");
  }
  const ref = doc(db, "clientes", clienteId, "anamneseInicial", "inicial");
  await setDoc(ref, { ...dados, status }, { merge: true });
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
  // 1. Encerra qualquer cardápio ainda vigente
  const qVigente = query(
    collection(db, "clientes", clienteId, "cardapios"),
    where("status", "==", "vigente")
  );
  const snapVigentes = await getDocs(qVigente);
  await Promise.all(
    snapVigentes.docs.map((d) => updateDoc(d.ref, { status: "encerrado" }))
  );

  // 2. Cria o novo, já como vigente
  const ref = await addDoc(collection(db, "clientes", clienteId, "cardapios"), {
    ...dadosCardapio,
    status: "vigente",
  });
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
    { data, ...dadosParciais, atualizadoEm: serverTimestamp() },
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
  const q = query(
    collection(db, "clientes", clienteId, "checkins"),
    orderBy("data", "desc"),
    limit(quantidade)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ============================================================
// OBSERVAÇÕES PROFISSIONAIS — acesso exclusivo da nutricionista
// ============================================================

export async function criarObservacaoNutri(clienteId, dados) {
  const texto = String(dados.texto || "").trim();
  if (!texto) throw new Error("A anotação não pode ficar vazia.");
  if (!["observacao", "pergunta", "acompanhar"].includes(dados.tipo)) {
    throw new Error("Tipo de observação inválido.");
  }
  const ref = await addDoc(collection(db, "clientes", clienteId, "observacoesNutri"), {
    tipo: dados.tipo,
    assunto: String(dados.assunto || "").trim(),
    texto,
    status: "aberta",
    criadoEm: serverTimestamp(),
    atualizadoEm: serverTimestamp(),
  });
  return ref.id;
}

export async function listarObservacoesNutri(clienteId) {
  const q = query(
    collection(db, "clientes", clienteId, "observacoesNutri"),
    orderBy("criadoEm", "desc"),
    limit(100)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function atualizarStatusObservacaoNutri(clienteId, observacaoId, status) {
  if (!["aberta", "concluida"].includes(status)) {
    throw new Error("Status da observação inválido.");
  }
  await updateDoc(doc(db, "clientes", clienteId, "observacoesNutri", observacaoId), {
    status,
    atualizadoEm: serverTimestamp(),
  });
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
