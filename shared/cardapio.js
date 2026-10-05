// shared/cardapio.js
//
// Lógica de negócio sobre cardápio e adesão: cálculo de % de adesão a
// partir dos check-ins, dias sem check-in, dias para o cardápio vencer,
// e o conjunto de alertas usado no Dashboard e na página do cliente.
// Centralizado aqui para não duplicar essa conta em várias telas.

import { obterCardapioVigente, listarUltimosCheckins } from "./db.js";

// Limites dos alertas (fixos por enquanto; podem virar configuráveis
// em /config/nutricionista numa versão futura).
const DIAS_SEM_CHECKIN_ALERTA = 2;
const ADESAO_MINIMA = 50; // %
const DIAS_AVISO_VENCIMENTO = 3;

// Calcula % de adesão a partir de uma lista de check-ins
// (cada um com `refeicoes: [{ feita: bool }, ...]`).
export function calcularAdesao(checkins) {
  let total = 0;
  let feitas = 0;
  checkins.forEach((c) => {
    (c.refeicoes || []).forEach((r) => {
      total++;
      if (r.feita) feitas++;
    });
  });
  if (total === 0) return null; // sem dados suficientes ainda
  return Math.round((feitas / total) * 100);
}

// Dias desde o último check-in (null se nunca houve nenhum).
// Assume que `checkins` já vem ordenado do mais recente para o mais antigo
// (é o que listarUltimosCheckins faz) e que o id do doc é "AAAA-MM-DD".
export function diasSemCheckin(checkins) {
  if (checkins.length === 0) return null;
  const dataCheckin = new Date(checkins[0].id + "T00:00:00");
  const hoje = new Date();
  const diffMs = hoje.setHours(0,0,0,0) - dataCheckin.setHours(0,0,0,0);
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

// Dias até o cardápio vigente vencer (null se não há cardápio vigente).
export function diasParaVencer(cardapio) {
  if (!cardapio || !cardapio.dataFim) return null;
  const fim = cardapio.dataFim.toDate ? cardapio.dataFim.toDate() : new Date(cardapio.dataFim);
  const hoje = new Date();
  const diffMs = fim.setHours(0,0,0,0) - hoje.setHours(0,0,0,0);
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

// Monta a lista de alertas de um cliente. Usado no Dashboard (lista) e
// no Resumo da página do cliente (detalhe).
export async function obterAlertasCliente(clienteId) {
  const alertas = [];

  const checkins = await listarUltimosCheckins(clienteId, 7);
  const dias = diasSemCheckin(checkins);
  if (dias !== null && dias >= DIAS_SEM_CHECKIN_ALERTA) {
    alertas.push({ tipo: "sem_checkin", texto: `Sem check-in há ${dias}d` });
  }

  const adesao = calcularAdesao(checkins);
  if (adesao !== null && adesao < ADESAO_MINIMA) {
    alertas.push({ tipo: "baixa_adesao", texto: `Adesão baixa (${adesao}%)` });
  }

  const cardapio = await obterCardapioVigente(clienteId);
  const diasVencer = diasParaVencer(cardapio);
  if (diasVencer === null) {
    alertas.push({ tipo: "sem_cardapio", texto: "Sem cardápio vigente" });
  } else if (diasVencer <= 0) {
    alertas.push({ tipo: "cardapio_vencido", texto: "Cardápio vencido" });
  } else if (diasVencer <= DIAS_AVISO_VENCIMENTO) {
    alertas.push({ tipo: "cardapio_vencendo", texto: `Vence em ${diasVencer}d` });
  }

  return alertas;
}
