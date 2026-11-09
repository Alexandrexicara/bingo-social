require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { pool, criarTabelas } = require('./database');

const app = express();
const PORT = Number(process.env.PORT || 10000);
const JWT_SECRET = process.env.JWT_SECRET;
const WOOVI_URL = (process.env.WOOVI_API_URL || 'https://api.woovi.com').replace(/\/+$/, '');
if (!JWT_SECRET || JWT_SECRET.length < 32) throw new Error('Configure JWT_SECRET com pelo menos 32 caracteres.');

app.disable('x-powered-by');
app.use(cors({ origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map(v => v.trim()) : true }));
app.use(express.json({ limit: '1mb', verify: (req, res, buffer) => { req.rawBody = Buffer.from(buffer); } }));
app.use(express.static('public'));

function fail(res, status, message) { return res.status(status).json({ erro: message }); }
function validEmail(email) { return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()); }
function isAdmin(req) { return req.usuario && req.usuario.tipo === 'admin'; }
function auth(req, res, next) {
  const parts = String(req.headers.authorization || '').split(' ');
  if (parts.length !== 2 || !/^Bearer$/i.test(parts[0])) return fail(res, 401, 'Faça login para continuar.');
  try { req.usuario = jwt.verify(parts[1], JWT_SECRET); return next(); }
  catch { return fail(res, 401, 'Sessão expirada. Entre novamente.'); }
}
function admin(req, res, next) { if (!isAdmin(req)) return fail(res, 403, 'Acesso permitido somente ao administrador.'); return next(); }
async function getConfig() {
  const r = await pool.query('SELECT * FROM configuracoes ORDER BY id LIMIT 1');
  return r.rows[0] || { taxa_plataforma: 5, chave_pix_plataforma: '' };
}
function gerarCartela() {
  const ranges = [[1,15],[16,30],[31,45],[46,60],[61,75]], cols = [];
  for (let c=0;c<5;c++) {
    const col=[];
    while (col.length<5) { const n=Math.floor(Math.random()*(ranges[c][1]-ranges[c][0]+1))+ranges[c][0]; if(!col.includes(n)) col.push(n); }
    cols.push(col);
  }
  cols[2][2]=0; return cols.flat();
}
function wooviAppId() {
  if (process.env.WOOVI_APP_ID) return process.env.WOOVI_APP_ID.trim();
  if (process.env.WOOVI_CLIENT_ID && process.env.WOOVI_CLIENT_SECRET)
    return Buffer.from(process.env.WOOVI_CLIENT_ID + ':' + process.env.WOOVI_CLIENT_SECRET, 'utf8').toString('base64');
  return '';
}
async function createWooviCharge(data) {
  const appId=wooviAppId();
  if(!appId) { const e=new Error('Integração Woovi não configurada no servidor.'); e.status=503; throw e; }
  const response=await fetch(WOOVI_URL+'/api/v1/charge',{
    method:'POST',
    headers:{Authorization:appId,'Content-Type':'application/json',Accept:'application/json'},
    body:JSON.stringify({
      correlationID:data.correlationID,
      value:data.valueCents,
      comment:data.comment,
      customer:{name:data.user.nome,email:data.user.email,phone:data.user.telefone || undefined}
    }),
    signal:AbortSignal.timeout(15000)
  });
  const body=await response.json().catch(()=>({}));
  if(!response.ok) {
    console.error('Woovi charge error:',response.status,body.error || body.message || 'sem detalhe');
    const e=new Error('A Woovi não conseguiu gerar a cobrança PIX.'); e.status=502; throw e;
  }
  const c=body.charge || body;
  if(!c.brCode && !c.qrCodeImage && !c.paymentLinkUrl) {
    const e=new Error('A Woovi respondeu sem QR Code ou código PIX.'); e.status=502; throw e;
  }
  return {id:c.identifier || c.id || null,brCode:c.brCode || c.copyPaste || null,qr:c.qrCodeImage || c.qrCode || null,link:c.paymentLinkUrl || c.url || null,expires:c.expiresDate || c.expiresAt || null};
}
function signatureOk(raw, signature, secret, algorithm) {
  if(!raw || !signature || !secret) return false;
  const expected=crypto.createHmac(algorithm,secret).update(raw).digest('base64');
  const a=Buffer.from(String(signature).trim()), b=Buffer.from(expected);
  return a.length===b.length && crypto.timingSafeEqual(a,b);
}
function webhookAuth(req) {
  const token=process.env.WOOVI_WEBHOOK_AUTHORIZATION;
  const header=req.get('authorization') || req.get('x-openpix-authorization') || '';
  if(token && (header===token || header==='Bearer '+token)) return true;
  const secret=process.env.WOOVI_WEBHOOK_SECRET;
  if(!secret) return false;
  return signatureOk(req.rawBody,req.get('x-openpix-signature'),secret,'sha1') ||
    signatureOk(req.rawBody,req.get('x-webhook-signature'),secret,'sha256');
}
async function ownedBingo(req,res) {
  const r=await pool.query('SELECT * FROM bingos WHERE id=$1',[req.params.id]);
  if(!r.rows.length) { fail(res,404,'Bingo não encontrado.'); return null; }
  const b=r.rows[0];
  if(!isAdmin(req) && Number(b.usuario_id)!==Number(req.usuario.id)) { fail(res,403,'Você não tem permissão para administrar este bingo.'); return null; }
  return b;
}

