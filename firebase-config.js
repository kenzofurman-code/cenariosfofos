// Cole aqui a configuração do SEU projeto Firebase.
// Onde achar: Firebase Console > (seu projeto) > ⚙️ Configurações do projeto
// > Seus aplicativos > app da Web > "SDK setup and configuration" > Config.
//
// Isso é seguro de deixar público no código (não é uma senha secreta) —
// a segurança de verdade vem das REGRAS do Firestore e do Storage,
// configuradas no console do Firebase. Veja o README.md para os passos completos.
//
// Enquanto apiKey estiver como "COLE_AQUI", o app roda 100% no modo local
// (cache do navegador via IndexedDB), sem tentar falar com a nuvem.

export const firebaseConfig = {
  apiKey: "COLE_AQUI",
  authDomain: "SEU_PROJETO.firebaseapp.com",
  projectId: "SEU_PROJETO",
  storageBucket: "SEU_PROJETO.appspot.com",
  messagingSenderId: "COLE_AQUI",
  appId: "COLE_AQUI"
};
