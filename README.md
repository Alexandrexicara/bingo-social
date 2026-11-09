# Bingo Social

Sistema de bingo online com cadastro de jogadores e instituições, gestão de bingos, cartelas, sorteios, painel administrativo, banco PostgreSQL no Neon e pagamentos PIX pela Woovi.

## Execução local

Requer Node.js 20 ou superior.

\`\`\`bash
npm ci
npm start
\`\`\`

Configure as variáveis de ambiente antes de iniciar.

## Banco de dados

O sistema usa PostgreSQL (Neon). Não usa SQLite nem MongoDB na execução da aplicação.

- \`DATABASE_URL\`: conexão PostgreSQL do Neon.
- As tabelas são criadas pelo \`database.js\` quando ainda não existem.
- Para atualizar um banco existente, aplique os scripts em \`db/migrations/\` na ordem indicada.
- As migrations são aditivas: não apagam os dados existentes.

## Variáveis de ambiente

Obrigatórias para produção:

| Variável | Finalidade |
| --- | --- |
| \`DATABASE_URL\` | Conexão com o PostgreSQL do Neon |
| \`JWT_SECRET\` | Assinatura das sessões JWT (mínimo 32 caracteres) |
| \`CREDENTIALS_ENCRYPTION_KEY\` | Criptografia AES-256-GCM das credenciais Woovi das instituições |

Integração Woovi:

| Variável | Finalidade |
| --- | --- |
| \`WOOVI_API_URL\` | API de produção; padrão \`https://api.woovi.com\` |
| \`WOOVI_APP_ID\` | App ID global opcional, usado como alternativa às credenciais por instituição |
| \`WOOVI_CLIENT_ID\` / \`WOOVI_CLIENT_SECRET\` | Credenciais globais alternativas |
| \`WOOVI_WEBHOOK_SECRET\` | Segredo HMAC global alternativo |
| \`WOOVI_WEBHOOK_AUTHORIZATION\` | Token estático opcional para autenticar webhooks |

As credenciais individuais da Woovi são informadas no cadastro da instituição e armazenadas criptografadas no banco. Mantenha \`CREDENTIALS_ENCRYPTION_KEY\` estável: trocar essa chave sem recriptografar os registros impede a leitura das credenciais já armazenadas.

## Pagamentos PIX e split

1. A instituição informa Client ID, Client Secret e o segredo HMAC do webhook no cadastro.
2. O servidor cria a cobrança em \`POST /api/v1/charge\` usando o App ID daquela instituição.
3. A taxa configurada pelo administrador é enviada à chave PIX da plataforma com \`splitType: SPLIT_PARTNER\`; o restante permanece com a instituição.
4. O cliente recebe QR Code e PIX Copia e Cola.
5. A cartela só é marcada como paga após o webhook \`OPENPIX:CHARGE_COMPLETED\` validado e processado de forma idempotente.

**Importante:** o recurso Split Partner precisa estar habilitado pela Woovi e a relação parceiro/afiliado precisa estar configurada na Woovi. Sem isso, a API pode rejeitar a cobrança com split. Configure a chave PIX da plataforma no painel Admin.

Cadastre na Woovi o webhook para o endereço público:

\`\`\`
https://SEU-SERVICO.onrender.com/api/webhook/woovi
\`\`\`

Selecione o evento \`OPENPIX:CHARGE_COMPLETED\` e use o mesmo segredo HMAC informado no cadastro da instituição (ou configure uma autenticação global no Render). O servidor valida a assinatura antes de atualizar pagamento e cartela.

## Render

O arquivo \`render.yaml\` define o Web Service Node, health check em \`/api/health\`, deploy automático pela branch \`main\` e variáveis necessárias. Configure \`DATABASE_URL\` e os segredos da Woovi no ambiente do serviço; não coloque segredos no GitHub.

## Segurança

- Senhas de usuário são armazenadas com bcrypt.
- JWT não possui segredo padrão no código.
- Credenciais Woovi de instituições são criptografadas com AES-256-GCM.
- Respostas administrativas não retornam hashes de senha nem credenciais Woovi.
- Rotas de gestão validam o proprietário do bingo ou o perfil administrador.
- Webhooks validam autenticação, e eventos repetidos não liberam a mesma cartela duas vezes.
