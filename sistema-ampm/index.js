const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const QRCode = require('qrcode');
const path = require('path');
const mongoose = require('mongoose');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const axios = require('axios');
const cron = require('node-cron');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');

// --- INTEGRAÇÃO SUPABASE STORAGE ---
const { createClient } = require('@supabase/supabase-js');

// --- SEGURANÇA: TROQUE ESTA CHAVE NO SEU SERVIDOR ---
const JWT_SECRET = process.env.JWT_SECRET || "NOVA_CHAVE_SEGURA_2026"; 
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(mongoSanitize());
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 500, message: "Muitas requisições." });
app.use(limiter);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// --- CONFIGURAÇÃO SUPABASE ---
const supabaseUrl = process.env.SUPABASE_URL || 'https://sua-url-aqui.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY || 'sua-chave-anon-aqui';
const supabase = createClient(supabaseUrl, supabaseKey);

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// --- FUNÇÃO DE ENVIO WHATSAPP ---
async function dispararWhatsApp(telefone, mensagem) {
    try {
        const urlApi = process.env.WHATSAPP_API_URL || 'SUA_URL_DA_API_AQUI';
        const tokenApi = process.env.WHATSAPP_API_TOKEN || 'SEU_TOKEN_AQUI';
        if(urlApi === 'SUA_URL_DA_API_AQUI') return;
        await axios.post(urlApi, {
            number: telefone.replace(/\D/g, ""), 
            message: mensagem
        }, { headers: { 'Authorization': `Bearer ${tokenApi}` } });
    } catch (error) { console.error("❌ Erro ao enviar WhatsApp:", error.message); }
}

const INTEGRACAO_CONFIG = { ativa: false, tokenSecreto: process.env.API_PARCEIRO_TOKEN || "TOKEN_PADRAO_SEGURANCA" };
const authApi = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (authHeader === INTEGRACAO_CONFIG.tokenSecreto) return next();
    return res.status(403).json({ error: "Acesso Negado." });
};

const ADMIN_PASS = String(process.env.ADMIN_PASS || "Polipet2024").trim();

const auth = async (req, res, next) => {
    const token = req.cookies.auth_token;
    if (!token) return res.redirect('/login');

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.isAdmin) {
            req.usuario = { isAdmin: true, rede: 'TODAS', lojas: [] };
            return next();
        }
        
        const tenant = await mongoose.model('Tenant').findById(decoded.id);
        if (tenant) {
            req.usuario = { isAdmin: false, rede: tenant.rede, lojas: tenant.lojasPermitidas };
            return next();
        }
        res.redirect('/login');
    } catch (err) {
        res.clearCookie('auth_token');
        res.redirect('/login');
    }
};

mongoose.connect(process.env.MONGODB_URI).then(() => {
    console.log("☁️ Conectado ao MongoDB com sucesso!");
    atualizarCache(); 
}).catch(err => console.error("❌ Erro ao conectar no MongoDB:", err));

// --- SCHEMAS ORIGINAIS ---
const CampanhaSchema = new mongoose.Schema({ 
    loja: String, orientacao: String, arquivo: String, qtd: { type: Number, default: 100 }, 
    premio1: String, premio2: String, posicoesOuro: String, contagemParticipantes: { type: Number, default: 0 }, 
    trollAzaradoAtivo: { type: Boolean, default: false }, fantasmaMadrugadaAtivo: { type: Boolean, default: false },
    tipoInteracao: { type: String, default: 'raspadinha' } 
});
const VendaSchema = new mongoose.Schema({ data: String, hora: String, clienteNome: String, clienteZap: String, codigo: String, premio: String, status: String, vendedor: String, localizacao: { type: String, default: 'Geral' }, timestamp: { type: Date, default: Date.now }, aceitouLGPD: { type: Boolean, default: true }, ipCliente: String, tipo: { type: String, default: 'SORTEIO' } });
const ConfigSchema = new mongoose.Schema({ idsAtivos: [String], metaDia: { type: Number, default: 50 }, patrocinadores: { type: String, default: "" }, leilaoAtivo: { type: Boolean, default: false }, leilaoProduto: { type: String, default: "COMBO PREMIUM" }, leilaoPrecoAtual: { type: Number, default: 150 }, leilaoMinutos: { type: Number, default: 5 }, leilaoFim: { type: Date }, desafioMesasAtivo: { type: Boolean, default: false }, metaDesafioMesas: { type: Number, default: 30 }, premioDesafioMesas: { type: String, default: "RODADA DE SHOTS" } });
const AuditLogSchema = new mongoose.Schema({ timestamp: { type: Date, default: Date.now }, evento: String, loja: String, voucher: String, premio: String, ipCliente: String, detalhes: mongoose.Schema.Types.Mixed });
const TenantSchema = new mongoose.Schema({ usuario: { type: String, unique: true }, senhaHash: String, rede: String, lojasPermitidas: [String] });

const Campanha = mongoose.model('Campanha', CampanhaSchema);
const Venda = mongoose.model('Venda', VendaSchema);
const Config = mongoose.model('Config', ConfigSchema);
const AuditLog = mongoose.model('AuditLog', AuditLogSchema);
const Tenant = mongoose.model('Tenant', TenantSchema);

// --- SCHEMA NOVO: PESQUISA DE SATISFAÇÃO (MOGI SHOPPING / GERAL) ---
const PesquisaSchema = new mongoose.Schema({ 
    origem: { type: String, default: 'Mogi Shopping' },
    clienteNome: String, 
    clienteZap: String, 
    notaGeral: Number, 
    comentario: String,
    sentimento: String, 
    timestamp: { type: Date, default: Date.now }
});
const Pesquisa = mongoose.model('Pesquisa', PesquisaSchema);

let cacheCampanhas = []; let indicesLojas = {}; let campanhaAtivaPorLoja = {};

async function atualizarCache() {
    try {
        const config = await Config.findOne();
        if (config && config.idsAtivos?.length > 0) {
            cacheCampanhas = await Campanha.find({ _id: { $in: config.idsAtivos } });
        } else { cacheCampanhas = []; }
    } catch (e) { console.log("Erro Cache:", e); }
}

setInterval(async () => {
    if (cacheCampanhas.length === 0) return;
    try {
        const config = await Config.findOne().select('patrocinadores leilaoAtivo leilaoFim leilaoPrecoAtual');
        const campanhasVivas = await Campanha.find({ _id: { $in: cacheCampanhas.map(c => c._id) }, qtd: { $gt: 0 } });
        const porLoja = {};
        campanhasVivas.forEach(c => { if (!porLoja[c.loja]) porLoja[c.loja] = []; porLoja[c.loja].push(c); });

        if (config && config.leilaoAtivo && config.leilaoFim && new Date() >= config.leilaoFim) {
            await Config.updateOne({}, { $set: { leilaoAtivo: false } });
            io.emit('encerrar_leilao_tv');
        }

        for (const loja in porLoja) {
            const lista = porLoja[loja];
            if (indicesLojas[loja] === undefined) indicesLojas[loja] = 0;
            if (indicesLojas[loja] >= lista.length) indicesLojas[loja] = 0;

            const proximo = (indicesLojas[loja] + 1) % lista.length;
            io.to(loja).emit('pre_carregar_slide', { arquivo: lista[proximo].arquivo });
            
            setTimeout(() => {
                indicesLojas[loja] = proximo;
                const atual = lista[indicesLojas[loja]];
                campanhaAtivaPorLoja[loja] = atual._id.toString();
                io.to(loja).emit('trocar_slide', { ...atual._doc, patrocinadores: config?.patrocinadores || "" });
            }, 5000);
        }
    } catch (e) { console.log("Erro Loop TV:", e); }
}, 15000);

