'use strict';

document.addEventListener('DOMContentLoaded', () => {
    // --- КОНСТАНТЫ ---
    const ITEMS = { 
        'beer':'ПИВО', 
        'cig':'СИГАРЕТЫ', 
        'cuff':'НАРУЧНИКИ', 
        'saw':'ПИЛА', 
        'mag':'ЛУПА', 
        'phone':'ТЕЛЕФОН', 
        'inv':'ИНВЕРТОР', 
        'adren':'АДРЕНАЛИН', 
        'pills':'ТАБЛЕТКИ' 
    };
    const ITEM_KEYS = Object.keys(ITEMS);
    const MAX_INV = 8;
    const GAME_MODES = { STANDARD: 0, ENDLESS: 1 };
    const REWARDS = { HIT_DEALER: 2000, HIT_SELF_BLANK: 1000, USE_ITEM: 500, WIN_ROUND: 5000 };

    // --- СОСТОЯНИЕ ---
    let state = {};
    let aiMemory = {};
    let playerName = "ИГРОК";
    let justAddedItems = false;
    let isAudioInitialized = false;
    let dealerWatchdogTimer = null;

    // --- DOM ЭЛЕМЕНТЫ ---
    const el = id => document.getElementById(id);
    const ui = {
        screens: { 
            name: el('screen-name'), mode: el('screen-mode'), cash: el('screen-cashout'), 
            end: el('screen-end'), game: el('game') 
        },
        playerNameInput: el('inp-name'), 
        playerNameDisplay: el('p-name'),
        hp: { p: el('p-hp'), d: el('d-hp') }, 
        hpNum: { p: el('p-hp-num'), d: el('d-hp-num') },
        ammo: { live: el('ammo-l'), blank: el('ammo-b') },
        inventory: { p: el('p-grid'), d: el('d-grid') }, 
        log: el('log'),
        buttons: { 
            dealer: el('btn-d'), self: el('btn-s'), next: el('btn-next'),
            standard: el('btn-standard'), endless: el('btn-endless'),
            continueEndless: el('btn-continue-endless'), cashOut: el('btn-cash-out'),
            mainMenu: el('btn-main-menu')
        },
        boxes: { p: el('p-box'), d: el('d-box') },
        aiStatus: el('ai-status'), 
        gameTitle: el('game-title'),
        end: { title: el('end-title'), msg: el('end-msg'), cash: el('end-cash') },
        cashoutValue: el('cash-val'),
        audio: { 
            lobby: el('mus-lobby'), norm1: el('mus-norm1'), norm2: el('mus-norm2'), 
            fin1: el('mus-fin1'), fin2: el('mus-fin2'), win: el('mus-win'), death: el('mus-death')
        },
        sfx: {
            shot: el('snd-shot'), pump: el('snd-pump'), click: el('snd-click'),
            beer: el('snd-beer'), cig: el('snd-cig'), cuff: el('snd-cuff'),
            saw: el('snd-saw'), dev: el('snd-dev'), heal: el('snd-heal'),
            heart: el('snd-heart'), mag: el('snd-mag')
        },
        vignette: el('vignette'), 
        gameContainer: el('game'),
        damageFlash: el('damage-flash')
    };
    
    // --- АУДИО СИСТЕМА ---
    let audioContext, analyser, sourceNode;
    let currentTrack = null;
    let currentScale = 1;
    
    function setupAudioAnalysis(audioElement) {
        try {
            if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
            if (!analyser) {
                analyser = audioContext.createAnalyser();
                analyser.fftSize = 64;
                analyser.smoothingTimeConstant = 0.5;
            }
            if (!audioElement._source) {
                audioElement._source = audioContext.createMediaElementSource(audioElement);
                audioElement._source.connect(analyser);
                analyser.connect(audioContext.destination);
            }
        } catch (e) {}
    }

    function resumeAudioContext() {
        if (audioContext && audioContext.state === 'suspended') audioContext.resume();
    }

    function analyzeMusic() {
        if (!analyser || !currentTrack || currentTrack.paused) {
            ui.vignette.style.boxShadow = 'inset 0 0 100px 20px rgba(0,0,0,0.3)';
            ui.gameContainer.style.transform = 'scale(1)';
            requestAnimationFrame(analyzeMusic);
            return;
        }
        
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(dataArray);
        
        const bass = (dataArray[0] + dataArray[1] + dataArray[2]) / 3;
        const threshold = 160; 
        
        if (bass > threshold) {
            const strength = (bass - threshold) / (255 - threshold);
            const targetScale = 1 + (strength * 0.02); 
            currentScale += (targetScale - currentScale) * 0.2; 
            
            const alpha = strength * 0.5; 
            // Красный цвет ТОЛЬКО если обрезаны провода
            let color = state.wiresCut ? `255, 0, 0` : `79, 139, 79`; 
            
            ui.vignette.style.boxShadow = `inset 0 0 150px 50px rgba(${color}, ${alpha})`;
        } else {
            currentScale += (1 - currentScale) * 0.1; 
            ui.vignette.style.boxShadow = 'inset 0 0 100px 20px rgba(0,0,0,0.3)';
        }

        ui.gameContainer.style.transform = `scale(${currentScale})`;
        requestAnimationFrame(analyzeMusic);
    }

    function playMusic(track) {
        if (!isAudioInitialized) return;
        resumeAudioContext();
        if (currentTrack === track) return;
        for (const key in ui.audio) { fadeOut(ui.audio[key]); }
        currentTrack = track;
        if (track) { setupAudioAnalysis(track); track.currentTime = 0; fadeIn(track); }
    }
    
    function playSfx(name) {
        if (ui.sfx[name]) {
            ui.sfx[name].currentTime = 0;
            ui.sfx[name].play().catch(()=>{});
        }
    }

    function fadeIn(audioElement) {
        audioElement.volume = 0; 
        var playPromise = audioElement.play();
        if (playPromise !== undefined) { playPromise.then(_ => {}).catch(error => {}); }
        let vol = 0; const i = setInterval(() => { vol = Math.min(1, vol + 0.1); audioElement.volume = vol; if(vol===1) clearInterval(i); }, 50);
    }
    function fadeOut(audioElement) {
        if(audioElement.paused) return;
        let vol = audioElement.volume; const i = setInterval(() => { vol = Math.max(0, vol - 0.1); audioElement.volume = vol; if(vol===0) { clearInterval(i); audioElement.pause(); } }, 50);
    }
    
    function initAudio() {
        if (!isAudioInitialized) { 
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            isAudioInitialized = true; resumeAudioContext(); 
            playMusic(ui.audio.lobby); 
            analyzeMusic(); 
        } else { resumeAudioContext(); }
    }
    document.addEventListener('click', initAudio, { once: true });

    // --- УТИЛИТЫ ---
    const log = (text, className = "") => { 
        ui.log.innerHTML += `<div class="log-line ${className}">> ${text}</div>`; 
        ui.log.scrollTop = ui.log.scrollHeight; 
    };
    
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    
    function addMoney(amount, reason) { state.money += amount; }
    
    function resetWatchdog() {
        if (dealerWatchdogTimer) clearTimeout(dealerWatchdogTimer);
        if (state.turn === 'd' && !state.isGameOver) {
            dealerWatchdogTimer = setTimeout(() => {
                log("Дилер замешкался... (АВТО-ХОД)", "l-sys");
                ui.aiStatus.innerText = "";
                const target = aiMemory.knownCharge === 'blank' ? 'self' : 'p';
                shoot(target);
            }, 8000); 
        }
    }
    
    function triggerDamageFlash() {
        ui.damageFlash.classList.add('active');
        setTimeout(() => { ui.damageFlash.classList.remove('active'); }, 150);
    }

    function getNormalRoundMusic() {
        const r = Math.random();
        if (r < 0.45) return ui.audio.norm1;
        if (r < 0.90) return ui.audio.norm2;
        return ui.audio.fin2;
    }
    function getFinalRoundMusic() {
        return Math.random() > 0.5 ? ui.audio.fin1 : ui.audio.fin2;
    }

    // --- ИНТЕРФЕЙС ---
    function toMode() { 
        playerName = ui.playerNameInput.value.trim().toUpperCase() || "ИГРОК"; 
        ui.playerNameDisplay.innerText = playerName; 
        ui.screens.name.style.display = 'none'; 
        ui.screens.mode.style.display = 'flex'; 
    }
    function startStandard() { 
        initializeNewGame(); state.mode = GAME_MODES.STANDARD; 
        ui.screens.mode.style.display = 'none'; ui.screens.game.style.display = 'flex'; 
        log("--- РЕЖИМ: СТАНДАРТ ---", 'l-sys'); initializeStage(); 
    }
    function startEndless() { 
        initializeNewGame(); state.mode = GAME_MODES.ENDLESS; 
        ui.screens.mode.style.display = 'none'; ui.screens.game.style.display = 'flex'; 
        log("--- РЕЖИМ: БЕСКОНЕЧНЫЙ ---", 'l-sys'); initializeStage(); 
    }
    function continueEndless() { 
        state.money *= 2; 
        ui.screens.cash.style.display = 'none'; ui.screens.game.style.display = 'flex'; 
        initializeStage(); 
    }
    function cashOut() { gameOver(true); }

    // --- ЛОГИКА ИГРЫ ---
    function initializeNewGame() {
        state = { 
            mode: GAME_MODES.STANDARD, stage: 1, money: 0, 
            hp: { p: 0, d: 0 }, maxHpForRound: 0, charges: [], turn: 'p', 
            items: { p: {}, d: {} }, cuffedTurns: { p: 0, d: 0 }, 
            sawActive: false, isSuddenDeath: false, wiresCut: false,
            isStealing: false, isGameOver: false, isBlocked: false, 
            initialLive: 0, initialBlank: 0, phonePrediction: null, 
            endlessCycleStartMoney: 0, endlessCycleStartStage: 1 
        };
        aiMemory = { knownCharge: null, knownIndex: -1, knownType: null };
        ITEM_KEYS.forEach(k => { state.items.p[k] = 0; state.items.d[k] = 0; });
        if(dealerWatchdogTimer) clearTimeout(dealerWatchdogTimer);
    }

    function initializeStage() {
        state.isBlocked = false; state.isSuddenDeath = false; state.wiresCut = false;
        ui.screens.game.classList.remove("sudden-death");
        let currentMaxHp = 0; let giveItems = true;
        
        if (state.mode === GAME_MODES.STANDARD) {
            ui.gameTitle.innerText = `BUCKSHOT - ЭТАП ${state.stage}`;
            switch(state.stage) {
                case 1: 
                    currentMaxHp = 2; giveItems = false; 
                    log("--- ЭТАП 1: Предметы отключены ---", "l-sys"); 
                    playMusic(getNormalRoundMusic()); 
                    break;
                case 2: 
                    currentMaxHp = 4; 
                    log("--- ЭТАП 2: Предметы доступны ---", "l-sys"); 
                    playMusic(getNormalRoundMusic());
                    break;
                case 3: 
                    currentMaxHp = 6; 
                    state.isSuddenDeath = true; 
                    ui.gameTitle.innerText = "ФИНАЛЬНЫЙ ЭТАП"; 
                    log("--- ФИНАЛ: Системы жизнеобеспечения активны ---", "l-sys"); 
                    playMusic(getFinalRoundMusic()); 
                    break;
            }
        } else {
            ui.gameTitle.innerText = `БЕСКОНЕЧНЫЙ - РАУНД ${state.stage}`;
            if ((state.stage - 1) % 3 === 0) { 
                state.endlessCycleStartMoney = state.money; 
                state.endlessCycleStartStage = state.stage; 
                log(`--- НОВЫЙ ЦИКЛ (Раунды ${state.stage}-${state.stage+2}) ---`, "l-sys"); 
            }
            if (state.stage % 3 === 0) {
                state.isSuddenDeath = true;
                log("--- СМЕРТЕЛЬНЫЙ РАУНД: Системы активны ---", "l-sys");
                playMusic(getFinalRoundMusic()); 
                currentMaxHp = 6;
            } else {
                playMusic(getNormalRoundMusic());
                currentMaxHp = 4;
            }
        }
        
        state.hp.p = currentMaxHp; state.hp.d = currentMaxHp; state.maxHpForRound = currentMaxHp;
        newLoadout(giveItems);
    }

    function shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    function newLoadout(giveItems = true) {
        if(state.isGameOver) return;
        log("--- НОВАЯ ЗАРЯДКА ---", 'l-sys');
        playSfx('pump');
        let live, blank;
        
        // 1-й Раунд Стандарта: 1 боевой / 2 холостых
        if (state.mode === GAME_MODES.STANDARD && state.stage === 1) { 
            live = 1; blank = 2; 
        } else { 
            const total = Math.floor(Math.random() * 5) + 4; 
            live = Math.floor(total / 2); 
            if(Math.random() > 0.5) live++; 
            if(live < 1) live = 1; 
            if(live >= total) live = total - 1; 
            blank = total - live; 
        }
        
        state.initialLive = live; state.initialBlank = blank;
        let deck = Array(live).fill(true).concat(Array(blank).fill(false));
        state.charges = shuffleArray(deck);
        
        log(`Заряд: ${live} боевых / ${blank} холостых.`);
        
        if (giveItems) {
            const itemsToGive = Math.floor(Math.random() * 4) + 2;
            let pGiven = 0, dGiven = 0;
            const countItems = (who) => Object.values(state.items[who]).reduce((a, b) => a + b, 0);
            
            let availableKeys = ITEM_KEYS;
            if (state.wiresCut) { availableKeys = ITEM_KEYS.filter(k => k !== 'cig' && k !== 'pills'); }

            for(let i = 0; i < itemsToGive; i++) if(countItems('p') < MAX_INV) { state.items.p[availableKeys[Math.floor(Math.random() * availableKeys.length)]]++; pGiven++; }
            for(let i = 0; i < itemsToGive; i++) if(countItems('d') < MAX_INV) { state.items.d[availableKeys[Math.floor(Math.random() * availableKeys.length)]]++; dGiven++; }
            if (pGiven > 0 || dGiven > 0) log(`Выдано предметов: Вам +${pGiven}, Дилеру +${dGiven}`);
        } else { ITEM_KEYS.forEach(k => { state.items.p[k] = 0; state.items.d[k] = 0; }); }
        state.cuffedTurns = { p: 0, d: 0 }; state.sawActive = false; state.turn = 'p'; state.phonePrediction = null; aiMemory = { knownCharge: null, knownIndex: -1, knownType: null };
        justAddedItems = true; 
        handleNextTurn(false);
        setTimeout(() => { justAddedItems = false; render(); }, 1500);
    }

    function checkWires() {
        if (state.isSuddenDeath && !state.wiresCut) {
            if (state.hp.p <= 2 || state.hp.d <= 2) {
                state.wiresCut = true;
                ui.screens.game.classList.add("sudden-death");
                log("!!! ПРОВОДА ОБРЕЗАНЫ! ДЕФИБРИЛЛЯТОР ОТКЛЮЧЕН !!!", "l-harm");
                
                // Включаем жесткую музыку 70K
                playMusic(ui.audio.win); // Используем слот win для трека 70K
                
                render(); 
            }
        }
    }

    function render() {
        const drawHearts = (current, max) => {
            let html = '';
            for (let i = 0; i < max; i++) {
                if (i < current) { 
                    if (state.wiresCut) html += '<span class="heart-critical">⚡</span>'; 
                    else html += '<span class="heart-live">❤️</span>'; 
                } 
                else { html += '<span class="heart-dead">🖤</span>'; }
            }
            return html;
        };

        ui.hp.p.innerHTML = drawHearts(state.hp.p, state.maxHpForRound);
        ui.hp.d.innerHTML = drawHearts(state.hp.d, state.maxHpForRound);
        ui.hpNum.p.innerText = `HP: ${state.hp.p}/${state.maxHpForRound}`; 
        ui.hpNum.d.innerText = `HP: ${state.hp.d}/${state.maxHpForRound}`;
        ui.ammo.live.innerText = state.initialLive; ui.ammo.blank.innerText = state.initialBlank;
        ui.boxes.p.className = "p"===state.turn?"turn-box active-turn":"turn-box"; ui.boxes.d.className = "d"===state.turn?"turn-box active-turn":"turn-box";
        
        // Визуал дилера при обрезанных проводах
        if (state.wiresCut && state.hp.d <= 2) { ui.boxes.d.classList.add('critical-state'); } else { ui.boxes.d.classList.remove('critical-state'); }

        const canAct = !state.isBlocked && "p"===state.turn && state.charges.length > 0 && !state.cuffedTurns.p && !state.isStealing && !state.isGameOver;
        ui.buttons.dealer.disabled = !canAct; ui.buttons.self.disabled = !canAct;
        
        ui.inventory.p.innerHTML = "";
        ITEM_KEYS.forEach(key => {
            if(state.items.p[key] > 0) {
                const btn = document.createElement("button"); btn.className = "btn-item p-item"; if(justAddedItems) btn.classList.add("new-item");
                btn.innerHTML = `<span>${ITEMS[key]}<br>x${state.items.p[key]}</span>`; btn.disabled = !canAct; 
                // Блокировка хила, если провода обрезаны
                if(state.wiresCut && ("cig"===key || "pills"===key)) btn.disabled = true;
                btn.onclick = () => useItem("p", key); ui.inventory.p.appendChild(btn);
            }
        });
        ui.inventory.d.innerHTML = "";
        ITEM_KEYS.forEach(key => {
            if(state.items.d[key] > 0) {
                const btn = document.createElement("button"); btn.className = "btn-item"; if(justAddedItems) btn.classList.add("new-item");
                btn.innerHTML = `<span>${ITEMS[key]}<br>x${state.items.d[key]}</span>`; btn.disabled = true;
                if(state.isStealing && "adren"!==key) { 
                    if (state.wiresCut && (key === 'cig' || key === 'pills')) { btn.disabled = true; } 
                    else { btn.disabled = false; btn.onclick = () => stealAction(key); }
                }
                ui.inventory.d.appendChild(btn);
            }
        });
        if(state.isStealing) log("КРАЖА: ВЫБЕРИТЕ ПРЕДМЕТ ДИЛЕРА", "l-item");
        
        if (state.hp.p === 1 && !state.isGameOver) {
            if (ui.sfx.heart.paused) ui.sfx.heart.play().catch(()=>{});
        } else {
            ui.sfx.heart.pause(); ui.sfx.heart.currentTime = 0;
        }
    }

    async function useItem(who, item) {
        if (who === 'p' && state.isBlocked) return;
        state.isBlocked = true;
        const isPlayer = who === 'p';
        if (state.items[who][item] > 0) state.items[who][item]--; else { state.isBlocked = false; return; }
        render(); await wait(300); log(`${isPlayer ? playerName : 'ДИЛЕР'} использует: ${ITEMS[item]}`, "l-item"); 
        await wait(600);
        if (!isPlayer) resetWatchdog();
        if (isPlayer) addMoney(REWARDS.USE_ITEM, "Предмет");
        await applyItemEffect(who, item);
        if (isPlayer) { state.isBlocked = false; render(); }
    }

    async function applyItemEffect(who, item) {
        const isPlayer = who === 'p';
        switch(item) {
            case "beer": playSfx('beer'); break;
            case "cig": playSfx('cig'); break;
            case "cuff": playSfx('cuff'); break;
            case "saw": playSfx('saw'); break;
            case "mag": playSfx('mag'); break; 
            case "phone": playSfx('dev'); break;
            case "inv": playSfx('dev'); break;
            case "adren": playSfx('heal'); break;
            case "pills": playSfx('heal'); break; // ТАБЛЕТКИ = ЗВУК ХИЛА
        }

        switch(item) {
            case "mag": if (state.charges.length > 0) { const charge = state.charges[0]; if (isPlayer) log(`ЛУПА: Следующий патрон - ${charge ? '🔥 БОЕВОЙ' : '⚪ ХОЛОСТОЙ'}`, "l-item"); else aiMemory.knownCharge = charge ? "live" : "blank"; } break;
            case "phone": if(state.charges.length < 2) { if(isPlayer) log("Телефон молчит...", "l-sys"); } else { const index = Math.floor(Math.random() * (state.charges.length - 1)) + 1; const futureCharge = state.charges[index]; if(isPlayer) { state.phonePrediction = { index: index, isLive: futureCharge }; const msg = `ТЕЛЕФОН: Патрон №${index + 1} в текущей очереди - ${futureCharge ? 'БОЕВОЙ' : 'ХОЛОСТОЙ'}`; log(msg, "l-item"); } else { aiMemory.knownIndex = index; aiMemory.knownType = futureCharge ? "live" : "blank"; } } break;
            case "adren": if(isPlayer) { const hasItems = ITEM_KEYS.some(k => "adren"!==k && state.items.d[k] > 0); if(hasItems) state.isStealing = true; else log("У дилера нечего красть.", "l-sys"); } else { await aiSteal(); } break;
            case "cig": if(state.wiresCut) { log("ЛЕЧЕНИЕ ОТКЛЮЧЕНО!", "l-harm"); } else if (state.hp[who] < state.maxHpForRound) { state.hp[who]++; playSfx('heal'); log("+1 HP", "l-heal"); } else { if(isPlayer) log("Здоровье уже на максимуме для этого раунда.", "l-sys"); } break;
            case "pills": if(state.wiresCut) { log("ЛЕЧЕНИЕ ОТКЛЮЧЕНО!", "l-harm"); } else if(Math.random() > 0.5) { state.hp[who] = Math.min(state.maxHpForRound, state.hp[who] + 2); playSfx('heal'); log("+2 HP", "l-heal"); } else { state.hp[who]--; log("-1 HP", "l-harm"); if(checkDeath()) return; } break;
            case "beer": if (state.charges.length > 0) { const ejected = state.charges.shift(); playSfx('pump'); log(`Выброшен патрон: ${ejected ? '🔥 БОЕВОЙ' : '⚪ ХОЛОСТОЙ'}`, ejected ? "l-harm" : "l-sys"); aiMemory.knownCharge = null; if(state.phonePrediction) state.phonePrediction.index--; if(aiMemory.knownIndex > -1) aiMemory.knownIndex--; } break;
            case "cuff": const target = isPlayer ? 'd' : 'p'; if(!state.cuffedTurns[target]) { state.cuffedTurns[target] = 1; log("Цель скована на 1 ход!", "l-item"); } break;
            case "saw": state.sawActive = true; log("Следующий выстрел нанесет x2 урон!", "l-harm"); break;
            case "inv": if(state.charges.length > 0) { state.charges[0] = !state.charges[0]; log("Полярность патрона изменена!", "l-sys"); if(!isPlayer && aiMemory.knownCharge) aiMemory.knownCharge = ("live"===aiMemory.knownCharge) ? "blank" : "live"; } break;
        }
        checkWires();
    }

    window.stealAction = async (item) => {
        state.isBlocked = true; state.items.d[item]--; state.isStealing = false;
        log(`УКРАДЕНО: ${ITEMS[item]}`, "l-item"); render(); await wait(500); 
        log(`${playerName} немедленно использует: ${ITEMS[item]}`, "l-item"); await wait(600);
        if (state.mode === GAME_MODES.ENDLESS || state.mode === GAME_MODES.STANDARD) addMoney(REWARDS.USE_ITEM, "Украденный предмет");
        await applyItemEffect('p', item); state.isBlocked = false; render();
    };

    async function aiTurn() {
        if(state.isGameOver) return;
        state.isBlocked = true; ui.aiStatus.innerText = "ДИЛЕР ДУМАЕТ...";
        resetWatchdog();
        await wait(2500);
        if(state.cuffedTurns.d > 0) { 
            log("Дилер пропускает ход (в наручниках).", "l-sys"); 
            state.cuffedTurns.d = 0; state.turn = 'p'; handleNextTurn(); return; 
        }
        if (aiMemory.knownIndex === 0) { aiMemory.knownCharge = aiMemory.knownType; aiMemory.knownIndex = -1; }
        
        let itemUsedInLoop = true;
        while(itemUsedInLoop) {
            if (state.charges.length === 0 || state.isGameOver) break;
            itemUsedInLoop = false; let actionToTake = null;
            if ("blank"===aiMemory.knownCharge && state.items.d.inv > 0) actionToTake = "inv";
            else if ("live"===aiMemory.knownCharge && state.items.d.saw > 0 && !state.sawActive) actionToTake = "saw";
            else if (!aiMemory.knownCharge && state.items.d.mag > 0) actionToTake = "mag";
            else if ("live"===aiMemory.knownCharge && state.items.d.cuff > 0 && !state.cuffedTurns.p && state.hp.p <= (state.sawActive ? 2:1)) actionToTake = "cuff";
            else if ("blank"===aiMemory.knownCharge && state.items.d.beer > 0) actionToTake = "beer";
            else if (state.items.d.adren > 0 && ITEM_KEYS.some(k => ['saw', 'cuff', 'inv'].includes(k) && state.items.p[k] > 0)) actionToTake = "adren";
            
            // ЛЕЧЕНИЕ ТОЛЬКО ЕСЛИ ПРОВОДА ЦЕЛЫ
            else if (!state.wiresCut && !state.isSuddenDeath && state.hp.d <= state.maxHpForRound / 2 && (state.items.d.cig > 0 || state.items.d.pills > 0)) { actionToTake = state.items.d.cig > 0 ? "cig" : "pills"; }
            
            else if (aiMemory.knownIndex < 0 && state.charges.length > 2 && state.items.d.phone > 0) actionToTake = "phone";
            if (actionToTake) { 
                await useItem("d", actionToTake); 
                await wait(2000); 
                itemUsedInLoop = true; 
            }
        }
        if(state.charges.length === 0 || state.isGameOver) { handleNextTurn(); return; }
        await wait(1000);
        let target = "self";
        const liveLeft = state.charges.filter(c => c).length;
        const blankLeft = state.charges.length - liveLeft;
        if ("live"===aiMemory.knownCharge) target = 'p'; 
        else if ("blank"===aiMemory.knownCharge) target = "self";
        else {
            if (state.hp.d === 1 && liveLeft > 0) target = 'p';
            else if (liveLeft > blankLeft) target = 'p';
            else if (blankLeft > liveLeft) target = "self";
            else target = state.hp.d >= state.hp.p ? "self" : 'p';
        }
        ui.aiStatus.innerText = ""; shoot(target);
    }

    async function aiSteal() {
        const stealable = ITEM_KEYS.filter(k => "adren"!==k && state.items.p[k] > 0);
        if(stealable.length > 0) {
            const stolen = stealable[Math.floor(Math.random() * stealable.length)];
            state.items.p[stolen]--; log(`Дилер украл у вас ${ITEMS[stolen]}!`, "l-harm");
            await wait(500); log(`Дилер немедленно использует: ${ITEMS[stolen]}`, "l-item");
            await wait(600); await applyItemEffect('d', stolen);
        } else { log("Дилер попытался что-то украсть, но у вас пусто.", "l-sys"); }
    }

    async function shoot(target) {
        if (dealerWatchdogTimer) clearTimeout(dealerWatchdogTimer);
        if(state.isBlocked && "p"===state.turn) return; 
        state.isBlocked = true; render();
        if(state.charges.length === 0) { handleNextTurn(); return; }
        if("p"===state.turn && state.phonePrediction && state.phonePrediction.index === 0) {
            log(`> ТЕЛЕФОН: СЛЕДУЮЩИЙ ПАТРОН - ${state.phonePrediction.isLive ? 'БОЕВОЙ' : 'ХОЛОСТОЙ'}!`, "l-item"); await wait(1000);
        }
        if("d"===state.turn && aiMemory.knownIndex === 0) { aiMemory.knownCharge = aiMemory.knownType; }
        const shooter = state.turn; const isLive = state.charges.shift();
        if(state.phonePrediction) state.phonePrediction.index--; if(aiMemory.knownIndex > -1) aiMemory.knownIndex--; aiMemory.knownCharge = null;
        const shooterName = "p"===shooter ? playerName : 'ДИЛЕР';
        const targetName = ("s"===target || "self"===target) ? 'СЕБЯ' : ("p"===shooter ? 'ДИЛЕРА' : 'ВАС');
        log(`${shooterName} стреляет в ${targetName}...`); 
        await wait(2000);
        let damage = state.sawActive ? 2 : 1; state.sawActive = false;
        if(isLive) {
            playSfx('shot'); 
            log(`💥 БАХ! Это был боевой! (-${damage} HP)`, "l-harm");
            
            if ("p"===shooter && ("s"===target || "self"===target)) triggerDamageFlash();
            if ("d"===shooter && ("p"===target)) triggerDamageFlash();

            if (shooter === 'p' && target === 'd') addMoney(REWARDS.HIT_DEALER, "Попадание");
            if("s"===target || "self"===target) state.hp[shooter] -= damage; else state.hp["p"===shooter ? 'd' : 'p'] -= damage;
            state.turn = ("p"===shooter) ? 'd' : 'p';
            
            checkWires(); // ПРОВЕРКА ПОСЛЕ ВЫСТРЕЛА
            if(checkDeath()) return;
        } else {
            playSfx('click'); 
            log(`💨 Клик... Патрон холостой.`, "l-sys");
            if (shooter === 'p' && (target === 's' || target === 'self')) addMoney(REWARDS.HIT_SELF_BLANK, "Холостой в себя");
            if("s"!==target && "self"!==target) { state.turn = ("p"===shooter) ? 'd' : 'p'; }
        }
        handleNextTurn();
    }

    async function handleNextTurn(delay = true) {
        render(); if(state.isGameOver) return;
        if(state.charges.length === 0) { 
            log("--- Патроны кончились ---", "l-sys");
            await wait(2000); newLoadout(state.stage !== 1 || state.mode !== GAME_MODES.STANDARD); return;
        }
        if(delay) await wait(1000);
        state.isBlocked = false; 
        if("d"===state.turn) {
            aiTurn();
        } else { 
            if(state.cuffedTurns.p > 0) { 
                log("Вы пропускаете ход (в наручниках).", "l-sys"); 
                state.cuffedTurns.p = 0; state.turn = 'd'; render(); aiTurn();
            } else { render(); }
        }
    }

    function checkDeath() {
        if(state.hp.p <= 0) { gameOver(false); return true; }
        if(state.hp.d <= 0) { winStage(); return true; }
        return false;
    }

    function winStage() {
        log("ПОБЕДА В РАУНДЕ!", "l-heal"); 
        addMoney(REWARDS.WIN_ROUND, "Победа в раунде");
        state.isBlocked = true; state.stage++; 
        if (state.mode === GAME_MODES.STANDARD) {
            if (state.stage > 3) setTimeout(() => gameOver(true), 2000); else setTimeout(() => { initializeStage(); }, 2000);
        } else if (state.mode === GAME_MODES.ENDLESS) {
            if ((state.stage - 1) % 3 === 0) { setTimeout(() => showCashOut(), 2000); } else { setTimeout(() => { initializeStage(); }, 2000); }
        }
    }

    function animateCounter(element, start, end, duration) {
        let startTimestamp = null;
        const step = (timestamp) => {
            if (!startTimestamp) startTimestamp = timestamp;
            const progress = Math.min((timestamp - startTimestamp) / duration, 1);
            element.innerText = "$" + Math.floor(progress * (end - start) + start).toLocaleString("ru-RU");
            if (progress < 1) window.requestAnimationFrame(step);
        };
        window.requestAnimationFrame(step);
    }

    window.showCashOut = () => { ui.screens.game.style.display = 'none'; ui.screens.cash.style.display = 'flex'; animateCounter(ui.cashoutValue, 0, state.money, 1500); }

    async function gameOver(isWin) {
        ui.sfx.heart.pause(); 
        if (!isWin && state.mode === GAME_MODES.ENDLESS) {
            playMusic(ui.audio.lobby); log("Смерть... Цикл перезапускается.", "l-harm");
            state.money = state.endlessCycleStartMoney; state.stage = state.endlessCycleStartStage;
            await wait(3000); initializeStage(); return;
        }
        playMusic(isWin ? ui.audio.win : ui.audio.death);
        state.isGameOver = true; state.isBlocked = true;
        ui.screens.game.style.display = 'none'; ui.screens.cash.style.display = 'none'; ui.screens.end.style.display = 'flex';
        const title = isWin ? "ПОБЕДА!" : "ПОРАЖЕНИЕ";
        const msg = isWin ? (state.mode === GAME_MODES.STANDARD ? "Вы забрали главный приз:" : "Вы ушли с суммой:") : `Вы погибли в ${state.mode === GAME_MODES.STANDARD ? 'этапе' : 'раунде'} ${state.stage}.`;
        ui.end.title.innerText = title; ui.end.title.style.color = isWin ? '#5f5' : '#f55';
        ui.end.msg.innerHTML = msg;
        if(isWin || state.mode === GAME_MODES.ENDLESS) { ui.end.cash.style.display = 'block'; const finalMoney = (isWin && state.mode === GAME_MODES.STANDARD) ? (70000 + state.money) : state.money; animateCounter(ui.end.cash, 0, finalMoney, 1500); } else { ui.end.cash.style.display = 'none'; }
    }

    ui.buttons.next.onclick = toMode;
    ui.buttons.standard.onclick = startStandard;
    ui.buttons.endless.onclick = startEndless;
    ui.buttons.continueEndless.onclick = continueEndless;
    ui.buttons.cashOut.onclick = cashOut;
    ui.buttons.mainMenu.onclick = () => location.reload();
    ui.buttons.dealer.onclick = () => shoot('d');
    ui.buttons.self.onclick = () => shoot('s');
});