app.get('/api/health',async(req,res)=>{
  try { await pool.query('SELECT 1'); res.json({status:'ok',database:'connected'}); }
  catch(e) { console.error('Health check:',e.message); res.status(503).json({status:'error',database:'unavailable'}); }
});

app.post('/api/auth/register',async(req,res)=>{
  try {
    const b=req.body || {}, tipo=b.tipo, nome=typeof b.nome==='string'?b.nome.trim():'', email=typeof b.email==='string'?b.email.trim().toLowerCase():'', senha=typeof b.senha==='string'?b.senha:'';
    if(!['jogador','instituicao'].includes(tipo)) return fail(res,400,'Tipo de conta inválido.');
    if(nome.length<2 || nome.length>255) return fail(res,400,'Informe um nome válido.');
    if(!validEmail(email)) return fail(res,400,'Informe um e-mail válido.');
    if(senha.length<8) return fail(res,400,'A senha deve ter pelo menos 8 caracteres.');
    const cnpj=typeof b.cnpj==='string'?b.cnpj.replace(/\D/g,''):'', chave=typeof b.chave_pix==='string'?b.chave_pix.trim():'';
    const endereco=typeof b.endereco==='string'?b.endereco.trim():'', responsavel=typeof b.responsavel==='string'?b.responsavel.trim():'';
    if(tipo==='instituicao' && (cnpj.length!==14 || !chave || !endereco || !responsavel)) return fail(res,400,'Preencha CNPJ, endereço, responsável e chave PIX da instituição.');
    const hash=await bcrypt.hash(senha,12), status=tipo==='jogador'?'aprovado':'pendente';
    const r=await pool.query('INSERT INTO usuarios (tipo,nome,email,senha,telefone,cnpj,endereco,responsavel,chave_pix,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id,tipo,nome,email,status',
      [tipo,nome,email,hash,typeof b.telefone==='string'?b.telefone.trim():null,cnpj||null,endereco||null,responsavel||null,chave||null,status]);
    return res.status(201).json({mensagem:tipo==='instituicao'?'Cadastro enviado. Aguarde aprovação do administrador.':'Conta criada com sucesso. Faça login.',usuario:r.rows[0]});
  } catch(e) { if(e.code==='23505') return fail(res,409,'Este e-mail já está cadastrado.'); console.error('Register:',e); return fail(res,500,'Não foi possível concluir o cadastro.'); }
});