cron.schedule('0 8 * * *', async () => {
    const quinzeDiasAtras = new Date();
    quinzeDiasAtras.setDate(quinzeDiasAtras.getDate() - 15);
    const clientesParaResgatar = await Venda.find({
        timestamp: { $gte: new Date(quinzeDiasAtras.setHours(0,0,0,0)), $lt: new Date(quinzeDiasAtras.setHours(23,59,59,999)) },
        status: 'Usado',
        tipo: 'SORTEIO'
    });
    for (const venda of clientesParaResgatar) {
        const codigoSaudade = `SAUDADE-${Math.random().toString(36).substr(2,4).toUpperCase()}`;
        await new Venda({ 
            data: new Date().toLocaleDateString('pt-BR'), hora: new Date().toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' }),
            clienteNome: venda.clienteNome, clienteZap: venda.clienteZap, codigo: codigoSaudade, premio: "BRINDE ESPECIAL", status: 'Emitido', localizacao: venda.localizacao, tipo: 'SAUDADE' 
        }).save();
        const msg = `Olá ${venda.clienteNome}! Sentimos sua falta na rede WEGO. Use o código ${codigoSaudade} para resgatar um brinde especial na sua próxima visita!`;
        await dispararWhatsApp(venda.clienteZap, msg);
        await new Promise(r => setTimeout(r, 5000));
    }
});

app.post('/api/parceiro/sincronizar-estoque', authApi, async (req, res) => {
    try {
        const { loja, qtd } = req.body;
        await Campanha.updateOne({ loja: loja }, { $set: { qtd: qtd } });
        await atualizarCache();
        res.status(200).json({ status: "ok", msg: "Estoque atualizado" });
    } catch (e) { res.status(500).json({ error: "Falha na sincronização" }); }
});

// --- API NOVA: RECEBER PESQUISAS DO MOBILE ---
app.post('/api/pesquisa/salvar', async (req, res) => {
    try {
        const { origem, clienteNome, clienteZap, nota, comentario } = req.body;
        
        let sentimento = 'Neutro';
        if (nota >= 4) sentimento = 'Positivo';
        if (nota <= 2) sentimento = 'Critico';

        await new Pesquisa({
            origem: origem || 'Mogi Shopping',
            clienteNome,
            clienteZap,
            notaGeral: parseInt(nota),
            comentario,
            sentimento
        }).save();

        res.status(200).json({ status: "ok", msg: "Pesquisa salva com sucesso" });
    } catch (e) { 
        res.status(500).json({ error: "Falha ao salvar pesquisa" }); 
    }
});

app.get('/health', (req, res) => {
    if (mongoose.connection.readyState === 1) return res.status(200).json({ status: "UP", database: "CONNECTED", timestamp: new Date() });
    res.status(500).json({ status: "DOWN", database: "DISCONNECTED", timestamp: new Date() });
});

app.get('/qrcode', async (req, res) => {
    try {
        const urlMobile = `https://${req.get('host')}/mobile?l=${req.query.loc || 'Geral'}`;
        const qrBuffer = await QRCode.toBuffer(urlMobile, { width: 400, color: { dark: '#003399', light: '#ffffff' } });
        res.type('image/png').send(qrBuffer);
    } catch (err) { res.status(500).send("Erro QR"); }
});

app.get('/', (req, res) => res.redirect('/tv'));
app.get('/tv', (req, res) => res.sendFile(path.join(__dirname, 'public', 'publictv.html')));
app.get('/mobile', (req, res) => res.sendFile(path.join(__dirname, 'public', 'mobile.html')));

app.get('/caixa', auth, (req, res) => {
    res.send(`<!DOCTYPE html><html lang="pt-br"><head><meta charset="UTF-8"><title>Caixa WEGO</title><style>body{font-family:sans-serif;background:#003399;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}.box{background:#fff;padding:30px;border-radius:25px;text-align:center;width:320px}input{width:100%;padding:15px;margin:10px 0;border-radius:10px;border:1px solid #ddd;box-sizing:border-box}button{width:100%;padding:15px;background:#28a745;color:#fff;border:none;border-radius:10px;font-weight:bold;cursor:pointer}</style></head><body><div class="box"><h2>📟 CAIXA WEGO</h2><input type="text" id="v" placeholder="Vendedor"><input type="text" id="c" placeholder="Código VOUCHER"><button onclick="validar()">CONFERIR</button><div id="r" style="margin-top:15px; font-weight:bold"></div></div><script src="/socket.io/socket.io.js"></script><script>const s=io();function validar(){s.emit('validar_cupom',{codigo:document.getElementById('c').value.toUpperCase(),vendedor:document.getElementById('v').value})}s.on('resultado_validacao',d=>{const r=document.getElementById('r');r.innerText=d.msg;r.style.color=d.sucesso?'green':'red'})</script></body></html>`);
});

app.get('/login', (req, res) => {
    res.send(`<!DOCTYPE html><html><head><style>body{font-family:sans-serif;background:#0a0e17;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}.card{background:#fff;padding:40px;border-radius:30px;width:320px;text-align:center}input{width:100%;padding:15px;margin-bottom:15px;border-radius:12px;border:1px solid #ddd;box-sizing:border-box}button{width:100%;padding:15px;background:#003399;color:#fff;border:none;border-radius:12px;font-weight:bold;cursor:pointer}</style></head><body><div class="card"><h2>🔒 Acesso WEGO</h2><form action="/login" method="POST"><input type="text" name="user" placeholder="admin" required><input type="password" name="pass" placeholder="Senha" required><button type="submit">ENTRAR</button></form></div></body></html>`);
});

app.post('/login', async (req, res) => {
    const { user, pass } = req.body;
    const cookieOptions = { maxAge: 43200000, httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'Strict' };

    if (user === 'admin' && pass === ADMIN_PASS) {
        const token = jwt.sign({ isAdmin: true }, JWT_SECRET, { expiresIn: '12h' });
        res.cookie('auth_token', token, cookieOptions);
        return res.redirect('/admin');
    }
    
    const tenant = await Tenant.findOne({ usuario: user, senhaHash: pass });
    if (tenant) {
        const token = jwt.sign({ id: tenant._id, isAdmin: false }, JWT_SECRET, { expiresIn: '12h' });
        res.cookie('auth_token', token, cookieOptions);
        return res.redirect('/admin');
    }
    
    res.send("<script>alert('Erro de acesso');window.location='/login';</script>");
});

app.get('/logout', (req, res) => { res.clearCookie('auth_token'); res.redirect('/login'); });

