/**
 * Configuração pública do site.
 *
 * O Client ID OAuth e o ID da planilha identificam recursos, mas não são
 * senhas. O acesso aos dados continua protegido pelo Google Workspace e pelas
 * permissões da própria planilha. Nunca coloque Client Secret ou chave Gemini
 * neste arquivo.
 */
window.LANCHES_CONFIG = Object.freeze({
  googleClientId: "COLE_AQUI_O_CLIENT_ID.apps.googleusercontent.com",
  spreadsheetId: "COLE_AQUI_O_ID_DA_PLANILHA",
  allowedDomain: "madesa.com",
  timezone: "America/Sao_Paulo",
  appName: "Lanche da Firma",
  allowDemo: false
});