app.post('/api/auth/login',async(req,res)=>{
  try {
    const email=typeof req.body.email==='string'?req.body.email.trim().toLowerCase():'', senha=typeof req.body.senha==='string'?req.body.senha:'';
    if(!validEmail(email)||!senha) return fail(res,400,'Informe e-mail e senha.');
    const r=await pool.query('SELECT id,tipo,nome,email,senha,status FROM usuarios WHERE email=$1',[email]);
    if(!r.rows.length || !(await bcrypt.compare(senha,r.rows[0].senha))) return fail(res,401,'E-mail ou senha incorretos.');
    const u=r.rows[0]; if(u.status!=='aprovado') return fail(res,403,'Seu cadastro ainda aguarda aprovação.');
    const token=jwt.sign({id:u.id,tipo:u.tipo,nome:u.nome},JWT_SECRET,{expiresIn:'24h'});
    res.json({token,usuario:{id:u.id,tipo:u.tipo,nome:u.nome,email:u.email}});
  } catch(e) { console.error('Login:',e); fail(res,500,'Não foi possível realizar o login.'); }
});

app.get('/api/auth/me',auth,async(req,res)=>{
  const r=await pool.query('SELECT id,tipo,nome,email,status FROM usuarios WHERE id=$1',[req.usuario.id]);
  if(!r.rows.length || r.rows[0].status!=='aprovado') return fail(res,401,'Sessão inválida.');
  res.json({usuario:r.rows[0]});
});

app.get('/api/configuracoes',auth,admin,async(req,res)=>{
  const c=await getConfig(); res.json({taxa_plataforma:Number(c.taxa_plataforma),chave_pix_plataforma:c.chave_pix_plataforma||'',voz_padrao:c.voz_padrao||'Adam'});
});
app.patch('/api/configuracoes',auth,admin,async(req,res)=>{
  const taxa=Number(req.body.taxa_plataforma), chave=typeof req.body.chave_pix_plataforma==='string'?req.body.chave_pix_plataforma.trim():'';
  if(!Number.isFinite(taxa)||taxa<0||taxa>100) return fail(res,400,'A taxa deve estar entre 0 e 100%.');
  const r=await pool.query('UPDATE configuracoes SET taxa_plataforma=$1,chave_pix_plataforma=$2,atualizado_em=CURRENT_TIMESTAMP WHERE id=(SELECT id FROM configuracoes ORDER BY id LIMIT 1) RETURNING taxa_plataforma,chave_pix_plataforma',[taxa,chave]);
  res.json({mensagem:'Configurações salvas.',configuracoes:r.rows[0]});
});

app.get('/api/bingos',async(req,res)=>{
  const r=await pool.query("SELECT b.id,b.usuario_id,b.nome,b.premio,b.imagem_premio,b.data_sorteio,b.preco_cartela,b.max_cartelas,b.limite_por_pessoa,b.status,b.sorteio_auto,b.intervalo_bolas,b.voz_numeros,u.nome AS instituicao_nome FROM bingos b JOIN usuarios u ON b.usuario_id=u.id WHERE b.arquivado IS DISTINCT FROM TRUE AND b.status IN ('publicado','em_andamento') ORDER BY b.data_sorteio DESC");
  res.json(r.rows);
});
app.post('/api/bingos',auth,async(req,res)=>{
  if(!['instituicao','admin'].includes(req.usuario.tipo)) return fail(res,403,'Somente instituições aprovadas podem criar bingos.');
  const b=req.body||{},nome=typeof b.nome==='string'?b.nome.trim():'',premio=typeof b.premio==='string'?b.premio.trim():'',preco=Number(b.preco_cartela),max=parseInt(b.max_cartelas,10)||500,limite=parseInt(b.limite_por_pessoa,10)||3;
  if(!nome||!premio||!b.data_sorteio||!Number.isFinite(Date.parse(b.data_sorteio))) return fail(res,400,'Informe nome, prêmio e data válida.');
  if(!Number.isFinite(preco)||preco<=0||preco>1000000) return fail(res,400,'Informe um preço válido para a cartela.');
  if(max<1||max>1000000||limite<1||limite>max) return fail(res,400,'Limites de cartelas inválidos.');
  const r=await pool.query('INSERT INTO bingos (usuario_id,nome,premio,data_sorteio,preco_cartela,max_cartelas,limite_por_pessoa) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',[req.usuario.id,nome,premio,new Date(b.data_sorteio).toISOString(),preco,max,limite]);
  res.status(201).json(r.rows[0]);
});
app.patch('/api/bingos/:id/publicar',auth,async(req,res)=>{
  const b=await ownedBingo(req,res); if(!b) return;
  if(b.status!=='rascunho') return fail(res,409,'Somente um bingo em rascunho pode ser publicado.');
  const r=await pool.query("UPDATE bingos SET status='publicado' WHERE id=$1 RETURNING *",[b.id]); res.json(r.rows[0]);
});