app.get('/admin', auth, async (req, res) => {
    const { dataInicio, dataFim, lojaFiltro } = req.query;
    let query = {};
    if (dataInicio && dataFim) query.timestamp = { $gte: new Date(dataInicio + "T00:00:00"), $lte: new Date(dataFim + "T23:59:59") };
    if (lojaFiltro) query.localizacao = lojaFiltro;
    if (!req.usuario.isAdmin) query.localizacao = { $in: req.usuario.lojas };

    const vendas = await Venda.find(query).sort({ timestamp: -1 });
    const todasLojasUnicas = await Venda.distinct('localizacao', !req.usuario.isAdmin ? { localizacao: { $in: req.usuario.lojas } } : {});
    const todasVendas = await Venda.find(!req.usuario.isAdmin ? { localizacao: { $in: req.usuario.lojas } } : {});
    const config = await Config.findOne() || { metaDia: 50 };
    
    const total = vendas.length, usados = vendas.filter(v => v.status === 'Usado').length;
    const taxa = total > 0 ? ((usados/total)*100).toFixed(1) : 0;

    const rLojas = {}; const horasMap = {};
    vendas.forEach(v => {
        rLojas[v.localizacao] = (rLojas[v.localizacao] || 0) + 1;
        if(v.hora) { const h = v.hora.split(':')[0]; horasMap[h] = (horasMap[h] || 0) + 1; }
    });
    const melhorLoja = Object.entries(rLojas).sort((a,b) => b[1]-a[1])[0]?.[0] || "---";
    const horasOrdenadas = Object.entries(horasMap).sort((a,b) => b[1]-a[1]);
    const picoQuente = horasOrdenadas[horasOrdenadas.length-1]?.[0] || "--";
    const picoFrio = horasOrdenadas[0]?.[0] || "--";
    
    const iaInsightHTML = `<div style="background:rgba(56,189,248,0.1); border-left:4px solid #38bdf8; padding:15px; border-radius:15px; font-size:0.8rem; line-height:1.4"><b>🤖 IA INSIGHT:</b> No período analisado, a loja <b>${melhorLoja}</b> é a campeã de engajamento. O horário mais quente de conversão é às <b>${picoQuente}h</b>, enquanto às <b>${picoFrio}h</b> o fluxo diminui.</div>`;
    const rankingLojasHTML = Object.entries(rLojas).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([loja,qtd], i) => `<div style="display:flex;justify-content:space-between;padding:10px;margin-bottom:8px;background:rgba(255,255,255,0.03);border-radius:12px;border-left:4px solid #22c55e"><span style="font-weight:700; font-size:0.75rem">${i+1}º ${loja.toUpperCase()}</span><b>${qtd}</b></div>`).join('');
    const rVend = {};
    vendas.filter(v => v.vendedor && v.status === 'Usado').forEach(v => { rVend[v.vendedor] = (rVend[v.vendedor] || 0) + 1; });
    const rankingVendedoresHTML = Object.entries(rVend).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([nome,qtd], i) => `<div style="display:flex;justify-content:space-between;padding:10px;margin-bottom:8px;background:rgba(255,255,255,0.03);border-radius:12px;border-left:4px solid #38bdf8"><span style="font-weight:700; font-size:0.75rem">${i+1}º ${nome.toUpperCase()}</span><b>${qtd}</b></div>`).join('') || "---";

    const ultAtividade = await Venda.findOne(!req.usuario.isAdmin ? { localizacao: { $in: req.usuario.lojas } } : {}).sort({ timestamp: -1 });
    const minPassados = ultAtividade ? Math.floor((new Date() - ultAtividade.timestamp)/5000) : '--';
    const lojaUltima = ultAtividade ? ultAtividade.localizacao : '---';

    const ultimosSeteDias = [...Array(7)].map((_, i) => { 
        const d = new Date(); d.setDate(d.getDate() - i); return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    }).reverse();
    const dadosGrafico = ultimosSeteDias.map(label => todasVendas.filter(v => v.data === label).length);

    // BOTOES INCLUIDOS AQUI PARA O NOVO SISTEMA!
    res.send(`<!DOCTYPE html><html lang="pt-br"><head><meta charset="UTF-8"><title>WEGO BI</title><script src="https://cdn.jsdelivr.net/npm/chart.js"></script><style>@import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;700;900&display=swap');body { font-family: 'Montserrat', sans-serif; background: #0a0e17; color: #fff; margin: 0; padding: 15px; height: 100vh; overflow: hidden; display: flex; flex-direction: column; }.container { max-width: 1800px; margin: auto; width: 100%; flex: 1; display: flex; flex-direction: column; overflow: hidden; }.glass { background: rgba(255,255,255,0.02); backdrop-filter: blur(15px); border: 1px solid rgba(255,255,255,0.05); border-radius: 25px; padding: 15px; }.top-grid { display: grid; grid-template-columns: 280px 1fr 300px 300px; gap: 15px; margin-bottom: 15px; height: 320px; }.metrics-stack { display: flex; flex-direction: column; gap: 10px; }.card-metric { flex: 1; display: flex; flex-direction: column; justify-content: center; align-items: center; border-radius: 20px; border-left: 4px solid #38bdf8; }.card-metric h3 { font-size: 0.6rem; color: #94a3b8; text-transform: uppercase; margin: 0; letter-spacing: 2px; }.card-metric h2 { font-size: 2.2rem; margin: 5px 0; font-weight: 900; }.ranking-title { font-size: 0.65rem; color: #94a3b8; text-transform: uppercase; margin-bottom: 15px; font-weight: 900; letter-spacing: 1px; }.table-area { flex: 1; overflow-y: auto; scrollbar-width: thin; scrollbar-color: #38bdf8 #0a0e17; }table { width: 100%; border-collapse: collapse; }th { text-align: left; padding: 15px; font-size: 0.7rem; color: #94a3b8; text-transform: uppercase; border-bottom: 2px solid rgba(255,255,255,0.05); }td { padding: 15px; font-size: 0.85rem; border-bottom: 1px solid rgba(255,255,255,0.02); }.btn-top { padding: 10px 20px; border-radius: 12px; font-weight: 700; cursor: pointer; text-decoration: none; font-size: 0.75rem; border: none; transition: 0.3s; }input, select { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 8px; border-radius: 10px; font-size: 0.75rem; }.help-box { background: #143a24; border: 2px solid #F59E0B; padding: 15px; border-radius: 12px; margin-bottom: 15px; display: none; border-left: 8px solid #F59E0B; }.help-box ul { padding-left: 20px; font-size: 0.85rem; color: #cbd5e1; }.btn-help { background: #F59E0B; color: #000; border: none; padding: 5px 12px; border-radius: 8px; cursor: pointer; font-size: 0.75rem; font-weight: bold; transition: 0.3s; }.btn-help:hover { transform: scale(1.05); }.btn-help-blue { background: #38bdf8; border-color: #38bdf8; color: #000; }</style></head><body><div class="container"><div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px"><div style="display:flex; gap:15px; align-items:center;"><h1 style="margin:0; font-size:1.6rem; font-weight:900">WEGO <span style="color:#38bdf8">BI</span> <span style="font-size:0.8rem; color:#94a3b8;">(${req.usuario.rede})</span></h1><button type="button" class="btn-help btn-help-blue" onclick="document.getElementById('guia_gamificacao_bi').style.display='block'">🎮 MANUAL DE GAMIFICAÇÃO</button></div><form style="display:flex; gap:10px; align-items:center;"><select name="lojaFiltro" style="color:#22c55e; font-weight:bold; background:#161b22; border:1px solid #334155; border-radius:10px; padding:8px;"><option value="" style="color:#fff">Todas Lojas</option>${todasLojasUnicas.map(l => `<option value="${l}" ${lojaFiltro===l?'selected':''} style="color:#fff">${l}</option>`).join('')}</select><input type="date" name="dataInicio" value="${dataInicio || ''}"><input type="date" name="dataFim" value="${dataFim || ''}"><button type="submit" class="btn-top" style="background:#38bdf8; color:#000">FILTRAR</button></form><div style="display:flex; gap:10px; align-items:center"><form action="/admin/lgpd-excluir" method="POST" style="display:flex; gap:10px; align-items:center; background:rgba(220,38,38,0.1); padding:5px 10px; border-radius:10px; border:1px solid #dc2626;"><span style="font-size:0.6rem; font-weight:bold; color:#ef4444;">⚖️ APAGAR LGPD:</span><input type="text" name="telefoneCliente" placeholder="Whatsapp exato..." required style="width:110px; padding:6px; background:#161b22; border:1px solid #dc2626; color:#fff; font-size:0.7rem;"><button type="submit" class="btn-top" style="background:#dc2626; color:#fff; padding:6px 12px; font-size:0.7rem;" onclick="return confirm('ATENÇÃO: Os dados do cliente serão apagados permanentemente e um log de auditoria será gerado. Deseja prosseguir?')">APAGAR DADOS</button></form><a href="/admin/exportar" class="btn-top" style="background:#10b981; color:#fff">📥 EXCEL</a><a href="/pesquisa-mogi.html" target="_blank" class="btn-top" style="background:#8b5cf6; color:#fff">📋 EDITAR PESQUISA</a><a href="/admin/pesquisas" class="btn-top" style="background:#f59e0b; color:#fff">📊 AUDITORIA NPS</a></div></div><div id="guia_gamificacao_bi" class="help-box" style="border-left-color: #38bdf8; background: #0f172a;"><div style="display:flex; justify-content:space-between; margin-bottom:10px"><strong style="color:#38bdf8; font-size: 1.1rem;">📘 MANUAL OPERACIONAL WEGO: MOTORES DE GAMIFICAÇÃO AVANÇADA</strong><span onclick="this.parentElement.parentElement.style.display='none'" style="cursor:pointer; font-weight:bold; font-size:1.2rem; color:#fff;">✕</span></div><p style="font-size: 0.85rem; color: #94a3b8; margin-top: 0; line-height: 1.4;">Este manual detalha o funcionamento das 3 principais ferramentas de engajamento em massa do sistema.</p><ul style="margin-top: 10px; color: #cbd5e1; font-size: 0.85rem; line-height: 1.6;"><li><strong style="color: #F59E0B;">📉 1. O Leilão Reverso:</strong> A cada cliente que escaneia o QR Code, o preço cai R$ 1,00 ao vivo.<br><span style="color:#94a3b8"><i>Estratégia:</i> Faça isso no horário de maior pico.</span></li><li><strong style="color: #22c55e;">⚔️ 2. Desafio de Setores / Mesa vs. Mesa:</strong> O sistema cria uma corrida onde diferentes mesas competem.<br><span style="color:#94a3b8"><i>Como Funciona:</i> Na TV da Mesa 4 acesse <code>.../tv?loc=MESA_4</code>. O primeiro setor que atingir a meta ganha na hora!</span></li><li><strong style="color: #c084fc;">👻 3. O Fantasma da Madrugada:</strong> Uma dinâmica secreta exclusivamente entre as 23h e 01h da manhã. O prêmio OURO invoca o fantasma.<br><span style="color:#94a3b8"><i>Estratégia:</i> Segura o público no bar quando o movimento esfria.</span></li></ul></div><div class="top-grid"><div class="metrics-stack"><div class="glass card-metric" style="border-left-color:#38bdf8"><h3>Leads</h3><h2 style="color:#38bdf8">${total}</h2></div><div class="glass card-metric" style="border-left-color:#22c55e"><h3>Conversão</h3><h2 style="color:#22c55e">${taxa}%</h2></div><div class="glass card-metric" style="border-left-color:#f59e0b"><h3>Meta</h3><h2 style="color:#fcd34d">${usados}/${config.metaDia}</h2></div></div><div class="glass" style="display:flex; flex-direction:column; gap:10px">${iaInsightHTML}<div style="flex:1"><canvas id="g1"></canvas></div></div><div class="glass"><div class="ranking-title">🏪 Ranking Lojas</div><div style="overflow-y:auto; max-height:240px">${rankingLojasHTML}</div></div><div class="glass"><div class="ranking-title">🏆 Vendedores</div><div style="overflow-y:auto; max-height:240px">${rankingVendedoresHTML}</div></div></div><div class="glass table-area"><table><thead><tr><th>DATA</th><th>CLIENTE</th><th>WHATSAPP</th><th>LOJA / TOTEM</th><th>VOUCHER</th><th>PRÊMIO</th><th>STATUS</th></tr></thead><tbody>${vendas.map(v => `<tr><td>${v.data}<br><small style="opacity:0.5">${v.hora||''}</small></td><td style="font-weight:700">${v.clienteNome}</td><td style="color:#94a3b8;font-size:0.8rem">${v.clienteZap||'---'}</td><td style="color:#22c55e;font-size:0.75rem;font-weight:bold">${v.localizacao}</td><td style="color:#fcd34d;font-family:monospace;font-weight:700">${v.codigo}</td><td>${v.premio}</td><td><span style="background:${v.status==='Usado'?'#155724':'#7c2d12'};padding:4px 10px;border-radius:8px;font-size:0.7rem">${v.status}</span></td></tr>`).join('')}</tbody></table></div></div><script>new Chart(document.getElementById('g1'),{ type:'line', data:{ labels:${JSON.stringify(ultimosSeteDias)}, datasets:[{ label:'Leads', data:${JSON.stringify(dadosGrafico)}, borderColor:'#38bdf8', borderWidth:3, tension:0.4, fill:true, backgroundColor:'rgba(56,189,248,0.05)' }] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{ y:{grid:{color:'rgba(255,255,255,0.03)'}}, x:{grid:{display:false}} } } });</script></body></html>`);
});

