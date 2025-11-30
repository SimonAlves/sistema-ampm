const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(__dirname));
app.use(express.static('public'));

// --- CONFIGURAÇÃO EXATA DAS 3 OFERTAS ---
let campanhas = [
    // SLIDE 0: COMBUSTÍVEL (OURO - SORTEIO DIFÍCIL)
    { 
        id: 0, 
        tipo: 'foto', 
        arquivo: "slide1.jpg", 
        nome: "Sorteio 50% OFF", // Nome na TV
        qtd: 5, // Estoque baixo pois é prêmio valioso
        ativa: true, 
        corPrincipal: '#FFD700', // Dourado
        corSecundaria: '#003399', // Azul
        prefixo: 'GOLD',
        ehSorteio: true // Ativa modo difícil
    },
    // SLIDE 1: DUCHA GRÁTIS (AZUL)
    { 
        id: 1, 
        tipo: 'foto', 
        arquivo: "slide2.jpg", 
        nome: "Ducha Grátis",   
        qtd: 50, 
        ativa: true, 
        corPrincipal: '#0055aa', // Azul Polipet/Ipiranga
        corSecundaria: '#0099ff', // Azul Claro
        prefixo: 'DUCHA',
        ehSorteio: false
    },
    // SLIDE 2: CAFÉ EXPRESSO (LARANJA)
    { 
        id: 2, 
        tipo: 'foto', 
        arquivo: "slide3.jpg", 
        nome: "Café Expresso Grátis",        
        qtd: 50, 
        ativa: true, 
        corPrincipal: '#F37021', // Laranja AMPM
        corSecundaria: '#663300', // Marrom
        prefixo: 'CAFE',
        ehSorteio: false
    }
];

let slideAtual = 0;

// Rotação a cada 15 segundos
setInterval(() => {
    slideAtual++;
    if (slideAtual >= campanhas.length) slideAtual = 0;
    io.emit('trocar_slide', campanhas[slideAtual]);
}, 15000);

function gerarCodigo(prefixo) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let res = '';
    for (let i=0; i<4; i++) res += chars.charAt(Math.floor(Math.random() * chars.length));
    return `${prefixo}-${res}`;
}

// --- HTML TV ---
const htmlTV = `
<!DOCTYPE html>
<html>
<head><title>TV Promo</title></head>
<body style="margin:0; background:black; overflow:hidden; font-family:Arial; transition: background 0.5s;">
    <div style="display:flex; height:100vh;">
        <div style="flex:3; background:#ccc; display:flex; align-items:center; justify-content:center; overflow:hidden;" id="bgEsq">
            <img id="imgDisplay" src="" style="width:100%; height:100%; object-fit:contain;">
        </div>
        <div style="flex:1; background:#003399; display:flex; flex-direction:column; align-items:center; justify-content:center; border-left:6px solid #FFCC00; text-align:center; color:white;" id="bgDir">
            <img src="logo.png" onerror="this.style.display='none'" style="width:150px; background:white; padding:10px; border-radius:10px; margin-bottom:30px;">
            
            <h1 id="nomeProd" style="font-size:2.5rem; padding:0 10px; font-weight:800;">...</h1>
            
            <div style="background:white; padding:10px; border-radius:10px; margin-top:20px;">
                <img id="qr" src="qrcode.png" style="width:200px; display:block;" 
                     onerror="this.onerror=null; fetch('/qrcode').then(r=>r.text()).then(u=>this.src=u);">
            </div>
            
            <p style="margin-top:10px; font-weight:bold; font-size:1.2rem;" id="txtScan">ESCANEIE AGORA</p>
            
            <div id="boxNum" style="margin-top:30px; border-top:2px dashed rgba(255,255,255,0.3); width:80%; padding-top:20px;">
                <span style="font-size:1.2rem;">RESTAM APENAS:</span><br>
                <span id="num" style="font-size:6rem; font-weight:900; line-height:1;">--</span>
            </div>
        </div>
    </div>
    <script src="/socket.io/socket.io.js"></script>
    <script>
        const socket = io();
        socket.on('trocar_slide', (d) => { update(d); });
        socket.on('atualizar_qtd', (d) => {
            if(document.getElementById('nomeProd').innerText === d.nome) {
                document.getElementById('num').innerText = d.qtd;
            }
        });
        function update(d) {
            document.getElementById('imgDisplay').src = d.arquivo;
            document.getElementById('nomeProd').innerText = d.nome;
            document.getElementById('num').innerText = d.qtd;
            
            document.getElementById('bgDir').style.background = d.corPrincipal;
            document.getElementById('bgEsq').style.background = d.corSecundaria;
            
            const corTexto = (d.corPrincipal === '#FFD700') ? '#003399' : 'white';
            document.getElementById('bgDir').style.color = corTexto;
            document.getElementById('num').style.color = (d.corPrincipal === '#FFD700') ? '#003399' : '#FFCC00';

            // Se for sorteio difícil (Combustível), muda o texto
            if(d.ehSorteio) {
                document.getElementById('boxNum').style.display = 'none'; // Esconde estoque pra dar misterio
                document.getElementById('txtScan').innerText = "TENTE A SORTE!";
            } else {
                document.getElementById('boxNum').style.display = 'block';
                document.getElementById('txtScan').innerText = "GARANTA O SEU";
            }
        }
    </script>
</body>
</html>
`;

