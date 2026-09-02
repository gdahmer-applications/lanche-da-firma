# Lanche da Firma — GitHub Pages

Versão estática do rodízio de CUCA, bebidas e lanches, preparada para GitHub Pages.

## O que mudou

- A **BASE** passou para o primeiro item de uma barra lateral fixa, no canto superior esquerdo.
- A própria tela da BASE possui **Novo registro**, **Marcar realizado** e **Remover**.
- O acesso usa Google OAuth e aceita somente contas do domínio configurado (`madesa.com`).
- A planilha Google continua sendo a fonte única dos dados; nenhum histórico é incluído no repositório.
- Inclusão e edição de pessoas, inclusão e remoção de registros e cálculo do ranking funcionam no navegador.
- O Conselheiro pode usar o Gemini com todos os dados atuais do rodízio e mantém o modo local como contingência.
- A frase diária pode ser gerada pelo Gemini uma vez ao dia, a partir das 07h, com cache no backend.
- Nenhuma chave Gemini fica exposta no navegador ou no repositório.

## Arquitetura segura para uma página estática

O GitHub Pages não executa o `Code.gs`. Esta versão usa:

1. Google Identity Services para o login e a autorização.
2. Google Sheets API para ler e editar a planilha em nome do usuário conectado.
3. Google Apps Script API Executable como backend autenticado para o Gemini.
4. Três barreiras para a base: OAuth com audiência **Interna**, conferência do domínio `hd=madesa.com` e permissões da própria planilha.

O token de acesso fica somente na memória da aba do navegador e não é gravado em `localStorage`, cookies ou arquivos.

> O endereço e o HTML de um site no GitHub Pages são públicos. A tela de login protege o uso da aplicação, e os dados continuam protegidos pelo Google. Não envie a planilha `.xlsx`, exports ou chaves privadas para o repositório.

## 1. Preparar a planilha

Use a planilha Google atual ou importe `Lanches_Rodizio_Inteligente.xlsx` no Google Drive e abra como Google Sheets.

Ela deve manter estas abas e colunas:

- `PARTICIPANTES` — dados em `A:I`, a partir da linha 4.
- `CUCA` — histórico em `A:K`, a partir da linha 4.
- `BEBIDAS` — histórico em `A:K`, a partir da linha 4.
- `LANCHES` — histórico em `A:K`, a partir da linha 4.

Compartilhe a planilha somente com as pessoas ou grupo corporativo que devem editar o rodízio. Cada usuário precisa de permissão de **Editor** para adicionar, atualizar ou remover dados.

Copie o ID que aparece na URL:

```text
https://docs.google.com/spreadsheets/d/ID_DA_PLANILHA/edit
```

## 2. Configurar o login Google

No Google Cloud de propriedade da Madesa:

1. Habilite a **Google Sheets API**.
2. Em **Google Auth Platform → Audience**, escolha **Internal**.
3. Crie um **OAuth Client ID** do tipo **Web application**.
4. Em **Authorized JavaScript origins**, inclua a origem do GitHub Pages:

```text
https://gdahmer-applications.github.io
```

Se for usado um domínio próprio, inclua também sua origem HTTPS. Para o fluxo em popup desta aplicação não é necessário cadastrar o caminho do repositório como redirect URI.

## 3. Preencher `config.js`

```js
window.LANCHES_CONFIG = Object.freeze({
  googleClientId: "000000000000-xxxxxxxx.apps.googleusercontent.com",
  spreadsheetId: "1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  allowedDomain: "madesa.com",
  timezone: "America/Sao_Paulo",
  appName: "Lanche da Firma",
  allowDemo: false
});
```

O Client ID e o ID da planilha identificam recursos; eles não substituem as permissões do Google e não são segredos. Nunca adicione **Client Secret**, chave Gemini ou token de acesso ao repositório.

## 4. Conectar o Gemini

O código pronto está em [`apps-script/`](apps-script/README.md). A configuração é feita uma única vez:

1. Crie o projeto Apps Script no mesmo Google Cloud Project do Client ID atual.
2. Habilite **Google Apps Script API** e **Generative Language API**.
3. Salve `GEMINI_API_KEY` somente nas **Script Properties**.
4. Publique como **API Executable**, restrito à organização Madesa.
5. Copie o Deployment ID para `appsScriptDeploymentId` em `ai-config.js`.

```js
window.LANCHES_AI_CONFIG = Object.freeze({
  appsScriptDeploymentId: "AKfycbxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
});
```

O Deployment ID identifica a API autenticada e pode ficar no repositório; ele não concede acesso sem OAuth.

Enquanto esse ID estiver vazio ou o backend estiver indisponível, a aplicação continua operando em modo local. Ao ativar o Gemini, todos os dados atuais do rodízio podem ser enviados para responder ao usuário, conforme informado na interface.

> Para dados corporativos, avalie usar um projeto Gemini com faturamento habilitado. A documentação atual informa que dados do nível gratuito podem ser usados para melhorar produtos do Google, enquanto no nível pago não: https://ai.google.dev/gemini-api/docs/pricing

## 5. Publicar no GitHub Pages

1. Crie um repositório exclusivo para o site e envie o conteúdo desta pasta para a branch `main`.
2. Abra **Settings → Pages**.
3. Em **Build and deployment → Source**, selecione **GitHub Actions**.
4. O workflow `.github/workflows/pages.yml` valida a lógica e publica automaticamente.

A URL padrão será:

```text
https://gdahmer-applications.github.io/NOME_DO_REPOSITORIO/
```

## Validação local

```bash
npm test
python -m http.server 8000
```

Abra `http://localhost:8000`. Para testar com dados fictícios, altere temporariamente `allowDemo` para `true` e abra `http://localhost:8000/?demo=1`. Volte para `false` antes da publicação.

## Solução de problemas

- **origin_mismatch**: inclua exatamente `https://gdahmer-applications.github.io` nas origens JavaScript autorizadas.
- **Acesso negado**: confirme que o projeto OAuth é interno e que a conta possui `hd=madesa.com`.
- **Erro 403 na planilha**: habilite a Google Sheets API e conceda permissão de Editor ao usuário.
- **Planilha não encontrada**: revise o ID em `config.js` e o compartilhamento.
- **Sessão expirada**: clique em Sair e entre novamente; os tokens do fluxo web têm duração curta.
- **Gemini 403**: confirme que Apps Script, OAuth Client ID e APIs estão no mesmo Google Cloud Project.
- **Gemini não configurado**: confira `GEMINI_API_KEY` nas Script Properties e o Deployment ID em `config.js`.

## Referências oficiais

- Google Identity Services — token model: https://developers.google.com/identity/oauth2/web/guides/use-token-model
- Google Sheets API para JavaScript: https://developers.google.com/workspace/sheets/api/quickstart/js
- Apps Script API `scripts.run`: https://developers.google.com/apps-script/api/how-tos/execute
- Gemini 3.5 Flash-Lite: https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite
- Segurança de chaves Gemini: https://ai.google.dev/gemini-api/docs/api-key
- Restrições por domínio Google Workspace (`hd`): https://developers.google.com/identity/openid-connect/reference
- GitHub Pages com Actions: https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