// --- ROTA NOVA: DASHBOARD DE AUDITORIA DE PESQUISAS ---
app.get('/admin/pesquisas', auth, async (req, res) => {
    const pesquisas = await Pesquisa.find().sort({ timestamp: -1 });
    
    const total = pesquisas.length;
    let somaNotas = 0;
    let promotores = 0;
    let detratores = 0; 
    
    pesquisas.forEach(p => {
        somaNotas += p.notaGeral;
        if (p.notaGeral >= 4) promotores++;
        if (p.notaGeral <= 2) detratores++;
    });

    const mediaGeral = total > 0 ? (somaNotas / total).toFixed(1) : 0;
    const nps = total > 0 ? (((promotores - detratores) / total) * 100).toFixed(0) : 0;

    const feedHtml = pesquisas.map(p => {
        let corBorda = p.sentimento === 'Positivo' ? '#22c55e' : (p.sentimento === 'Critico' ? '#ef4444' : '#f59e0b');
        let dataFormatada = new Date(p.timestamp).toLocaleDateString('pt-BR') + ' ' + new Date(p.timestamp).toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
        
        return `
        <div style="background:rgba(255,255,255,0.03); border-left:4px solid ${corBorda}; padding:15px; border-radius:12px; margin-bottom:10px;">
            <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
                <b style="color:#fff;">${p.clienteNome || 'Anônimo'}</b>
                <span style="color:#94a3b8; font-size:0.8rem;">${dataFormatada}</span>
            </div>
            <div style="display:flex; gap:10px; align-items:center; margin-bottom:8px;">
                <span style="background:${corBorda}; color:#fff; padding:3px 8px; border-radius:6px; font-size:0.75rem; font-weight:bold;">NOTA: ${p.notaGeral}</span>
                <span style="color:#38bdf8; font-size:0.75rem; font-weight:bold;">${p.origem}</span>
            </div>
            <p style="margin:0; font-size:0.9rem; color:#cbd5e1; font-style:${p.comentario ? 'normal' : 'italic'}">${p.comentario || 'Sem comentário por escrito.'}</p>
        </div>`;
    }).join('');

    res.send(`
    <!DOCTYPE html><html lang="pt-br"><head><meta charset="UTF-8"><title>Auditoria de Satisfação</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;700;900&display=swap');
        body { font-family: 'Montserrat', sans-serif; background: #0a0e17; color: #fff; margin: 0; padding: 20px; }
        .glass { background: rgba(255,255,255,0.02); backdrop-filter: blur(15px); border: 1px solid rgba(255,255,255,0.05); border-radius: 20px; padding: 20px; }
        .grid-topo { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 20px; }
        .metric { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
        .metric h3 { font-size: 0.8rem; color: #94a3b8; text-transform: uppercase; margin: 0; }
        .metric h2 { font-size: 2.5rem; margin: 5px 0; font-weight: 900; }
    </style></head><body>
        <div style="max-width: 1200px; margin: auto;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                <h1 style="margin:0; font-weight:900;">AUDITORIA <span style="color:#38bdf8">NPS</span></h1>
                <a href="/admin" style="background:#334155; color:#fff; padding:10px 20px; border-radius:10px; text-decoration:none; font-weight:bold;">Voltar ao WEGO BI</a>
            </div>

            <div class="grid-topo">
                <div class="glass metric" style="border-left: 4px solid #38bdf8;">
                    <h3>Total de Avaliações</h3>
                    <h2 style="color:#38bdf8;">${total}</h2>
                </div>
                <div class="glass metric" style="border-left: 4px solid #fcd34d;">
                    <h3>Média Geral (0-5)</h3>
                    <h2 style="color:#fcd34d;">${mediaGeral}</h2>
                </div>
                <div class="glass metric" style="border-left: 4px solid #22c55e;">
                    <h3>Promotores (Elogios)</h3>
                    <h2 style="color:#22c55e;">${promotores}</h2>
                </div>
                <div class="glass metric" style="border-left: 4px solid #ef4444;">
                    <h3>Detratores (Críticas)</h3>
                    <h2 style="color:#ef4444;">${detratores}</h2>
                </div>
            </div>

            <div class="glass" style="max-height: 60vh; overflow-y: auto;">
                <h3 style="color:#F59E0B; margin-top:0; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:10px;">Feed de Comentários</h3>
                ${total > 0 ? feedHtml : '<p style="color:#94a3b8;">Nenhuma avaliação registrada ainda.</p>'}
            </div>
        </div>
    </body></html>`);
});

