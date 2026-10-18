// Núcleo da publicação, separado para permitir testes com o Firebase Emulator.
export async function publicarCardapioAtomico({
  db,
  clienteId,
  dadosCardapio,
  sdk,
}) {
  const {
    collection, doc, getDocs, query, where, runTransaction,
  } = sdk;

  if (!clienteId || typeof clienteId !== "string") {
    throw new Error("ID do cliente inválido.");
  }
  if (!dadosCardapio || typeof dadosCardapio !== "object" || Array.isArray(dadosCardapio)) {
    throw new Error("Dados do cardápio inválidos.");
  }

  const cardapiosRef = collection(db, "clientes", clienteId, "cardapios");
  const clienteRef = doc(db, "clientes", clienteId);
  const qVigente = query(cardapiosRef, where("status", "==", "vigente"));

  // Compatibilidade: identifica cardápios vigentes antigos ainda sem ponteiro.
  // A decisão final ocorre na transação, que serializa publicações concorrentes
  // por meio do documento do cliente.
  const vigentesLegados = await getDocs(qVigente);
  const novoRef = doc(cardapiosRef);

  await runTransaction(db, async (tx) => {
    const clienteSnap = await tx.get(clienteRef);
    if (!clienteSnap.exists()) {
      throw new Error("Cliente não encontrado.");
    }

    const cliente = clienteSnap.data();
    const antigosParaEncerrar = [];

    const idsLidos = new Set();

    if (cliente.cardapioVigenteId) {
      const atualRef = doc(cardapiosRef, cliente.cardapioVigenteId);
      const atualSnap = await tx.get(atualRef);
      idsLidos.add(atualRef.id);
      if (atualSnap.exists() && atualSnap.data().status === "vigente") {
        antigosParaEncerrar.push(atualRef);
      }
    }

    // Usa a consulta legada apenas quando ainda não existe ponteiro canônico.
    // Em publicações concorrentes, a transação que perde a disputa relê o cliente
    // e encerra o cardápio apontado pelo vencedor, sem tentar atualizar resultados
    // de uma consulta feita antes da transação.
    if (!cliente.cardapioVigenteId) {
      for (const item of vigentesLegados.docs) {
        if (idsLidos.has(item.id)) continue;
        const atualSnap = await tx.get(item.ref);
        if (atualSnap.exists() && atualSnap.data().status === "vigente") {
          antigosParaEncerrar.push(item.ref);
        }
      }
    }

    antigosParaEncerrar.forEach((ref) => {
      tx.update(ref, { status: "encerrado" });
    });

    tx.set(novoRef, {
      ...dadosCardapio,
      status: "vigente",
    });
    tx.update(clienteRef, {
      cardapioVigenteId: novoRef.id,
    });
  });

  return novoRef.id;
}
