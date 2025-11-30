const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(__dirname));
app.use(express.static('public'));

// --- CONFIGURAÇÃO AVANÇADA (COM BANCO DE DADOS & INTELIGÊNCIA) ---
let campanhas = [
    // SLIDE 0: Café + Salgado (Laranja)
    { 
        id: 0, 
        tipo: 'foto', 
        arquivo: "slide1.jpg", 
        nome: "Café + Salgado", 
        qtd: 20, 
        ativa: true, 
        corPrincipal: '#F37021', // Laranja AMPM
        corSecundaria: '#663300', 
        prefixo: 'CAFE',
        // DADOS DE INTELIGÊNCIA
        totalResgates: 0,
        resgatesPorHora: new Array(24).fill(0),
        ultimoCupom: "Nenhum",
        ultimaHora: "--:--"
    },
    // SLIDE 1: Bebidas (Azul)
    { 
        id: 1, 
        tipo: 'foto', 
        arquivo: "slide2.jpg", 
        nome: "Bebidas Geladas",   
        qtd: 30, 
        ativa: true, 
        corPrincipal: '#003399', // Azul Escuro
        corSecundaria: '#0055aa', 
        prefixo: 'BEBIDA',
        totalResgates: 0,
        resgatesPorHora: new Array(24).fill(0),
        ultimoCupom: "Nenhum",
        ultimaHora: "--:--"
    },
    // SLIDE 2: Posto Ipiranga (Amarelo)
    { 
        id: 2, 
        tipo: 'foto', 
        arquivo: "slide3.jpg", 
        nome: "Abasteça com Desconto",        
        qtd: 10, 
        ativa: true, 
        corPrincipal: '#FFCC00', // Amarelo Ipiranga
        corSecundaria: '#003399', 
        prefixo: 'POSTO',
        totalResgates: 0,
        resgatesPorHora: new Array(24).fill(0),
        ultimoCupom: "Nenhum",
        ultimaHora: "--:--"
    }
];

let slideAtual = 0;

// --- ROTAÇÃO AUTOMÁTICA (15 SEGUNDOS) ---
setInterval(() => {
    slideAtual++;
    if (slideAtual >= campanhas.length) slideAtual = 0;
    io.emit('trocar_slide', campanhas[slideAtual]);
}, 15000);

function gerarCodigo(prefixo) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let result = '';
    for (let i = 0; i < 4; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    return `${prefixo}-${result}`;
}

// --- FUNÇÃO PARA CALCULAR O PICO ---
function getHoraPico(arrayHoras) {
    let max = 0;
    let hora = 0;
    for(let i=0; i<24; i++) {
        if(arrayHoras[i] > max) {
            max = arrayHoras[i];
            hora = i;
        }
    }
    if (max === 0) return "Sem dados";
    return `${hora}:00h (${max} un)`;
}