app.get('/marketing', auth, async (req, res) => {
    let queryCampanha = {};
    if (!req.usuario.isAdmin) queryCampanha.loja = { $in: req.usuario.lojas };

    const campanhas = await Campanha.find(queryCampanha);
    const config = await Config.findOne() || { idsAtivos: [], metaDia: 50, patrocinadores: "" , leilaoAtivo: false, leilaoProduto: "COMBO PREMIUM", leilaoPrecoAtual: 150, leilaoMinutos: 5, desafioMesasAtivo: false, metaDesafioMesas: 30, premioDesafioMesas: "RODADA DE SHOTS" };
    
    const listaHtml = campanhas.map(c => {
        const ativo = config.idsAtivos.includes(c._id.toString());
        const isLiveUrl = c.arquivo && c.arquivo.startsWith('http') && !c.arquivo.includes('supabase');
        const isVideo = !isLiveUrl && (c.arquivo.includes('.mp4') || c.arquivo.includes('video/upload'));
        const chkTroll = c.trollAzaradoAtivo ? 'checked' : '';
        const chkFantasma = c.fantasmaMadrugadaAtivo ? 'checked' : '';
        const tipoInt = c.tipoInteracao || 'raspadinha';
        
        let visualThumb = `<img src="${c.arquivo}" class="img-thumb">`;
        if (isLiveUrl) visualThumb = `<div class="video-thumb" style="color:#38bdf8; font-size:12px; font-weight:bold;">📺 COPA</div>`;
        else if (isVideo) visualThumb = `<div class="video-thumb">🎥</div>`;

        return `
        <div class="vitrine-card ${ativo ? 'card-ativo' : ''}" id="card_${c._id}">
            <div class="card-header">
                <input type="checkbox" name="ativos" value="${c._id}" form="fAtivos" ${ativo ? 'checked' : ''}>
                <div class="thumb-container">${visualThumb}</div>
                <input type="text" id="loja_${c._id}" value="${c.loja}" class="mini-input title-input" oninput="this.value = this.value.toUpperCase().trim()">
                <div style="display:flex; gap:10px">
                    <button type="button" onclick="salvarIndividual('${c._id}')" class="btn-save-mini">💾</button>
                    <a href="/excluir_promo/${c._id}" onclick="return confirm('Excluir?')" class="btn-delete">🗑️</a>
                </div>
            </div>
            <div class="card-body">
                <div class="mini-group"><label>ESTOQUE</label><input type="number" id="qtd_${c._id}" value="${c.qtd}"></div>
                <div class="mini-group"><label>OURO</label><input type="text" id="ouro_${c._id}" value="${c.posicoesOuro}"></div>
                <div class="mini-group">
                    <label>TV</label>
                    <select id="orient_${c._id}">
                        <option value="H" ${c.orientacao === 'H' ? 'selected' : ''}>H</option>
                        <option value="V" ${c.orientacao === 'V' ? 'selected' : ''}>V</option>
                    </select>
                </div>
                <div class="mini-group">
                    <label>INTERAÇÃO MOBILE</label>
                    <select id="interacao_${c._id}">
                        <option value="raspadinha" ${tipoInt === 'raspadinha' ? 'selected' : ''}>Raspadinha</option>
                        <option value="roleta" ${tipoInt === 'roleta' ? 'selected' : ''}>Roleta</option>
                        <option value="caixa" ${tipoInt === 'caixa' ? 'selected' : ''}>Caixa Surpresa</option>
                    </select>
                </div>
                <div class="mini-group" style="grid-column: span 4; display:flex; gap:10px; background:rgba(0,0,0,0.2); padding:5px; border-radius:5px;">
                    <label style="display:flex; align-items:center; gap:5px; cursor:pointer;" title="Mostra alerta brincalhão na TV"><input type="checkbox" id="troll_${c._id}" ${chkTroll}> 🤡 Azarado</label>
                    <label style="display:flex; align-items:center; gap:5px; cursor:pointer;" title="Altera o visual do prêmio Ouro"><input type="checkbox" id="fantasma_${c._id}" ${chkFantasma}> 👻 Fantasma (23h-01h)</label>
                </div>
            </div>
            <div class="card-footer"><input type="text" id="p1_${c._id}" value="${c.premio1}" placeholder="Prêmio 1"><input type="text" id="p2_${c._id}" value="${c.premio2}" placeholder="Prêmio 2"></div>
        </div>`;
    }).join('');
    
    res.send(`
    <!DOCTYPE html>
    <html lang="pt-br">
    <head>
        <meta charset="UTF-8">
        <title>Marketing WEGO</title>
        <style>
            body { font-family: 'Segoe UI', sans-serif; background: #103823; color: #f8fafc; padding: 20px; margin: 0; height: 100vh; overflow: hidden; }
            .container { display: grid; grid-template-columns: 1fr 420px; gap: 20px; height: 90vh; max-width: 1600px; margin: auto; }
            .panel { background: #17462B; border-radius: 25px; padding: 25px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.05); }
            .scroll { flex: 1; overflow-y: auto; padding-right: 10px; }
            .vitrine-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; padding: 5px; }
            .vitrine-card { background: #141924; border-radius: 18px; padding: 12px; border: 2px solid #272E3F; transition: 0.3s; }
            .card-ativo { border-color: #F59E0B; background: #1e2533; }
            .card-header { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
            .thumb-container { width: 50px; height: 50px; border-radius: 10px; overflow: hidden; background: #000; flex-shrink: 0; display:flex; align-items:center; justify-content:center; }
            .video-thumb { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: linear-gradient(45deg,#0f172a,#1e293b); color: #F59E0B; font-size: 20px; }
            .img-thumb { width: 100%; height: 100%; object-fit: cover; }
            .mini-input { background: #272E3F; border: 1px solid #3A4456; color: #fff; border-radius: 6px; padding: 6px; font-size: 0.8rem; flex: 1; }
            .title-input { font-weight: bold; color: #F59E0B; }
            .card-body { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 8px; margin-bottom: 8px; }
            .mini-group label { display: block; font-size: 0.6rem; color: #94a3b8; margin-bottom: 3px; font-weight: bold; }
            .mini-group input[type="text"], .mini-group input[type="number"], .mini-group select { width: 100%; background: #272E3F; border: 1px solid #3A4456; color: #fff; border-radius: 5px; padding: 4px; font-size: 0.75rem; }
            .card-footer { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
            .card-footer input { background: #272E3F; border: 1px solid #3A4456; color: #fff; border-radius: 5px; padding: 5px; font-size: 0.7rem; }
            .btn-save-mini { background: #272E3F; border: 1px solid #F59E0B; color: #F59E0B; border-radius: 6px; cursor: pointer; padding: 4px 8px; font-size: 1rem; }
            h2 { color: #F59E0B; margin-top: 0; display: flex; align-items: center; gap: 10px; font-size: 1.4rem; }
            .label-row { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
            label { font-size: 0.75rem; font-weight: 900; color: #F59E0B; text-transform: uppercase; letter-spacing: 1px; }
            input[type="text"], input[type="number"], select, input[type="file"] { width: 100%; padding: 14px; background: #272E3F; border: 1px solid #3A4456; border-radius: 12px; color: #fff; margin-bottom: 18px; box-sizing: border-box; }
            .btn-main { width: 100%; padding: 18px; background: #10b981; color: #fff; border: none; border-radius: 15px; font-weight: bold; cursor: pointer; font-size: 1rem; transition: 0.3s; }
            .btn-gold { background: #F59E0B; color: #000; margin-top: 15px; }
            .help-box { background: #143a24; border: 2px solid #F59E0B; padding: 15px; border-radius: 12px; margin-bottom: 20px; display: none; border-left: 8px solid #F59E0B; }
            .help-box ul { padding-left: 20px; font-size: 0.85rem; color: #cbd5e1; }
            .btn-help { background: #F59E0B; color: #000; border: none; padding: 5px 12px; border-radius: 8px; cursor: pointer; font-size: 0.75rem; font-weight: bold; transition: 0.3s; }
            .btn-help:hover { transform: scale(1.05); }
            .btn-help-blue { background: #38bdf8; border-color: #38bdf8; color: #000; }
            .manual-content h3 { color: #F59E0B; margin-top: 15px; font-size: 1.1rem; }
            .manual-content h4 { color: #38bdf8; font-size: 0.9rem; margin-bottom: 5px; text-transform: uppercase; }
            .manual-content p { font-size: 0.85rem; color: #cbd5e1; line-height: 1.5; margin-top: 0; }
            .manual-content ul { margin-top: 5px; font-size: 0.85rem; color: #cbd5e1; line-height: 1.6; }
            .manual-content b { color: #fff; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="panel">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                    <h2>📁 Vitrine Digital TV</h2>
                    <button class="btn-help btn-help-blue" onclick="document.getElementById('guia_gamificacao').style.display='block'">🎮 COMO USAR A GAMIFICAÇÃO?</button>
                </div>
                
                <div id="guia_gamificacao" class="help-box" style="border-left-color: #38bdf8; background: #0f172a;">
                    <div style="display:flex; justify-content:space-between; margin-bottom:10px">
                        <strong style="color:#38bdf8; font-size: 1.1rem;">🔥 GUIA DOS MOTORES DE GAMIFICAÇÃO</strong>
                        <span onclick="this.parentElement.parentElement.style.display='none'" style="cursor:pointer; font-weight:bold; font-size:1.2rem; color:#fff;">✕</span>
                    </div>
                    <ul style="margin-top: 10px; color: #cbd5e1; font-size: 0.85rem; line-height: 1.6;">
                        <li><strong style="color: #F59E0B;">📉 1. Leilão Reverso:</strong> Dinâmica de escassez extrema e efeito manada. O sistema exibe um product no centro da TV. A cada cliente que escaneia o QR Code, o preço cai R$ 1,00 ao vivo.</li>
                        <li><strong style="color: #22c55e;">⚔️ 2. Desafio de Setores / Mesa vs. Mesa:</strong> Gamifica a rivalidade natural dos clientes. O sistema cria uma corrida onde diferentes mesas competem. Na TV da Mesa 4 acesse <code>.../tv?loc=MESA_4</code>.</li>
                        <li><strong style="color: #ef4444;">🤡 3. Imposto do Azarado:</strong> Quando marcado no card da campanha, a TV exibe um alerta brincalhão quando o cliente ganha apenas o prêmio comum.</li>
                        <li><strong style="color: #c084fc;">👻 4. O Fantasma da Madrugada:</strong> Dinâmica secreta entre as 23h e 01h. Os prêmios OURO mudam a TV para um alerta visual surpresa.</li>
                    </ul>
                </div>
                
                <div class="scroll">
                    <form action="/atualizar_ativos" id="fAtivos" method="POST">
                        <div style="display:grid; grid-template-columns: 1fr 2fr; gap:15px; margin-bottom:15px; background:rgba(0,0,0,0.2); padding:10px; border-radius:10px; border-left: 4px solid #38bdf8;">
                            <div><label>🎯 Meta Leads</label><input type="number" name="metaDia" value="${config.metaDia}"></div>
                            <div><label>🤝 Patrocinadores (Vírgula)</label><input type="text" name="patrocinadores" value="${config.patrocinadores}" placeholder="Marcas..."></div>
                        </div>
                        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px; margin-bottom:15px; background:rgba(245, 158, 11,0.1); padding:10px; border-radius:10px; border-left: 4px solid #F59E0B;">
                            <div>
                                <label><input type="checkbox" name="leilaoAtivo" value="true" ${config.leilaoAtivo ? 'checked' : ''}> Ativar Leilão TV</label>
                                <div style="display: flex; gap: 5px; margin-top: 5px;">
                                    <input type="text" name="leilaoProduto" value="${config.leilaoProduto}" placeholder="Produto" style="flex:2;">
                                    <input type="number" name="leilaoPrecoAtual" value="${config.leilaoPrecoAtual}" placeholder="R$" style="flex:1;">
                                    <input type="number" name="leilaoMinutos" value="${config.leilaoMinutos}" placeholder="Min." style="flex:1;">
                                </div>
                            </div>
                            <div>
                                <label><input type="checkbox" name="desafioMesasAtivo" value="true" ${config.desafioMesasAtivo ? 'checked' : ''}> Ativar Desafio Setores</label>
                                <div style="display: flex; gap: 5px; margin-top: 5px;">
                                    <input type="number" name="metaDesafioMesas" value="${config.metaDesafioMesas}" placeholder="Meta">
                                    <input type="text" name="premioDesafioMesas" value="${config.premioDesafioMesas}" placeholder="Prêmio (Ex: Shot)">
                                </div>
                            </div>
                        </div>
                        <div class="vitrine-grid">${listaHtml}</div>
                    </form>
                </div>
                <button type="submit" form="fAtivos" class="btn-main btn-gold">🚀 ATUALIZAR FILA GERAL</button>
            </div>
            
            <div class="panel">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px">
                    <h2>➕ Nova Campanha</h2>
                    <button class="btn-help" onclick="document.getElementById('guia_marketing').style.display='block'">❓ MANUAL DO SISTEMA</button>
                </div>
                
                <div id="guia_marketing" class="help-box manual-content" style="max-height: 500px; overflow-y: auto;">
                    <div style="display:flex; justify-content:space-between; margin-bottom:10px; position: sticky; top: -15px; background: #143a24; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.1);">
                        <strong style="color:#F59E0B; font-size: 1.2rem;">📘 MANUAL OPERACIONAL: ECOSSISTEMA WEGO</strong>
                        <span onclick="this.parentElement.parentElement.style.display='none'" style="cursor:pointer; font-weight:bold; font-size:1.5rem; color:#fff;">✕</span>
                    </div>
                    <h4>Módulo 1: A Jornada do Cliente (Front-end: TV e Celular)</h4>
                    <ul>
                        <li><b>Atração (A Vitrine Digital):</b> A TV exibe campanhas e QR Code fixo ou dinâmico.</li>
                        <li><b>Captura (Escaneamento):</b> Cliente aponta a câmera e vai para a página mobile.</li>
                        <li><b>Cadastro (Lead & LGPD):</b> O cliente preenche Nome e WhatsApp (aceite automático LGPD).</li>
                        <li><b>A Interação (Gamificação):</b> Realiza a ação na tela (girar roleta).</li>
                        <li><b>A Vitória e o Clímax:</b> O celular exibe o prêmio ganho. A TV da loja exibe animação com o nome.</li>
                    </ul>
                </div>
                
                <div class="scroll">
                    <form action="/salvar_promo" method="POST" enctype="multipart/form-data">
                        <div class="label-row"><label>Título (CÓDIGO DA LOJA)</label></div>
                        <input type="text" name="loja" placeholder="Ex: VARANDA_01" required oninput="this.value = this.value.toUpperCase().trim()">
                        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                            <div><label>Cupons</label><input type="number" name="qtd" value="100"></div>
                            <div><label>Ouro</label><input type="text" name="posicoesOuro" placeholder="1, 10, 50"></div>
                        </div>
                        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                            <div><label>Prêmio 1</label><input type="text" name="premio1" value="5% OFF"></div>
                            <div><label>Prêmio 2</label><input type="text" name="premio2" value="BRINDE"></div>
                        </div>
                        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                            <div>
                                <label>Formato TV</label>
                                <select name="orientacao">
                                    <option value="H">Horizontal</option>
                                    <option value="V">Vertical</option>
                                </select>
                            </div>
                            <div>
                                <label>Interação Mobile</label>
                                <select name="tipoInteracao">
                                    <option value="raspadinha">Raspadinha Metálica</option>
                                    <option value="roleta">Roleta Cassino</option>
                                    <option value="caixa">Caixa Surpresa (Tap)</option>
                                </select>
                            </div>
                        </div>
                        
                        <div class="label-row"><label style="color:#38bdf8;">🔗 LINK TRANSMISSÃO AO VIVO (YOUTUBE COPA)</label></div>
                        <input type="text" name="youtubeLink" placeholder="Cole o link da Live se for passar jogo da Copa..." style="border: 1px solid #38bdf8; background: #132420;">
                        
                        <div class="label-row"><label>OU ARQUIVO FÍSICO (FOTO/VÍDEO)</label></div>
                        <input type="file" name="imagem" accept="image/*,video/*">
                        
                        <button type="submit" class="btn-main">💾 SALVAR CAMPANHA</button>
                    </form>
                </div>
            </div>
        </div>
        <script>
            function salvarIndividual(id){
                const data = {
                    id, loja: document.getElementById('loja_'+id).value,
                    qtd: document.getElementById('qtd_'+id).value, posicoesOuro: document.getElementById('ouro_'+id).value,
                    orientacao: document.getElementById('orient_'+id).value, premio1: document.getElementById('p1_'+id).value,
                    premio2: document.getElementById('p2_'+id).value, trollAzaradoAtivo: document.getElementById('troll_'+id).checked,
                    fantasmaMadrugadaAtivo: document.getElementById('fantasma_'+id).checked,
                    tipoInteracao: document.getElementById('interacao_'+id).value
                };
                fetch('/salvar_individual', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) }).then(()=>alert('Campanha Atualizada!'));
            }
        </script>
    </body>
    </html>
    `);
});

