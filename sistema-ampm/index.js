<!DOCTYPE html>
<html lang="pt-br">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>WEGO Machine - Premium Gamification</title>
    <style>
        :root {
            --bg-dark: #06110b; /* Fundo super escuro com leve toque verde */
            --forest-green: #143a24;
            --golden-mustard: #eab308;
            --neon-blue: #38bdf8;
            --glass-bg: rgba(20, 58, 36, 0.4);
            --glass-border: rgba(234, 179, 8, 0.2);
        }

        * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Segoe UI', system-ui, sans-serif; user-select: none; -webkit-user-select: none; }
        
        body { 
            background: radial-gradient(circle at center, #0f2417, var(--bg-dark)); 
            color: #fff; height: 100vh; width: 100vw; overflow: hidden; touch-action: none; 
        }

        /* --- TELA INICIAL (HUB) --- */
        #hub-screen {
            display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; z-index: 10; position: relative;
        }

        h1 { font-size: 3rem; font-weight: 900; color: var(--golden-mustard); text-transform: uppercase; letter-spacing: 4px; margin-bottom: 40px; text-shadow: 0 10px 30px rgba(234, 179, 8, 0.3); }

        .btn-card {
            background: var(--glass-bg); backdrop-filter: blur(15px); -webkit-backdrop-filter: blur(15px);
            border: 1px solid var(--glass-border); border-radius: 24px; padding: 30px 40px; margin: 15px; width: 80%; max-width: 400px;
            text-align: center; cursor: pointer; transition: transform 0.2s, box-shadow 0.2s;
            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
        }
        .btn-card:active { transform: scale(0.95); box-shadow: 0 5px 15px rgba(234, 179, 8, 0.5); }
        .btn-card h2 { font-size: 1.8rem; color: #fff; margin-bottom: 10px; }
        .btn-card p { font-size: 1rem; color: #94a3b8; }

        /* --- TELAS DE JOGO (Ocultas por padrão) --- */
        .game-screen { display: none; flex-direction: column; align-items: center; justify-content: center; height: 100%; width: 100%; position: absolute; top: 0; left: 0; background: var(--bg-dark); }
        
        .btn-voltar { position: absolute; top: 20px; left: 20px; background: rgba(255,255,255,0.1); border: none; color: #fff; padding: 12px 24px; border-radius: 50px; font-weight: bold; font-size: 1.2rem; z-index: 100; }

        /* --- ROLETA CANVAS --- */
        #roleta-container { position: relative; width: 90vw; max-width: 600px; height: 90vw; max-height: 600px; }
        canvas { width: 100%; height: 100%; border-radius: 50%; box-shadow: 0 0 60px rgba(234, 179, 8, 0.15); }
        #ponteiro { position: absolute; top: -10px; left: 50%; transform: translateX(-50%); width: 0; height: 0; border-left: 25px solid transparent; border-right: 25px solid transparent; border-top: 55px solid var(--golden-mustard); z-index: 10; filter: drop-shadow(0 10px 10px rgba(0,0,0,0.8)); transform-origin: top center; transition: transform 0.1s; }
        .instrucao-touch { position: absolute; bottom: -60px; width: 100%; text-align: center; color: var(--neon-blue); font-size: 1.4rem; font-weight: 900; text-transform: uppercase; animation: pulse 2s infinite; }

        /* --- SPEED MATCH (MEMÓRIA) --- */
        #memory-container { width: 90vw; max-width: 600px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; perspective: 1000px; }
        .mem-card { aspect-ratio: 1/1; position: relative; transform-style: preserve-3d; transition: transform 0.5s cubic-bezier(0.4, 0.2, 0.2, 1); border-radius: 16px; cursor: pointer; }
        .mem-card.flipped { transform: rotateY(180deg); }
        .mem-face { position: absolute; width: 100%; height: 100%; backface-visibility: hidden; -webkit-backface-visibility: hidden; border-radius: 16px; display: flex; align-items: center; justify-content: center; font-size: 3rem; box-shadow: 0 10px 20px rgba(0,0,0,0.4); }
        .mem-front { background: linear-gradient(135deg, var(--forest-green), #0a1f12); border: 2px solid var(--glass-border); }
        .mem-front::after { content: 'W'; font-weight: 900; font-size: 2.5rem; color: rgba(255,255,255,0.1); }
        .mem-back { background: var(--golden-mustard); transform: rotateY(180deg); color: #000; border: 2px solid #fff; }
        
        #timer-bar { width: 90vw; max-width: 600px; height: 15px; background: #334155; border-radius: 20px; margin-bottom: 30px; overflow: hidden; position: relative; }
        #timer-fill { height: 100%; background: var(--neon-blue); width: 100%; transition: width 0.1s linear, background-color 0.3s; }

        /* --- MODAL DE VITÓRIA --- */
        #win-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.9); backdrop-filter: blur(20px); z-index: 999; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
        .win-box { border: 4px solid var(--golden-mustard); padding: 50px; border-radius: 30px; background: var(--bg-dark); box-shadow: 0 0 100px rgba(234, 179, 8, 0.4); animation: pop 0.5s cubic-bezier(0.17, 0.89, 0.32, 1.49); width: 80%; max-width: 500px; }
        #win-title { font-size: 2.5rem; color: #fff; margin-bottom: 20px; }
        #win-prize { font-size: 4rem; font-weight: 900; color: var(--golden-mustard); text-transform: uppercase; text-shadow: 0 0 20px rgba(234, 179, 8, 0.5); }
        .btn-resgatar { margin-top: 30px; background: var(--neon-blue); color: #000; border: none; padding: 20px 40px; font-size: 1.5rem; font-weight: 900; border-radius: 50px; width: 100%; }

        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        @keyframes pop { from { transform: scale(0.5); opacity: 0; } to { transform: scale(1); opacity: 1; } }
    </style>
</head>
<body>

    <!-- HUB INICIAL -->
    <div id="hub-screen">
        <h1>WEGO Machine</h1>
        <div class="btn-card" onclick="abrirJogo('roleta')">
            <h2>🎯 Roleta Haptica</h2>
            <p>Deslize para girar com física real</p>
        </div>
        <div class="btn-card" onclick="abrirJogo('memoria')">
            <h2>🃏 Speed Match</h2>
            <p>Encontre os pares antes do tempo acabar</p>
        </div>
    </div>

    <!-- TELA DA ROLETA -->
    <div id="screen-roleta" class="game-screen">
        <button class="btn-voltar" onclick="voltarHub()">✕ VOLTAR</button>
        <div id="roleta-container">
            <div id="ponteiro"></div>
            <canvas id="roletaCanvas" width="800" height="800"></canvas>
            <div class="instrucao-touch">Deslize o dedo com força! 👇</div>
        </div>
    </div>

    <!-- TELA DO SPEED MATCH -->
    <div id="screen-memoria" class="game-screen">
        <button class="btn-voltar" onclick="voltarHub()">✕ VOLTAR</button>
        <div id="timer-bar"><div id="timer-fill"></div></div>
        <div id="memory-container"></div>
    </div>

    <!-- MODAL DE VITÓRIA -->
    <div id="win-overlay">
        <div class="win-box">
            <div id="win-title">PARABÉNS!</div>
            <div id="win-prize">PRÊMIO</div>
            <button class="btn-resgatar" onclick="voltarHub()">CONCLUIR</button>
        </div>
    </div>

    <script>
        // --- CONTROLE DE TELAS ---
        function abrirJogo(jogo) {
            document.getElementById('hub-screen').style.display = 'none';
            document.querySelectorAll('.game-screen').forEach(el => el.style.display = 'none');
            document.getElementById(`screen-${jogo}`).style.display = 'flex';
            
            if(jogo === 'roleta') initRoleta();
            if(jogo === 'memoria') initMemoria();
        }

        function voltarHub() {
            document.getElementById('win-overlay').style.display = 'none';
            document.querySelectorAll('.game-screen').forEach(el => el.style.display = 'none');
            document.getElementById('hub-screen').style.display = 'flex';
            clearInterval(memTimerInterval);
            cancelAnimationFrame(roletaAnimationId);
        }

        function showWin(premio) {
            if(navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 500]);
            document.getElementById('win-prize').innerText = premio;
            document.getElementById('win-overlay').style.display = 'flex';
        }

        function triggerHaptic(ms = 15) {
            if (navigator.vibrate) navigator.vibrate(ms);
        }

        // ==========================================
        // 1. MOTOR DA ROLETA COM FÍSICA (CANVAS)
        // ==========================================
        const canvas = document.getElementById('roletaCanvas');
        const ctx = canvas.getContext('2d');
        const ponteiro = document.getElementById('ponteiro');
        let roletaAnimationId;
        
        const fatias = ["10% OFF", "BRINDE VIP", "TENTE DE NOVO", "FRETE GRÁTIS", "OURO DOURADO", "20% OFF"];
        const cores = ["#143a24", "#0a1f12", "#143a24", "#0a1f12", "#eab308", "#0a1f12"]; // Palette Wego
        
        let angle = 0, velocity = 0, isDragging = false, lastY = 0;
        const friction = 0.985; // Desaceleração suave

        function desenharRoleta() {
            const w = canvas.width, h = canvas.height;
            ctx.clearRect(0, 0, w, h);
            const sliceAngle = (Math.PI * 2) / fatias.length;

            ctx.save();
            ctx.translate(w / 2, h / 2);
            ctx.rotate(angle);

            for (let i = 0; i < fatias.length; i++) {
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.arc(0, 0, w / 2, i * sliceAngle, (i + 1) * sliceAngle);
                ctx.fillStyle = cores[i];
                ctx.fill();
                ctx.lineWidth = 4; ctx.strokeStyle = "#eab308"; ctx.stroke();

                ctx.save();
                ctx.rotate(i * sliceAngle + sliceAngle / 2);
                ctx.textAlign = "right"; ctx.textBaseline = "middle";
                ctx.fillStyle = (cores[i] === "#eab308") ? "#000" : "#fff";
                ctx.font = "900 40px 'Segoe UI'";
                ctx.fillText(fatias[i], w / 2 - 40, 0);
                ctx.restore();
            }
            ctx.restore();
        }

        function updateFisica() {
            if (!isDragging) {
                angle += velocity;
                velocity *= friction;

                // Animação do ponteiro (feedback tátil e visual)
                const degrees = (angle * 180 / Math.PI) % 360;
                const sliceSize = 360 / fatias.length;
                const offset = degrees % sliceSize;

                if (velocity > 0.005) {
                    if (offset < 8 || offset > sliceSize - 8) {
                        ponteiro.style.transform = `translateX(-50%) rotate(25deg)`;
                        if (offset < 2 && velocity > 0.05) triggerHaptic(10); // Estalo ao passar na catraca
                    } else {
                        ponteiro.style.transform = `translateX(-50%) rotate(0deg)`;
                    }
                } else if (velocity > 0 && velocity < 0.005) {
                    // ROLETA PAROU
                    velocity = 0;
                    ponteiro.style.transform = `translateX(-50%) rotate(0deg)`;
                    calcularPremioRoleta();
                    return; 
                }
            }
            desenharRoleta();
            roletaAnimationId = requestAnimationFrame(updateFisica);
        }

        function calcularPremioRoleta() {
            // Lógica reversa: baseado no ângulo final, qual fatia parou no ponteiro (Top / 270 graus)?
            const degrees = (360 - ((angle * 180 / Math.PI) % 360)) % 360;
            const sliceSize = 360 / fatias.length;
            // Ajuste do ponteiro que está no topo (-90 graus no canvas base)
            let index = Math.floor(((degrees + 270) % 360) / sliceSize);
            setTimeout(() => showWin(fatias[index]), 800);
        }

        // Eventos Touch da Roleta
        canvas.addEventListener('touchstart', (e) => {
            isDragging = true; lastY = e.touches[0].clientY; velocity = 0;
        });
        canvas.addEventListener('touchmove', (e) => {
            if (!isDragging) return;
            const currentY = e.touches[0].clientY;
            const deltaY = currentY - lastY;
            angle += deltaY * 0.005;
            velocity = deltaY * 0.02; // Impulso gerado pelo dedo
            lastY = currentY;
            desenharRoleta();
        });
        canvas.addEventListener('touchend', () => { isDragging = false; });

        function initRoleta() {
            angle = 0; velocity = 0;
            desenharRoleta();
            updateFisica();
        }

        // ==========================================
        // 2. MOTOR DO SPEED MATCH (MEMÓRIA 3D)
        // ==========================================
        const containerMemoria = document.getElementById('memory-container');
        const timerFill = document.getElementById('timer-fill');
        let emoticons = ['💎', '🎁', '🚀', '🌟', '💰', '🏆', '📱', '🎧'];
        let cartas = [];
        let flippedCards = [];
        let matchedPairs = 0;
        let memTimerInterval;
        let timeLeft = 20; // 20 Segundos de pressão
        const tempoTotal = 20;

        function shuffle(array) { return array.sort(() => Math.random() - 0.5); }

        function initMemoria() {
            containerMemoria.innerHTML = '';
            flippedCards = []; matchedPairs = 0; timeLeft = tempoTotal;
            timerFill.style.width = '100%';
            timerFill.style.backgroundColor = 'var(--neon-blue)';

            let deck = shuffle([...emoticons, ...emoticons]);

            deck.forEach(simbolo => {
                const card = document.createElement('div');
                card.classList.add('mem-card');
                card.dataset.simbolo = simbolo;
                
                card.innerHTML = `
                    <div class="mem-face mem-front"></div>
                    <div class="mem-face mem-back">${simbolo}</div>
                `;
                
                // Suporte Multi-touch rápido
                card.addEventListener('pointerdown', virarCarta);
                containerMemoria.appendChild(card);
            });

            clearInterval(memTimerInterval);
            memTimerInterval = setInterval(atualizarTimer, 1000);
        }

        function virarCarta(e) {
            const card = e.currentTarget;
            if (card.classList.contains('flipped') || flippedCards.length >= 2) return;

            triggerHaptic(15);
            card.classList.add('flipped');
            flippedCards.push(card);

            if (flippedCards.length === 2) setTimeout(checarMatch, 500);
        }

        function checarMatch() {
            const [c1, c2] = flippedCards;
            if (c1.dataset.simbolo === c2.dataset.simbolo) {
                // Acertou
                matchedPairs++;
                c1.style.opacity = '0.5'; c2.style.opacity = '0.5'; // Dim visualmente as prontas
                triggerHaptic([30, 50, 30]);
                if (matchedPairs === emoticons.length) {
                    clearInterval(memTimerInterval);
                    setTimeout(() => showWin("PRÊMIO MÁXIMO!"), 500);
                }
            } else {
                // Errou
                c1.classList.remove('flipped'); c2.classList.remove('flipped');
                triggerHaptic(40); // Choque de erro
            }
            flippedCards = [];
        }

        function atualizarTimer() {
            timeLeft--;
            const pct = (timeLeft / tempoTotal) * 100;
            timerFill.style.width = `${pct}%`;
            
            if (timeLeft <= 5) timerFill.style.backgroundColor = '#ef4444'; // Fica vermelho no final

            if (timeLeft <= 0) {
                clearInterval(memTimerInterval);
                // Derrota (Tempo Esgotado)
                document.querySelectorAll('.mem-card').forEach(c => c.classList.remove('flipped'));
                showWin("TENTE NOVAMENTE!");
            }
        }
    </script>
</body>
</html>