// --- HTML DA TV ---
const htmlTV = `
<!DOCTYPE html>
<html>
<head><title>TV AMPM</title></head>
<body style="margin:0; background:black; overflow:hidden; font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; transition: background 0.5s;">
    <div style="display:flex; height:100vh;">
        <div style="flex:3; background:#ccc; display:flex; align-items:center; justify-content:center; overflow:hidden;" id="bgEsq">
            <img id="imgDisplay" src="" style="width:100%; height:100%; object-fit:contain; display:none;">
            <video id="vidDisplay" src="" style="width:100%; height:100%; object-fit:contain; display:none;" muted playsinline></video>
        </div>
        <div style="flex:1; background:#003399; display:flex; flex-direction:column; align-items:center; justify-content:center; border-left:6px solid #FFCC00; text-align:center; color:white;" id="bgDir">
            <img src="logo.png" onerror="this.style.display='none'" style="width:160px; background:white; padding:15px; border-radius:15px; margin-bottom:30px; box-shadow: 0 5px 15px rgba(0,0,0,0.3);">
            <h1 id="nomeProd" style="font-size:2.2rem; padding:0 10px; line-height:1.1; text-transform:uppercase; font-weight:800; text-shadow: 2px 2px 4px rgba(0,0,0,0.5);">...</h1>
            <div style="background:white; padding:10px; border-radius:10px; margin-top:20px;">
                <img id="qr" src="qrcode.png" style="width:200px; display:block;" onerror="this.onerror=null; fetch('/qrcode').then(r=>r.text()).then(u=>this.src=u);">
            </div>
            <p style="margin-top:10px; font-weight:bold; font-size:1.2rem; color:#FFCC00;">ESCANEIE PARA GANHAR</p>
            <div style="margin-top:30px; border-top:2px dashed rgba(255,255,255,0.3); width:80%; padding-top:20px;">
                <span style="font-size:1.2rem; font-weight:bold;">RESTAM APENAS:</span><br>
                <span id="num" style="font-size:6rem; color:#FFCC00; font-weight:900; line-height:1;">--</span>
            </div>
        </div>
    </div>
    <script src="/socket.io/socket.io.js"></script>
    <script>
        const socket = io();
        const imgTag = document.getElementById('imgDisplay');
        const vidTag = document.getElementById('vidDisplay');
        socket.on('trocar_slide', (d) => { actualizarTela(d); });
        socket.on('atualizar_qtd', (d) => {
            if(document.getElementById('nomeProd').innerText === d.nome) {
                document.getElementById('num').innerText = d.qtd;
            }
        });
        function actualizarTela(d) {
            document.getElementById('nomeProd').innerText = d.nome;
            document.getElementById('num').innerText = d.qtd;
            document.getElementById('bgDir').style.background = d.corPrincipal;
            document.getElementById('bgEsq').style.background = d.corSecundaria;
            
            // Texto Escuro se o fundo for Dourado/Amarelo, senão Branco
            const corTexto = (d.corPrincipal === '#FFCC00' || d.corPrincipal === '#FFD700') ? '#003399' : '#FFCC00';
            document.getElementById('num').style.color = corTexto;
            
            if (d.tipo === 'video') {
                imgTag.style.display = 'none'; vidTag.style.display = 'block'; vidTag.src = d.arquivo; vidTag.play().catch(e => console.log(e));
            } else {
                vidTag.pause(); vidTag.style.display = 'none'; imgTag.style.display = 'block'; imgTag.src = d.arquivo;
            }
        }
    </script>
</body>
</html>
`;

