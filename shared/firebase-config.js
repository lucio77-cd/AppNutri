// shared/firebase-config.js
//
// Inicializa o Firebase e exporta `db` (Firestore) e `auth` (Authentication)
// para serem usados em qualquer outra página/arquivo do app.
//
// COMO USAR:
// Em qualquer HTML que precise do Firebase, inclua:
//   <script type="module" src="/shared/firebase-config.js"></script>
// E em qualquer outro arquivo .js que precise do db/auth, importe assim:
//   import { db, auth, UID_NUTRICIONISTA } from "/shared/firebase-config.js";
//
// IMPORTANTE: todo arquivo que faz import/export precisa ser carregado como
// <script type="module">, senão o navegador não entende o import.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

// ============================================================
// TODO 1: cole aqui a configuração do SEU projeto Firebase.
// Onde encontrar: Console do Firebase > ⚙️ Configurações do projeto
// > role até "Seus apps" > clique no app web > "Configuração do SDK".
// ============================================================
const firebaseConfig = {
  apiKey: "COLE_AQUI_A_API_KEY",
  authDomain: "COLE_AQUI.firebaseapp.com",
  projectId: "COLE_AQUI_O_PROJECT_ID",
  storageBucket: "COLE_AQUI.appspot.com",
  messagingSenderId: "COLE_AQUI",
  appId: "COLE_AQUI",
};

// ============================================================
// TODO 2: cole aqui o UID da sua irmã no Firebase Authentication.
// Vem no próximo arquivo (auth.js) — ainda não preencha.
//
// ATENÇÃO: esse mesmo UID também precisa estar escrito, IGUALZINHO,
// dentro do firestore.rules (na função isNutri()). Se um dia você
// recriar a conta dela e o UID mudar, precisa atualizar nos DOIS lugares.
// ============================================================
export const UID_NUTRICIONISTA = "COLE_AQUI_O_UID_DA_IRMA";

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);
