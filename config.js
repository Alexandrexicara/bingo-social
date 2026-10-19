require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 3000,
  JWT_SECRET: process.env.JWT_SECRET || 'bingo_digital_2026_chave_forte',
  TAXA_PADRAO: parseFloat(process.env.TAXA_PLATAFORMA || 5),
  DATABASE_URL: process.env.DATABASE_URL,
  CHAVE_PIX_PLATAFORMA: process.env.CHAVE_PIX_PLATAFORMA || '',
  WOOVI: {
    API_URL: process.env.WOOVI_API_URL || 'https://api.woovi.com',
    CLIENT_ID: process.env.WOOVI_CLIENT_ID || '',
    CLIENT_SECRET: process.env.WOOVI_CLIENT_SECRET || '',
    WEBHOOK_SECRET: process.env.WOOVI_WEBHOOK_SECRET || ''
  }
};
