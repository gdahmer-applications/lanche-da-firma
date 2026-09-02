# Backend Gemini — configuração única

Este backend mantém `GEMINI_API_KEY` fora do GitHub Pages. O navegador chama o Apps Script com o token OAuth do usuário corporativo, e o script chama o Gemini.

## 1. Criar o projeto

1. Abra [script.google.com](https://script.google.com/) com uma conta administradora `@madesa.com`.
2. Crie um projeto independente chamado **Lanche da Firma — Gemini**.
3. Substitua o conteúdo de `Code.gs` pelo arquivo `GeminiBackend.gs` desta pasta.
4. Em **Project Settings**, habilite a exibição do manifesto e substitua `appsscript.json` pelo arquivo desta pasta.
5. Ainda em **Project Settings → Google Cloud Platform (GCP) Project**, associe o mesmo projeto Google Cloud usado para criar o Client ID OAuth do site. Informe o número desse projeto diretamente no painel Google Cloud; não o publique no repositório.

## 2. Habilitar APIs e guardar a chave

No mesmo projeto Google Cloud:

1. Habilite **Google Apps Script API** e **Generative Language API**.
2. Crie uma chave em [Google AI Studio](https://aistudio.google.com/app/apikey).
3. No Apps Script, abra **Project Settings → Script Properties** e crie:

| Propriedade | Valor |
| --- | --- |
| `GEMINI_API_KEY` | A chave criada no AI Studio |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` |
| `ALLOWED_DOMAIN` | `madesa.com` |

Nunca coloque a chave em `config.js`, no GitHub ou em mensagens.

## 3. Publicar a API

1. No Apps Script, clique em **Deploy → New deployment**.
2. Escolha **API Executable**.
3. Permita somente usuários autorizados da organização Madesa.
4. Publique e copie o **Deployment ID**.
5. Informe esse ID em `appsScriptDeploymentId` no `ai-config.js` do site.

O Deployment ID identifica a API e pode ficar no repositório; ele não é a chave Gemini.

## 4. Frase pela manhã

O primeiro acesso após as 07h já gera e guarda a frase do dia. Para antecipar a geração mesmo sem ninguém abrir o site:

1. Abra **Triggers → Add Trigger** no Apps Script.
2. Escolha `pagesGenerateDailyWisdomTrigger`.
3. Selecione **Time-driven → Day timer → 7am to 8am**.

O Apps Script executa gatilhos diários dentro da janela selecionada, não necessariamente às 07:00:00.

## 5. Teste

Depois de configurar, execute `pagesHealthCheck` no editor. O resultado deve indicar `configured: true`. Na primeira execução, autorize os escopos solicitados.
