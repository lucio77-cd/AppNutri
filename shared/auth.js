// shared/auth.js
//
// Funções de autenticação usadas tanto pela nutricionista quanto pelos
// clientes. Como o Firebase Auth trabalha com e-mail+senha, usamos um
// "e-mail interno" fabricado a partir do código de acesso do cliente
// (ele nunca precisa saber que aquilo é um e-mail).

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { auth } from "./firebase-config.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

// Mesma configuração do firebase-config.js, usada aqui para abrir um
// segundo "app" do Firebase, isolado do principal — só para criar contas
// de cliente sem deslogar a nutricionista.
const firebaseConfig = {
  apiKey: "AIzaSyDUSSCIyY_mgtxNh2aZIsoQ0bLCpw_BBo0",
  authDomain: "app-nutri-edd78.firebaseapp.com",
  projectId: "app-nutri-edd78",
  storageBucket: "app-nutri-edd78.firebasestorage.app",
  messagingSenderId: "1019966010776",
  appId: "1:1019966010776:web:f3502ca4e4cef60ff127ed",
};

function codigoParaEmail(codigo) {
  return `${codigo.toLowerCase()}@clientes.appnutri.local`;
}

export async function loginNutricionista(email, senha) {
  const cred = await signInWithEmailAndPassword(auth, email, senha);
  return cred.user;
}

export async function loginCliente(codigo, senha) {
  const email = codigoParaEmail(codigo);
  const cred = await signInWithEmailAndPassword(auth, email, senha);
  return cred.user;
}

export async function criarAcessoCliente(codigo) {
  const email = codigoParaEmail(codigo);
  const senha = gerarSenhaAleatoria();

  const appSecundario = initializeApp(firebaseConfig, `secundario-${Date.now()}`);
  const authSecundario = getAuth(appSecundario);

  const cred = await createUserWithEmailAndPassword(authSecundario, email, senha);
  const uid = cred.user.uid;

  await signOut(authSecundario);

  return { uid, senha };
}

function escolherCaracterSeguro(chars) {
  const limite = Math.floor(0x100000000 / chars.length) * chars.length;
  const valor = new Uint32Array(1);
  do {
    crypto.getRandomValues(valor);
  } while (valor[0] >= limite);
  return chars[valor[0] % chars.length];
}

function gerarSenhaAleatoria() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 12 }, () => escolherCaracterSeguro(chars)).join("");
}

export function gerarCodigoAcesso() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 8 }, () => escolherCaracterSeguro(chars)).join("");
}

export function logout() {
  return signOut(auth);
}

export function observarLogin(callback) {
  return onAuthStateChanged(auth, callback);
}