// --- HTML MOBILE (COM TRAVA TOTAL ANTI-FRAUDE) ---
const htmlMobile = `
<!DOCTYPE html>
<html>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
    body { font-family: Arial, sans-serif; text-align:center; padding:20px; background:#f0f2f5; margin:0; transition: background 0.3s; }
    .btn-pegar { width:100%; padding:20px; color:white; border:none; border-radius:10px; font-size:20px; margin-top:20px; font-weight:bold; text-transform:uppercase; box-shadow: 0 4px 10px rgba(0,0,0,0.2); }
    .img-prod { width:100%; max-width:300px; border-radius:10px; margin-bottom:15px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
    .ticket-paper { background: #fff; padding: 0; margin-top: 20px; box-shadow: 0 5px 15px rgba(0,0,0,0.1); border-top: 10px solid #F37021; }
    .ticket-body { padding: 25px; }
    .codigo-texto { font-size: 32px; font-weight: bold; letter-spacing: 2px; font-family: monospace; color:#333; }
    .no-print { display: block; }
    @media print { .no-print { display:none; } body { background:white; } .ticket-paper { box-shadow:none; border:1px solid #ccc; } }
</style>
<body>
    <div id="telaPegar">
        <h3 style="color:#555;">OFERTA DO MOMENTO:</h3>
        <img id="fotoM" src="" class="img-prod">
        <h2 id="nomeM" style="color:#333; margin:10px 0;">...</h2>
        <div style="background:white; padding:10px; border-radius:5px; display:inline-block;">
            <span style="color:#666; font-size:12px;">ESTOQUE: </span><strong id="qtdM">--</strong>
        </div><br>
        <button onclick="resgatar()" id="btnResgatar" class="btn-pegar">...</button>
    </div>

    <div id="telaVoucher" style="display:none;">
        <h2 class="no-print" style="color:#003399;">VOCÊ JÁ GANHOU HOJE! 🎉</h2>
        <div class="ticket-paper" id="ticketContainer">
            <div class="ticket-body">
                <img src="logo.png" width="100" style="margin-bottom:10px;" onerror="this.style.display='none'">
                <p style="font-size:14px; color:#666; text-transform:uppercase;">Seu Prêmio:</p>
                <h1 id="voucherNome" style="font-size:24px; color:#333; margin:10px 0;">...</h1>
                <div style="background:#f8f9fa; border:2px dashed #ccc; padding:15px; margin:20px 0;">
                    <div class="codigo-texto" id="codGerado">...</div>
                </div>
                <p style="font-size:12px; color:#555;">Gerado em: <span id="dataHora" style="font-weight:bold;"></span></p>
                <p style="font-size:12px; font-weight:bold; color:red;">Válido apenas hoje.</p>
            </div>
        </div>
        <button onclick="window.print()" class="btn-pegar no-print" style="background:#333;">🖨️ IMPRIMIR</button>
        <p class="no-print" style="font-size:12px; color:gray; margin-top:20px;">⚠️ Limite de 1 cupom por pessoa/dia.</p>
    </div>

    <script src="/socket.io/socket.io.js"></script>
    <script>
        const socket = io();
        let ofertaAtual = null;

        // --- TRAVA DE SEGURANÇA (1 POR DIA) ---
        const hoje = new Date().toLocaleDateString('pt-BR');
        const salvo = localStorage.getItem('ampm_cupom');
        const dataSalva = localStorage.getItem('ampm_data');

        // Se já pegou hoje, BLOQUEIA na tela do voucher
        if (salvo && dataSalva === hoje) {
            mostrarVoucher(JSON.parse(salvo));
        }

        socket.on('trocar_slide', (d) => {
            // Só atualiza se o cara AINDA NÃO PEGOU cupom hoje
            if (document.getElementById('telaVoucher').style.display === 'none') {
                ofertaAtual = d;
                document.getElementById('fotoM').src = d.arquivo;
                document.getElementById('nomeM').innerText = d.nome;
                document.getElementById('qtdM').innerText = d.qtd;
                
                const btn = document.getElementById('btnResgatar');
                btn.style.background = d.corPrincipal;
                
                if(d.ehSorteio) {
                    btn.innerText = "TENTAR A SORTE (5%)";
                    btn.style.color = (d.corPrincipal === '#FFD700') ? '#003399' : 'white';
                } else {
                    btn.innerText = "GARANTIR AGORA";
                    btn.style.color = 'white';
                }
            }
        });

        socket.emit('pedir_atualizacao');

        function resgatar() { 
            if(ofertaAtual) socket.emit('resgatar_oferta', ofertaAtual.id); 
        }

        socket.on('sucesso', (dados) => {
            // Salva no celular pra bloquear refreshes
            const agora = new Date();
            dados.horaTexto = agora.toLocaleDateString('pt-BR') + ' às ' + agora.toLocaleTimeString('pt-BR');
            
            localStorage.setItem('ampm_cupom', JSON.stringify(dados));
            localStorage.setItem('ampm_data', agora.toLocaleDateString('pt-BR'));
            
            mostrarVoucher(dados);
        });

        function mostrarVoucher(dados) {
            document.getElementById('telaPegar').style.display='none';
            document.getElementById('telaVoucher').style.display='block';
            
            document.getElementById('voucherNome').innerText = dados.produto;
            document.getElementById('codGerado').innerText = dados.codigo;
            document.getElementById('dataHora').innerText = dados.horaTexto;
            
            document.getElementById('ticketContainer').style.borderTopColor = dados.corPrincipal;
            document.getElementById('codGerado').style.color = dados.corPrincipal;
            
            if(dados.isGold) {
                document.body.style.backgroundColor = "#FFD700"; // Fundo Dourado se ganhou sorteio
                document.getElementById('voucherNome').innerHTML = "🌟 " + dados.produto + " 🌟";
            }
        }
    </script>
</body>
</html>
`;