app.post('/api/bingos/:id/cartela',auth,async(req,res)=>{
  if(!wooviAppId()) return fail(res,503,'O pagamento PIX ainda não está configurado no servidor.');
  const client=await pool.connect(); let ticket,corr,total,platform,instValue,cfg,inst;
  try {
    await client.query('BEGIN');
    const br=await client.query('SELECT * FROM bingos WHERE id=$1 FOR UPDATE',[req.params.id]);
    if(!br.rows.length) { await client.query('ROLLBACK'); return fail(res,404,'Bingo não encontrado.'); }
    const bingo=br.rows[0];
    if(bingo.status!=='publicado') { await client.query('ROLLBACK'); return fail(res,409,'As vendas desta cartela não estão abertas.'); }
    cfg=await getConfig();
    const ir=await client.query('SELECT id,nome,chave_pix FROM usuarios WHERE id=$1 AND status=$2',[bingo.usuario_id,'aprovado']);
    if(!ir.rows.length) { await client.query('ROLLBACK'); return fail(res,409,'Instituição responsável indisponível.'); }
    inst=ir.rows[0];
    const count=await client.query('SELECT COUNT(*)::int AS total FROM cartelas WHERE bingo_id=$1',[bingo.id]);
    if(count.rows[0].total>=Number(bingo.max_cartelas||500)) { await client.query('ROLLBACK'); return fail(res,409,'Todas as cartelas já foram vendidas.'); }
    const own=await client.query('SELECT COUNT(*)::int AS total FROM cartelas WHERE bingo_id=$1 AND usuario_id=$2',[bingo.id,req.usuario.id]);
    if(own.rows[0].total>=Number(bingo.limite_por_pessoa||3)) { await client.query('ROLLBACK'); return fail(res,409,'Você atingiu o limite de cartelas deste bingo.'); }
    total=Number(bingo.preco_cartela); platform=Number((total*Number(cfg.taxa_plataforma)/100).toFixed(2)); instValue=Number((total-platform).toFixed(2));
    corr='BINGO-'+bingo.id+'-'+crypto.randomUUID();
    const code='B'+bingo.id+'-'+crypto.randomBytes(4).toString('hex').toUpperCase();
    const tr=await client.query('INSERT INTO cartelas (bingo_id,usuario_id,codigo,numeros,paga) VALUES ($1,$2,$3,$4,false) RETURNING *',[bingo.id,req.usuario.id,code,gerarCartela()]);
    ticket=tr.rows[0];
    await client.query("INSERT INTO pagamentos (cartela_id,valor_total,valor_plataforma,chave_pix_plataforma,valor_instituicao,chave_pix_instituicao,txid,status,correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,'pendente',$7)",
      [ticket.id,total,platform,cfg.chave_pix_plataforma||'',instValue,inst.chave_pix||'',corr]);
    await client.query('COMMIT');
  } catch(e) { await client.query('ROLLBACK').catch(()=>{}); console.error('Ticket:',e); return fail(res,500,'Não foi possível reservar a cartela.'); }
  finally { client.release(); }

  try {
    const pix=await createWooviCharge({correlationID:corr,valueCents:Math.round(total*100),comment:'Cartela '+ticket.codigo+' - Bingo Social',user:req.usuario});
    await pool.query('UPDATE pagamentos SET woovi_charge_id=$1,br_code=$2,qr_code_image=$3,payment_link_url=$4,expires_at=$5 WHERE correlation_id=$6',[pix.id,pix.brCode,pix.qr,pix.link,pix.expires,corr]);
    await pool.query('UPDATE cartelas SET txid_woovi=$1 WHERE id=$2',[corr,ticket.id]);
    res.status(201).json({...ticket,valor_total:total,valor_plataforma:platform,valor_instituicao:instValue,pix:{brCode:pix.brCode,qrCodeImage:pix.qr,paymentLinkUrl:pix.link,expiresAt:pix.expires},mensagem:'PIX criado. A cartela será liberada após a confirmação do pagamento.'});
  } catch(e) {
    await pool.query("UPDATE pagamentos SET status='erro' WHERE correlation_id=$1 AND status='pendente'",[corr]);
    console.error('Woovi:',e.message); fail(res,e.status||502,e.message||'Não foi possível gerar o PIX.');
  }
});

