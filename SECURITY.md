# Segurança

- O GitHub Pages entrega arquivos estáticos publicamente; não coloque dados da planilha no repositório.
- Mantenha o OAuth com audiência `Internal` no Google Workspace da Madesa.
- Restrinja o compartilhamento da planilha a usuários ou grupos corporativos autorizados.
- O bloqueio visual por domínio não substitui as permissões da Google Sheets API.
- `config.js` pode conter Client ID e Spreadsheet ID, mas nunca Client Secret, chave de API privada, token ou credencial Gemini.
- Se o Conselheiro voltar a usar uma IA externa, a chamada deve ficar em um backend autenticado, nunca no JavaScript público.
