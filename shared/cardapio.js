// shared/cardapio.js
//
// Lógica de negócio sobre cardápio e adesão: cálculo de % de adesão a
// partir dos check-ins, dias sem check-in, dias para o cardápio vencer,
// próxima consulta, e o conjunto de alertas usado no Dashboard e na
// página do cliente. Centralizado aqui para não duplicar essa conta.

import { obterCardapioVigente, listarUltimosCheckins, obterCliente } from "./db.js";

// Limites dos alertas (fixos por enquanto).
const DIAS_SEM_CHECKIN_ALERTA = 2;
const ADESAO_MINIMA = 50; // %
const DIAS_AVISO_VENCIMENTO = 3;
const DIAS_AVISO_CONSULTA = 2;

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
// Assume que `checkins` vem ordenado do mais recente para o mais antigo
// e que o id do doc é "AAAA-MM-DD".
export function diasSemCheckin(checkins) {
  if (checkins.length === 0) return null;
  const dataCheckin = new Date(checkins[0].id + "T00:00:00");
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return Math.floor((hoje - dataCheckin) / (1000 * 60 * 60 * 24));
}

// Dias até o cardápio vigente vencer (null se não há cardápio vigente).
export function diasParaVencer(cardapio) {
  if (!cardapio || !cardapio.dataFim) return null;
  const fim = cardapio.dataFim.toDate ? cardapio.dataFim.toDate() : new Date(cardapio.dataFim);
  fim.setHours(0, 0, 0, 0);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return Math.round((fim - hoje) / (1000 * 60 * 60 * 24));
}

// Dias até a próxima consulta (null se não houver data marcada).
// `cliente.proximaConsulta` é uma string "AAAA-MM-DD".
export function diasParaConsulta(cliente) {
  if (!cliente || !cliente.proximaConsulta) return null;
  const alvo = new Date(cliente.proximaConsulta + "T00:00:00");
  if (Number.isNaN(alvo.getTime())) return null;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return Math.round((alvo - hoje) / (1000 * 60 * 60 * 24));
}

// Alerta da próxima consulta (ou null se não precisa avisar).
export function alertaProximaConsulta(cliente) {
  const dias = diasParaConsulta(cliente);
  if (dias === null) return null;
  if (dias < 0) return { tipo: "consulta_atrasada", texto: `Consulta atrasada (${Math.abs(dias)}d)` };
  if (dias === 0) return { tipo: "consulta_hoje", texto: "Consulta hoje" };
  if (dias <= DIAS_AVISO_CONSULTA) return { tipo: "consulta_proxima", texto: `Consulta em ${dias}d` };
  return null;
}

// Monta a lista de alertas de um cliente. Usado no Dashboard (lista) e
// na página do cliente (detalhe). `clienteCarregado` é opcional: se você
// já tem o documento do cliente em mãos, passe aqui para evitar uma leitura extra.
export async function obterAlertasCliente(clienteId, clienteCarregado = null) {
  const cliente = clienteCarregado || (await obterCliente(clienteId));
  const alertas = [];

  // Alertas de check-in só fazem sentido para quem tem o acompanhamento diário ligado
  if (cliente && cliente.acompanhaDiario === true) {
    const checkins = await listarUltimosCheckins(clienteId, 7);

    const dias = diasSemCheckin(checkins);
    if (dias !== null && dias >= DIAS_SEM_CHECKIN_ALERTA) {
      alertas.push({ tipo: "sem_checkin", texto: `Sem check-in há ${dias}d` });
    }

    const adesao = calcularAdesao(checkins);
    if (adesao !== null && adesao < ADESAO_MINIMA) {
      alertas.push({ tipo: "baixa_adesao", texto: `Adesão baixa (${adesao}%)` });
    }
  }

  const cardapio = await obterCardapioVigente(clienteId);
  const diasVencer = diasParaVencer(cardapio);
  if (diasVencer === null) {
    alertas.push({ tipo: "sem_cardapio", texto: "Sem cardápio vigente" });
  } else if (diasVencer < 0) {
    alertas.push({ tipo: "cardapio_vencido", texto: "Cardápio vencido" });
  } else if (diasVencer === 0) {
    alertas.push({ tipo: "cardapio_vencendo", texto: "Cardápio vence hoje" });
  } else if (diasVencer <= DIAS_AVISO_VENCIMENTO) {
    alertas.push({ tipo: "cardapio_vencendo", texto: `Vence em ${diasVencer}d` });
  }

  const consulta = alertaProximaConsulta(cliente);
  if (consulta) alertas.push(consulta);

  return alertas;
}