app.post('/salvar_individual', auth, async (req, res) => {
    try {
        const { id, loja, qtd, posicoesOuro, orientacao, premio1, premio2, trollAzaradoAtivo, fantasmaMadrugadaAtivo, tipoInteracao } = req.body;
        await Campanha.findByIdAndUpdate(id, { loja, qtd: parseInt(qtd), posicoesOuro, orientacao, premio1, premio2, contagemParticipantes: 0, trollAzaradoAtivo, fantasmaMadrugadaAtivo, tipoInteracao });
        await atualizarCache();
        res.sendStatus(200);
    } catch (e) { res.status(500).send("Erro"); }
});

app.post('/atualizar_ativos', auth, async (req, res) => {
    let ativos = req.body.ativos || []; 
    if (!Array.isArray(ativos)) ativos = [ativos];
    
    const minutos = parseInt(req.body.leilaoMinutos) || 5;
    const tempoFim = new Date(Date.now() + minutos * 60000);

    await Config.findOneAndUpdate({}, { 
        idsAtivos: ativos, metaDia: parseInt(req.body.metaDia) || 50, patrocinadores: req.body.patrocinadores || "",
        leilaoAtivo: req.body.leilaoAtivo === 'true', leilaoProduto: req.body.leilaoProduto || "COMBO PREMIUM",
        leilaoPrecoAtual: parseInt(req.body.leilaoPrecoAtual) || 150, leilaoMinutos: minutos,
        leilaoFim: req.body.leilaoAtivo === 'true' ? tempoFim : null,
        desafioMesasAtivo: req.body.desafioMesasAtivo === 'true', metaDesafioMesas: parseInt(req.body.metaDesafioMesas) || 30,
        premioDesafioMesas: req.body.premioDesafioMesas || "BRINDE DA CASA"
    }, { upsert: true });
    
    await atualizarCache();
    res.redirect('/marketing');
});