// --- HTML MOBILE ---
const htmlMobile = `
<!DOCTYPE html>
<html>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; text-align:center; padding:20px; background:#f0f2f5; margin:0; }
    .btn-pegar { width:100%; padding:20px; color:white; border:none; border-radius:10px; font-size:20px; margin-top:20px; font-weight:bold; text-transform:uppercase; box-shadow: 0 4px 10px rgba(0,0,0,0.2); transition: transform 0.2s; }
    .btn-pegar:active { transform: scale(0.98); }
    .img-prod { width:100%; max-width:300px; border-radius:10px; margin-bottom:15px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
    .ticket-paper { background: #fff; padding: 0; margin-top: 20px; box-shadow: 0 5px 15px rgba(0,0,0,0.1); position: relative; overflow: hidden; border-top: 10px solid #F37021; }
    .ticket-body { padding: 25px; text-align: center; }
    .ticket-header { font-size: 14px; color: #666; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 5px; }
    .ticket-offer { font-size: 24px; font-weight: 900; color: #333; margin: 5px 0; }
    .codigo-box { background: #f8f9fa; border: 2px dashed #ccc; padding: 15px; margin: 20px 0; border-radius: 4px; }
    .codigo-texto { font-size: 32px; font-weight: bold; letter-spacing: 2px; margin:0; font-family: 'Courier New', monospace; }
    .serrilhado { height: 10px; width: 100%; background-image: radial-gradient(circle, #f0f2f5 50%, transparent 50%); background-size: 20px 20px; background-position: bottom; margin-top: -10px; }
    .no-print { display: block; }
    @media print { .no-print { display:none; } body { background:white; padding:0; } .ticket-paper { box-shadow:none; border:1px solid #ccc; } }
</style>
<body>
    <div id="telaPegar">
        <h3 style="color:#555; text-transform:uppercase; font-size:14px; letter-spacing:1px;">Oferta Disponível:</h3>
        <img id="fotoM" src="" class="midia-prod" style="display:none;">
        <video id="vidM" src="" class="midia-prod" style="display:none;" muted playsinline autoplay loop></video>
        <h2 id="nomeM" style="color:#003399; margin:10px 0; font-weight:800;">...</h2>
        <div style="background:white; padding:15px; border-radius:8px; display:inline-block; box-shadow: 0 2px 5px rgba(0,0,0,0.05);">
            <span style="color:#666; font-size:12px;">ESTOQUE</span><br><strong id="qtdM" style="font-size:24px; color:#333;">--</strong>
        </div>
        <button onclick="resgatar()" id="btnResgatar" class="btn-pegar">RESGATAR CUPOM</button>
    </div>
    <div id="telaVoucher" style="display:none;">
        <h2 class="no-print" style="color:#003399;">SUCESSO! 🎉</h2>
        <div class="ticket-paper" id="ticketContainer">
            <div class="ticket-body">
                <img src="logo.png" width="100" style="margin-bottom:15px;" onerror="this.style.display='none'">
                <p class="ticket-header">Voucher Promocional</p>
                <h1 id="voucherNome" class="ticket-offer">...</h1>
                <div class="codigo-box" id="codBox">
                    <p style="font-size:10px; margin:0; color:#999; text-transform:uppercase;">Código de Autorização</p>
                    <div class="codigo-texto" id="codGerado">...</div>
                </div>
                <p style="font-size:12px; color:#555;">Emitido em: <span id="dataHora" style="font-weight:bold;"></span><br><span style="color:#F37021; font-weight:bold;">Válido apenas hoje nesta unidade.</span></p>
            </div>
            <div class="serrilhado"></div>
        </div>
        <button onclick="window.print()" class="btn-pegar no-print" style="background:#333; margin-top:30px;">🖨️ IMPRIMIR / SALVAR</button>
    </div>
    <script src="/socket.io/socket.io.js"></script>
    <script>
        const socket = io();
        let ofertaAtual = null;
        socket.on('trocar_slide', (d) => {
            ofertaAtual = d;
            const imgTag = document.getElementById('fotoM'); const vidTag = document.getElementById('vidM');
            if (d.tipo === 'video') { imgTag.style.display = 'none'; vidTag.style.display = 'block'; vidTag.src = d.arquivo; } 
            else { vidTag.style.display = 'none'; imgTag.style.display = 'block'; imgTag.src = d.arquivo; }
            document.getElementById('nomeM').innerText = d.nome;
            document.getElementById('qtdM').innerText = d.qtd;
            
            // Botão muda de cor e texto se for claro
            document.getElementById('btnResgatar').style.background = d.corPrincipal;
            if(d.corPrincipal === '#FFD700' || d.corPrincipal === '#FFCC00') {
                 document.getElementById('btnResgatar').style.color = '#003399';
            } else {
                 document.getElementById('btnResgatar').style.color = 'white';
            }
        });
        socket.emit('pedir_atualizacao');
        function resgatar() { if(ofertaAtual) socket.emit('resgatar_oferta', ofertaAtual.id); }
        socket.on('sucesso', (dados) => {
            document.getElementById('telaPegar').style.display='none';
            document.getElementById('telaVoucher').style.display='block';
            document.getElementById('voucherNome').innerText = dados.produto;
            document.getElementById('codGerado').innerText = dados.codigo;
            const agora = new Date();
            document.getElementById('dataHora').innerText = agora.toLocaleDateString('pt-BR') + ' às ' + agora.toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'});
            
            document.getElementById('ticketContainer').style.borderTopColor = dados.corPrincipal;
            document.getElementById('codGerado').style.color = dados.corPrincipal;
            document.getElementById('codBox').style.borderColor = dados.corPrincipal;
        });
    </script>
</body>
</html>
`;