// --- ADMIN ---
const htmlAdmin = `
<!DOCTYPE html><html><meta name="viewport" content="width=device-width, initial-scale=1"><body style="font-family:Arial; padding:20px; background:#222; color:white;"><h1>Painel Admin</h1><div id="paineis"></div><script src="/socket.io/socket.io.js"></script><script>const socket=io();socket.on('dados_admin',(lista)=>{const div=document.getElementById('paineis');div.innerHTML="";lista.forEach((c,index)=>{div.innerHTML+=\`<div style="background:#444; padding:15px; margin-bottom:15px; border-radius:10px; border-left: 8px solid \${c.ativa?'#0f0':'#f00'}"><h3>\${c.nome}</h3>Estoque: <input id="qtd_\${index}" type="number" value="\${c.qtd}" style="width:60px;"> <button onclick="salvar(\${index})">Salvar</button></div>\`});});function salvar(id){const q=document.getElementById('qtd_'+id).value;socket.emit('admin_update',{id:id,qtd:q});alert('Salvo!');}</script></body></html>
`;

app.get('/tv', (req, res) => res.send(htmlTV));
app.get('/admin', (req, res) => res.send(htmlAdmin));
app.get('/mobile', (req, res) => res.send(htmlMobile));
app.get('/', (req, res) => res.redirect('/tv'));
app.get('/qrcode', (req, res) => { const url = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}/mobile`; QRCode.toDataURL(url, (e, s) => res.send(s)); });

io.on('connection', (socket) => {
    socket.emit('trocar_slide', campanhas[slideAtual]);
    socket.emit('dados_admin', campanhas);
    socket.on('pedir_atualizacao', () => { socket.emit('trocar_slide', campanhas[slideAtual]); });
    
    socket.on('resgatar_oferta', (id) => {
        let camp = campanhas[id];
        if (camp && camp.qtd > 0) {
            
            // --- SORTEIO DO COMBUSTÍVEL (SLIDE 0) ---
            let nomeFinal = camp.nome;
            let cor1 = camp.corPrincipal;
            let cor2 = camp.corSecundaria;
            let isGold = false;
            let prefixo = camp.prefixo;

            if (camp.ehSorteio) {
                // Sorteio difícil (5% de chance)
                const sorte = Math.floor(Math.random() * 100) + 1;
                
                if (sorte > 95) { 
                    // GANHOU 50%
                    isGold = true;
                    camp.qtd--; // Desconta estoque real só do prêmio bom
                    nomeFinal = "PARABÉNS! 50% DE DESCONTO";
                    // Mantém dourado
                } else {
                    // PERDEU (GANHOU PRÊMIO CONSOLAÇÃO)
                    cor1 = '#cccccc'; // Cinza
                    cor2 = '#333333';
                    nomeFinal = "Não foi dessa vez: Ganhou 2% OFF";
                    prefixo = "DESC";
                    // Não desconta estoque do prêmio bom
                }
            } else {
                // Ducha e Café: Ganha sempre e desconta estoque
                camp.qtd--;
            }

            io.emit('atualizar_qtd', camp);
            if(slideAtual === id) io.emit('trocar_slide', camp);

            socket.emit('sucesso', { 
                codigo: gerarCodigo(prefixo), 
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
        io.emit('dados_admin', campanhas); 
        if(slideAtual === d.id) io.emit('trocar_slide', campanhas[d.id]); 
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`AMPM rodando na porta ${PORT}`));
