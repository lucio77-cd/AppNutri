const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { randomInt, randomBytes } = require("node:crypto");

initializeApp();

const db = getFirestore();
const auth = getAuth();
const REGION = "southamerica-east1";

// Must match UID_NUTRICIONISTA in shared/firebase-config.js and firestore.rules.
const UID_NUTRICIONISTA = "Tzcb9pugJvN57n5YI1TUQ5zRu4h1";

function gerarSenhaTemporaria() {
  const letras = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const numeros = "23456789";
  const simbolos = "!@#$%*-_";
  const todos = letras + numeros + simbolos;
  let senha = [
    letras[randomInt(letras.length)],
    numeros[randomInt(numeros.length)],
    simbolos[randomInt(simbolos.length)],
  ];
  for (let i = senha.length; i < 14; i++) {
    senha.push(todos[randomInt(todos.length)]);
  }
  // Fisher-Yates com fonte criptográfica.
  for (let i = senha.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [senha[i], senha[j]] = [senha[j], senha[i]];
  }
  return senha.join("");
}

function codigoParaEmail(codigo) {
  return `${String(codigo).toLowerCase()}@clientes.appnutri.local`;
}

exports.redefinirAcessoCliente = onCall(
  { region: REGION, enforceAppCheck: false },
  async (request) => {
    if (!request.auth || request.auth.uid !== UID_NUTRICIONISTA) {
      throw new HttpsError("permission-denied", "Somente a nutricionista pode redefinir o acesso.");
    }

    const clienteId = String(request.data?.clienteId || "").trim();
    if (!clienteId || clienteId.length > 150) {
      throw new HttpsError("invalid-argument", "Cliente inválido.");
    }

    const clienteRef = db.collection("clientes").doc(clienteId);
    const snapshot = await clienteRef.get();
    if (!snapshot.exists) {
      throw new HttpsError("not-found", "Cadastro do cliente não encontrado.");
    }

    const cliente = snapshot.data();
    if (!cliente.codigo) {
      throw new HttpsError("failed-precondition", "O cadastro não possui código de acesso.");
    }

    const email = codigoParaEmail(cliente.codigo);
    const senha = gerarSenhaTemporaria();
    let usuario;

    try {
      if (cliente.authUid) {
        try {
          usuario = await auth.getUser(cliente.authUid);
        } catch (error) {
          if (error.code !== "auth/user-not-found") throw error;
        }
      }

      if (!usuario) {
        try {
          usuario = await auth.getUserByEmail(email);
        } catch (error) {
          if (error.code !== "auth/user-not-found") throw error;
        }
      }

      if (usuario) {
        await auth.updateUser(usuario.uid, { password: senha, disabled: false });
      } else {
        usuario = await auth.createUser({
          email,
          password: senha,
          emailVerified: true,
          disabled: false,
        });
      }

      await clienteRef.update({
        authUid: usuario.uid,
        acessoAtualizadoEm: FieldValue.serverTimestamp(),
      });

      await db.collection("clientes").doc(clienteId).collection("auditLog").add({
        acao: "redefinicao_acesso",
        realizadoPor: request.auth.uid,
        criadoEm: FieldValue.serverTimestamp(),
      });

      return {
        sucesso: true,
        codigo: cliente.codigo,
        senha,
        contaCriada: !cliente.authUid || cliente.authUid !== usuario.uid,
      };
    } catch (error) {
      console.error("Falha ao redefinir acesso do cliente", {
        clienteId,
        code: error.code || "unknown",
      });
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", "Não foi possível criar ou redefinir o acesso. Tente novamente.");
    }
  }
);