app.post('/api/webhook/woovi',async(req,res)=>{
  if(!webhookAuth(req)) return fail(res,401,'Assinatura do webhook inválida.');
  const p=req.body||{},event=p.event||'',charge=p.charge||{};
  if(event!=='OPENPIX:CHARGE_COMPLETED') return res.status(200).json({ok:true,ignorado:true});
  const corr=charge.correlationID||charge.correlationId;
  if(!corr) return fail(res,400,'Evento sem correlationID.');
  const eventKey=String(charge.identifier||charge.id||corr)+':'+event,client=await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted=await client.query('INSERT INTO webhook_events (event_key,event_type,correlation_id) VALUES ($1,$2,$3) ON CONFLICT (event_key) DO NOTHING RETURNING id',[eventKey,event,corr]);
    if(!inserted.rows.length) { await client.query('COMMIT'); return res.status(200).json({ok:true,duplicado:true}); }
    const pay=await client.query('SELECT cartela_id,status FROM pagamentos WHERE correlation_id=$1 FOR UPDATE',[corr]);
    if(pay.rows.length && pay.rows[0].status!=='concluido') {
      await client.query("UPDATE pagamentos SET status='concluido' WHERE correlation_id=$1",[corr]);
      await client.query('UPDATE cartelas SET paga=true WHERE id=$1',[pay.rows[0].cartela_id]);
    }
    await client.query('COMMIT'); res.status(200).json({ok:true});
  } catch(e) { await client.query('ROLLBACK').catch(()=>{}); console.error('Webhook:',e); fail(res,500,'Falha ao processar confirmação PIX.'); }
  finally { client.release(); }
});

