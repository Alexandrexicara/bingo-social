require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('Configure JWT_SECRET com pelo menos 32 caracteres.');
}

module.exports = {
  PORT: Number(process.env.PORT || 10000),
  JWT_SECRET,
  TAXA_PADRAO: Number(process.env.TAXA_PLATAFORMA || 5),
  DATABASE_URL: process.env.DATABASE_URL,
  CHAVE_PIX_PLATAFORMA: process.env.CHAVE_PIX_PLATAFORMA || '',
  WOOVI: {
    API_URL: (process.env.WOOVI_API_URL || 'https://api.woovi.com').replace(/\/+$/, ''),
    APP_ID: process.env.WOOVI_APP_ID || '',
    CLIENT_ID: process.env.WOOVI_CLIENT_ID || '',
    CLIENT_SECRET: process.env.WOOVI_CLIENT_SECRET || '',
    WEBHOOK_SECRET: process.env.WOOVI_WEBHOOK_SECRET || '',
    WEBHOOK_AUTHORIZATION: process.env.WOOVI_WEBHOOK_AUTHORIZATION || ''
  }
};