// --- UPLOAD PARA SUPABASE STORAGE ---
app.post('/salvar_promo', auth, upload.single('imagem'), async (req, res) => {
    try {
        let pathDestino = req.body.youtubeLink ? req.body.youtubeLink.trim() : '';
        
        if (req.file) {
            const extensao = path.extname(req.file.originalname);
            const fileName = `campanha_${Date.now().toString()}${extensao}`;
            const bucketName = process.env.SUPABASE_BUCKET || 'polipet_promos';
            
            const { data, error } = await supabase.storage
                .from(bucketName)
                .upload(fileName, req.file.buffer, {
                    contentType: req.file.mimetype,
                    upsert: true
                });
                
            if (error) {
                console.error("Erro Supabase Upload:", error);
                throw error;
            }
            
            const { data: publicUrlData } = supabase.storage
                .from(bucketName)
                .getPublicUrl(fileName);
                
            pathDestino = publicUrlData.publicUrl;
        }
        
        if (!pathDestino) {
            return res.send("<script>alert('Insira um link do YouTube ou selecione um arquivo físico!');window.history.back();</script>");
        }

        await new Campanha({
            loja: req.body.loja,
            orientacao: req.body.orientacao,
            arquivo: pathDestino,
            qtd: parseInt(req.body.qtd) || 100,
            premio1: req.body.premio1,
            premio2: req.body.premio2,
            posicoesOuro: req.body.posicoesOuro,
            tipoInteracao: req.body.tipoInteracao
        }).save();

        await atualizarCache();
        res.redirect('/marketing');
    } catch (err) {
        res.status(500).send("Erro ao salvar campanha");
    }
});

app.get('/excluir_promo/:id', auth, async (req, res) => { 
    await Campanha.findByIdAndDelete(req.params.id); 
    await atualizarCache(); 
    res.redirect('/marketing'); 
});

app.get('/admin/exportar', auth, async (req, res) => {
    const vends = await Venda.find(!req.usuario.isAdmin ? { localizacao: { $in: req.usuario.lojas } } : {}).sort({ timestamp: -1 });
    let csv = 'Data;Hora;Cliente;WhatsApp;Codigo;Premio;Vendedor;Localizacao;Status\n';
    vends.forEach(v => { csv += `${v.data};${v.hora||''};${v.clienteNome};${v.clienteZap||''};${v.codigo};${v.premio};${v.vendedor||''};${v.localizacao};${v.status}\n`; });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=relatorio_wego.csv');
    res.send('\uFEFF' + csv);
});

