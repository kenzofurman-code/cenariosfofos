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
  apiKey: "AIzaSyA-aGgpKYWRPl9rXCn6ELCUSg4HnqrTnQQ",
  authDomain: "cenariosfofos.firebaseapp.com",
  projectId: "cenariosfofos",
  storageBucket: "cenariosfofos.firebasestorage.app",
  messagingSenderId: "172088409435",
  appId: "1:172088409435:web:550bb1bce1ca03901dae7e",
  measurementId: "G-N6PDQBWM8J"
};