// --- ADMIN COMPLETO (COM RELATÓRIO E BANCO DE DADOS) ---
const htmlAdmin = `
<!DOCTYPE html><html><meta name="viewport" content="width=device-width, initial-scale=1"><body style="font-family:Arial; padding:20px; background:#222; color:white;">
<h1>🎛️ Controle & Inteligência AMPM</h1><div id="paineis"></div><script src="/socket.io/socket.io.js"></script><script>const socket=io();socket.on('dados_admin',(lista)=>{const div=document.getElementById('paineis');div.innerHTML="";lista.forEach((c,index)=>{
let max=0;let hora=0;c.resgatesPorHora.forEach((q,h)=>{if(q>max){max=q;hora=h;}});const pico=max>0?hora+":00h ("+max+" un)":"Sem dados";
div.innerHTML+=\`<div style="background:#444; padding:15px; margin-bottom:15px; border-radius:10px; border-left: 8px solid \${c.ativa?'#0f0':'#f00'}"><h3 style="margin-top:0;">\${c.nome}</h3><div style="display:flex; gap:10px; align-items:center; background:#333; padding:10px; border-radius:5px; margin-bottom:10px;"><label>Estoque:</label><input id="qtd_\${index}" type="number" value="\${c.qtd}" style="width:60px; font-weight:bold;"><button onclick="salvar(\${index})" style="padding:5px 10px; background:#00cc00; color:white; border:none; cursor:pointer;">💾 Salvar</button></div><div style="background:#222; padding:10px; border-radius:5px; font-size:14px; color:#ccc;"><p style="margin:5px 0;">📈 <b>Total Resgatado:</b> <span style="color:#00ff00; font-size:18px;">\${c.totalResgates}</span></p><p style="margin:5px 0;">⏰ <b>Horário de Pico:</b> \${pico}</p><p style="margin:5px 0; border-top:1px solid #555; padding-top:5px;">🔍 <b>Último:</b> <span style="color:yellow;">\${c.ultimoCupom}</span> <small>(\${c.ultimaHora})</small></p></div></div>\`});});function salvar(id){const q=document.getElementById('qtd_'+id).value;socket.emit('admin_update',{id:id,qtd:q});alert('Atualizado!');}</script></body></html>
`;

// --- ROTAS ---
app.get('/tv', (req, res) => res.send(htmlTV));
app.get('/admin', (req, res) => res.send(htmlAdmin));
app.get('/mobile', (req, res) => res.send(htmlMobile));
app.get('/', (req, res) => res.redirect('/tv'));
app.get('/qrcode', (req, res) => { const url = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}/mobile`; QRCode.toDataURL(url, (e, s) => res.send(s)); });

// --- LÓGICA DO SERVIDOR ---
io.on('connection', (socket) => {
    socket.emit('trocar_slide', campanhas[slideAtual]);
    socket.emit('dados_admin', campanhas);
    socket.on('pedir_atualizacao', () => { socket.emit('trocar_slide', campanhas[slideAtual]); });
    
    socket.on('resgatar_oferta', (id) => {
        let camp = campanhas[id];
        if (camp && camp.qtd > 0) {
            camp.qtd--;
            
            // INTELIGÊNCIA DE DADOS
            camp.totalResgates++;
            const agora = new Date();
            const horaAtual = agora.getHours();
            if(horaAtual >= 0 && horaAtual <= 23) camp.resgatesPorHora[horaAtual]++;
            camp.ultimoCupom = gerarCodigo(camp.prefixo);
            camp.ultimaHora = agora.toLocaleTimeString('pt-BR');

            io.emit('atualizar_qtd', camp);
            if(slideAtual === id) io.emit('trocar_slide', camp);
            
            // Sorteio
            const sorte = Math.floor(Math.random() * 100) + 1;
            let cor1 = camp.corPrincipal; let cor2 = camp.corSecundaria; let nomeFinal = camp.nome;
            let isGold = false;

            if (sorte > 90) { 
                isGold = true;
                cor1 = '#FFD700'; cor2 = '#DAA520'; nomeFinal = `🌟 ${camp.nome} (SUPER OFERTA)`;
            }

            socket.emit('sucesso', { 
                codigo: camp.ultimoCupom, 
                produto: nomeFinal,
                corPrincipal: cor1,
                corSecundaria: cor2,
                isGold: isGold
            });
            
            io.emit('dados_admin', campanhas);
        }
    });

    socket.on('admin_update', (d) => { 
        campanhas[d.id].qtd = parseInt(d.qtd);
        campanhas[d.id].ativa = d.ativa;
        io.emit('dados_admin', campanhas); 
        if(slideAtual === d.id) io.emit('trocar_slide', campanhas[d.id]); 
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`AMPM rodando na porta ${PORT}`));