app.get('/api/pagamentos/:cartelaId',auth,async(req,res)=>{
  const r=await pool.query('SELECT c.id,c.usuario_id,c.paga,p.status,p.br_code,p.qr_code_image,p.payment_link_url,p.expires_at FROM cartelas c JOIN pagamentos p ON p.cartela_id=c.id WHERE c.id=$1',[req.params.cartelaId]);
  if(!r.rows.length) return fail(res,404,'Pagamento não encontrado.');
  if(!isAdmin(req)&&Number(r.rows[0].usuario_id)!==Number(req.usuario.id)) return fail(res,403,'Sem permissão.');
  res.json(r.rows[0]);
});
app.get('/api/minhas-cartelas',auth,async(req,res)=>{
  const r=await pool.query('SELECT c.*,b.nome AS bingo_nome,b.premio,b.data_sorteio,b.preco_cartela,p.status AS pagamento_status,p.br_code,p.qr_code_image,p.payment_link_url FROM cartelas c JOIN bingos b ON c.bingo_id=b.id LEFT JOIN pagamentos p ON p.cartela_id=c.id WHERE c.usuario_id=$1 ORDER BY b.data_sorteio DESC',[req.usuario.id]);
  res.json(r.rows);
});
app.get('/api/bingos/:id',async(req,res)=>{
  const b=await pool.query('SELECT b.*,u.nome AS instituicao_nome FROM bingos b LEFT JOIN usuarios u ON u.id=b.usuario_id WHERE b.id=$1 AND b.arquivado IS DISTINCT FROM TRUE',[req.params.id]);
  if(!b.rows.length) return fail(res,404,'Bingo não encontrado.');
  const s=await pool.query('SELECT numero FROM sorteios WHERE bingo_id=$1 ORDER BY ordem',[req.params.id]);
  res.json({bingo:b.rows[0],sorteados:s.rows.map(x=>x.numero)});
});
app.post('/api/bingos/:id/iniciar',auth,async(req,res)=>{
  const b=await ownedBingo(req,res); if(!b) return;
  if(b.status!=='publicado') return fail(res,409,'O bingo precisa estar publicado para iniciar.');
  await pool.query("UPDATE bingos SET status='em_andamento' WHERE id=$1",[b.id]); res.json({mensagem:'Sorteio iniciado.'});
});
app.post('/api/bingos/:id/sortear',auth,async(req,res)=>{
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const r=await client.query('SELECT * FROM bingos WHERE id=$1 FOR UPDATE',[req.params.id]);
    if(!r.rows.length) { await client.query('ROLLBACK'); return fail(res,404,'Bingo não encontrado.'); }
    const b=r.rows[0];
    if(!isAdmin(req)&&Number(b.usuario_id)!==Number(req.usuario.id)) { await client.query('ROLLBACK'); return fail(res,403,'Você não pode sortear neste bingo.'); }
    if(b.status!=='em_andamento') { await client.query('ROLLBACK'); return fail(res,409,'O sorteio ainda não foi iniciado.'); }
    const s=await client.query('SELECT numero FROM sorteios WHERE bingo_id=$1',[b.id]), used=new Set(s.rows.map(x=>Number(x.numero)));
    if(used.size>=75) { await client.query('ROLLBACK'); return fail(res,409,'Todos os números já foram sorteados.'); }
    let n; do { n=Math.floor(Math.random()*75)+1; } while(used.has(n));
    await client.query('INSERT INTO sorteios (bingo_id,numero,ordem) VALUES ($1,$2,$3)',[b.id,n,used.size+1]);
    await client.query('COMMIT'); res.json({numero:n});
  } catch(e) { await client.query('ROLLBACK').catch(()=>{}); console.error('Sorteio:',e); fail(res,500,'Não foi possível sortear.'); }
  finally { client.release(); }
});
app.patch('/api/usuarios/:id/aprovar',auth,admin,async(req,res)=>{
  const r=await pool.query("UPDATE usuarios SET status='aprovado' WHERE id=$1 AND tipo='instituicao' RETURNING id,tipo,nome,email,status",[req.params.id]);
  if(!r.rows.length) return fail(res,404,'Instituição não encontrada.'); res.json(r.rows[0]);
});
app.get('/api/admin/instituicoes',auth,admin,async(req,res)=>{
  const r=await pool.query("SELECT id,nome,email,telefone,cnpj,endereco,responsavel,chave_pix,status FROM usuarios WHERE tipo='instituicao' AND status='pendente' ORDER BY criado_em");
  res.json(r.rows);
});
app.get('/api/meus-bingos',auth,async(req,res)=>{
  const r=await pool.query('SELECT * FROM bingos WHERE usuario_id=$1 ORDER BY criado_em DESC',[req.usuario.id]); res.json(r.rows);
});

async function iniciar() {
  await criarTabelas();
  await pool.query('SELECT 1');
  const cfg=await getConfig();
  console.log('Bingo Social iniciado na porta '+PORT);
  console.log('Taxa da plataforma: '+Number(cfg.taxa_plataforma)+'%');
  console.log('Woovi: '+(wooviAppId()?'credenciais presentes':'aguardando credenciais'));
  app.listen(PORT,'0.0.0.0');
}
iniciar().catch(e=>{console.error('Falha ao iniciar Bingo Social:',e);process.exit(1);});
module.exports=app;