// ============================================================================
// --- LÓGICA CORE (SOCKET.IO COM GAMIFICAÇÃO E PRODUTOS DO LEILÃO) ---
// ============================================================================
io.on('connection', (socket) => {
    socket.on('join', (loja) => { socket.join(loja); });
    socket.on('cliente_girando', (d) => { io.to(d.loc).emit('cliente_girando', { nome: d.nome }); });
    
    socket.on('resgatar_oferta', async (dados) => {
        try {
            const lojaDoCliente = dados.loc || 'Geral';
            const idCampanhaAtiva = campanhaAtivaPorLoja[lojaDoCliente];

            if (!idCampanhaAtiva) return socket.emit('erro', { msg: "Nenhuma campanha ativa." });

            const campanhaAtual = await Campanha.findOne({ _id: idCampanhaAtiva, qtd: { $gt: 0 } });
            
            if (campanhaAtual) {
                const c = await Campanha.findByIdAndUpdate(campanhaAtual._id, { $inc: { contagemParticipantes: 1, qtd: -1 } }, { new: true });
                io.to(lojaDoCliente).emit('trocar_slide', { ...c._doc, qtd: c.qtd });

                const ganhadoresOuro = c.posicoesOuro.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
                const ehOuro = ganhadoresOuro.includes(c.contagemParticipantes);
                const cod = `WEGO-${Math.random().toString(36).substr(2,4).toUpperCase()}`;
                
                const agora = new Date();
                const dataStringBI = agora.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
                const premioGanho = ehOuro ? c.premio2 : c.premio1;

                await new Venda({ 
                    data: dataStringBI, hora: agora.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit', hour12:false, timeZone: 'America/Sao_Paulo' }), 
                    clienteNome: dados.nome, clienteZap: dados.whatsapp, codigo: cod, premio: premioGanho, status: 'Emitido', localizacao: lojaDoCliente, timestamp: agora
                }).save();

                await new AuditLog({ evento: "SORTEIO_REALIZADO", loja: lojaDoCliente, voucher: cod, premio: premioGanho, ipCliente: socket.handshake.address, detalhes: { cliente: dados.nome, isOuro: ehOuro } }).save();

                const horaAtual = agora.getHours();
                if (c.trollAzaradoAtivo && !ehOuro) {
                    io.to(lojaDoCliente).emit('aviso_azarado_tv', { nome: dados.nome });
                }
                if (c.fantasmaMadrugadaAtivo && ehOuro && (horaAtual >= 23 || horaAtual <= 1)) {
                    io.to(lojaDoCliente).emit('aviso_fantasma_tv', { nome: dados.nome, premio: premioGanho });
                }

                const configGlobal = await Config.findOne();
                if (configGlobal) {
                    if (configGlobal.leilaoAtivo && configGlobal.leilaoFim && new Date() < configGlobal.leilaoFim && configGlobal.leilaoPrecoAtual > 0) {
                        configGlobal.leilaoPrecoAtual -= 1;
                        await configGlobal.save();
                        io.to(lojaDoCliente).emit('atualiza_leilao_tv', { preco: configGlobal.leilaoPrecoAtual, fim: configGlobal.leilaoFim, produto: configGlobal.leilaoProduto });
                    }
                    if (configGlobal.desafioMesasAtivo) {
                        const leadsSetor = await Venda.countDocuments({ localizacao: lojaDoCliente, data: dataStringBI });
                        io.to(lojaDoCliente).emit('atualiza_desafio_tv', { setor: lojaDoCliente, leads: leadsSetor, meta: configGlobal.metaDesafioMesas });
                        
                        if (leadsSetor === configGlobal.metaDesafioMesas) {
                            io.to(lojaDoCliente).emit('vencedor_desafio_tv', { setor: lojaDoCliente, premio: configGlobal.premioDesafioMesas });
                        }
                    }
                }

                const msgEnvio = `*WEGO*\nOlá ${dados.nome}!\nVocê ganhou: ${premioGanho}\nVoucher: ${cod}`;
                await dispararWhatsApp(dados.whatsapp, msgEnvio);

                socket.emit('sucesso', { codigo: cod, produto: premioGanho, nome: dados.nome, isOuro: ehOuro, tipoInteracao: c.tipoInteracao || 'raspadinha' });
            }
        } catch (err) { console.log("Erro sorteio:", err); }
    });

    socket.on('liberar_tv', async (dados) => { 
        try {
            io.to(dados.loja).emit('aviso_vitoria_tv', { nome: dados.nome, premio: dados.premio });
            await new AuditLog({ evento: "VITORIA_CONFIRMADA_TV", loja: dados.loja, premio: dados.premio, ipCliente: socket.handshake.address }).save();
            if (INTEGRACAO_CONFIG.ativa) console.log(`Notificando ERP do parceiro sobre a baixa de: ${dados.premio}`);
        } catch(e) { console.error("Erro ao liberar TV:", e); }
    });
    
    socket.on('validar_cupom', async (dados) => {
        const v = await Venda.findOne({ codigo: dados.codigo.toUpperCase().trim() });
        if (v && v.status !== 'Usado') { 
            v.status = 'Usado'; 
            v.vendedor = dados.vendedor; 
            await v.save(); 
            await new AuditLog({ evento: "CUPOM_VALIDADO", voucher: dados.codigo, loja: v.localizacao, ipCliente: socket.handshake.address, detalhes: { vendedor: dados.vendedor } }).save();
            const labelTipo = v.tipo === 'SAUDADE' ? "🎁 VOUCHER SAUDADE" : "✅ VÁLIDO";
            socket.emit('resultado_validacao', { sucesso: true, msg: `${labelTipo}: ` + v.premio }); 
        } else { 
            socket.emit('resultado_validacao', { sucesso: false, msg: v ? "❌ JÁ UTILIZADO" : "❌ INVÁLIDO" }); 
        }
    });
});

app.post('/admin/lgpd-excluir', auth, async (req, res) => {
    try {
        const { telefoneCliente } = req.body;
        if (!telefoneCliente) return res.send("<script>alert('Informe o telefone.');window.history.back();</script>");

        const exclusao = await Venda.updateMany({ clienteZap: telefoneCliente }, { $set: { clienteNome: "EXCLUIDO_LGPD", clienteZap: "EXCLUIDO_LGPD", ipCliente: "0.0.0.0" } });
        if (exclusao.modifiedCount === 0) return res.send("<script>alert('Nenhum dado encontrado para este cliente.');window.history.back();</script>");

        await new AuditLog({ evento: "EXCLUSAO_DADOS_LGPD", loja: req.usuario.isAdmin ? "SISTEMA_WEGO_MASTER" : req.usuario.rede, detalhes: { telefoneSolicitante: telefoneCliente, dataExata: new Date(), operador: req.usuario.isAdmin ? "Admin Master" : req.usuario.rede, registrosApagados: exclusao.modifiedCount } }).save();
        res.send("<script>alert('Dados do cliente excluídos com sucesso!');window.history.back();</script>");
    } catch (e) { res.send("<script>alert('Erro ao excluir dados.');window.history.back();</script>"); }
});

setInterval(async () => {
    try {
        const limiteTempo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
        await Venda.updateMany({ timestamp: { $lt: limiteTempo }, clienteNome: { $nin: ["ANONIMIZADO_LGPD", "EXCLUIDO_LGPD"] } }, { $set: { clienteNome: "ANONIMIZADO_LGPD", clienteZap: "ANONIMIZADO_LGPD", ipCliente: "0.0.0.0" } });
    } catch (e) { console.error("Erro na rotina LGPD:", e); }
}, 86400000); 

server.listen(process.env.PORT || 10000, '0.0.0.0');
