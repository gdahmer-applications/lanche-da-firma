# Segurança

- O GitHub Pages entrega arquivos estáticos publicamente; não coloque dados da planilha no repositório.
- Mantenha o OAuth com audiência `Internal` no Google Workspace da Madesa.
- Restrinja o compartilhamento da planilha a usuários ou grupos corporativos autorizados.
- O bloqueio visual por domínio não substitui as permissões da Google Sheets API.
- `config.js` pode conter Client ID e Spreadsheet ID, mas nunca Client Secret, chave de API privada, token ou credencial Gemini.
- O Deployment ID do Apps Script pode ficar em `ai-config.js`; ele identifica o backend, mas não concede acesso sem OAuth.
- A chave Gemini fica somente em **Apps Script → Script Properties**.
- O backend deve ser publicado como **API Executable** restrito aos usuários autorizados da organização.
- O Conselheiro pode enviar ao Gemini todos os dados atuais do rodízio, conforme a autorização e o aviso exibido na interface.
- Para dados corporativos, prefira o nível pago do Gemini se a política interna não permitir uso de dados para melhoria de produtos.
