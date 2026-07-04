# Monte seu Cenário 🧸

App de montar cenários (arrastar e soltar bichinhos/móveis/objetos num cenário vazio),
com cache local automático (IndexedDB) e sincronização opcional na nuvem via Firebase.

## Rodando localmente (antes de configurar qualquer coisa)

Como o app usa módulos ES (`import`/`export`), o navegador precisa carregá-lo via `http://`,
não abrindo o arquivo direto (`file://`). Qualquer servidor estático simples resolve:

```bash
# opção 1: Python (já vem em quase todo sistema)
python3 -m http.server 8080

# opção 2: Node
npx serve .

# opção 3: Vercel (recomendado, já testa igual à produção)
npx vercel dev
```

Depois abra `http://localhost:8080` (ou a porta que aparecer).

Sem nenhuma configuração de Firebase, o app já funciona **100% localmente**: os cenários
importados e o que você monta ficam salvos no cache do navegador (IndexedDB) e sobrevivem
a recarregar a página ou fechar a aba. Isso já resolve "gravar pelo menos no cache".

## Ativando a nuvem (Firebase) — opcional

Isso permite que os cenários fiquem salvos de verdade (sobrevivem a limpar o navegador,
trocar de aparelho, etc.) usando Firestore (metadados) + Storage (as imagens).

### 1. Crie um projeto no Firebase

1. Acesse https://console.firebase.google.com e crie um projeto novo (gratuito).
2. Em **Build > Firestore Database**, clique em "Criar banco de dados", modo produção,
   escolha a região mais próxima (ex: `southamerica-east1`).
3. Em **Build > Storage**, clique em "Começar" e siga o assistente.
4. Em **Build > Authentication > Sign-in method**, habilite o provedor **Anônimo**
   (é assim que o app identifica "você" sem precisar criar login/senha).

### 2. Pegue as chaves do seu app

1. No console, clique na engrenagem ⚙️ > **Configurações do projeto**.
2. Em "Seus aplicativos", clique em **Adicionar app > Web** (ícone `</>`).
3. Copie o objeto `firebaseConfig` que aparece.

### 3. Cole no projeto

Abra `firebase-config.js` e substitua os valores de exemplo pelos seus:

```js
export const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "seu-projeto.firebaseapp.com",
  projectId: "seu-projeto",
  storageBucket: "seu-projeto.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};
```

> Essas chaves **não são secretas** — é seguro que fiquem no código, mesmo público.
> Quem protege seus dados de verdade são as **regras de segurança** do Firestore/Storage
> (passo 4), não esconder essa configuração.

### 4. Regras de segurança

No Firebase Console, vá em **Firestore Database > Regras** e cole:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

Em **Storage > Regras**, cole:

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /scenarios/{allPaths=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

Isso garante que cada pessoa só lê/escreve os próprios cenários.

### 5. Teste local

Rode `npx vercel dev` (ou `python3 -m http.server`) e abra o console do navegador (F12).
Se estiver tudo certo, o indicador no topo do app deve mudar de
`💾 Só local` para `☁️ Sincronizando...` e depois `☁️ Sincronizado`.

## Publicando na Vercel

Não precisa de build — é um site estático puro.

```bash
npm install -g vercel   # se ainda não tiver
cd monte-seu-cenario    # pasta deste projeto
vercel                  # segue o assistente, aceite as opções padrão
vercel --prod           # quando quiser publicar a versão final
```

Ou pelo site vercel.com: "Add New Project" > importe a pasta/repositório >
Framework Preset = **Other** > Deploy.

Depois disso, é só abrir a URL que a Vercel te der (tipo `seu-projeto.vercel.app`)
no navegador do tablet — resolve de vez qualquer problema de abrir arquivo local
no Android, porque agora é uma URL de verdade.

## Estrutura do projeto

```
index.html          — página principal
style.css            — visual
script.js            — toda a lógica do app (módulo ES)
db-local.js          — cache local (IndexedDB)
firebase.js          — sincronização com a nuvem (opcional)
firebase-config.js   — suas chaves do Firebase (edite este arquivo)
assets/
  manifest.js        — lista dos adesivos padrão (cenário "Loja")
  background_empty.webp
  thumbnail_complete.webp
  stickers/*.webp
```

## Limitações atuais

- Cada pessoa que abre o app (via autenticação anônima) tem sua própria "gaveta" de
  cenários na nuvem — não tem um jeito de compartilhar entre irmãos/aparelhos ainda
  (dá pra adicionar depois, ex: um código de "família" compartilhado).
- Sem internet nenhuma vez sequer, o app funciona só com o cache local (isso é
  proposital — cache local não depende de rede).
