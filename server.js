const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const SUITS = ['spades', 'hearts', 'clubs', 'diamonds'];
const NUMBERS = ['2', '3', '4', '5', '6', '7', '8', '9', '10'];
const FACES = ['J', 'Q', 'K', 'A'];
const SPECIALS = ['0', 'WILD'];
const suitOrder = { 'spades': 0, 'hearts': 1, 'clubs': 2, 'diamonds': 3 };
const valueOrder = { '0': 0, '2': 1, '3': 2, '4': 3, '5': 4, '6': 5, '7': 6, '8': 7, '9': 8, '10': 9, 'J': 10, 'Q': 11, 'K': 12, 'A': 13, 'WILD': 14 };

function thoroughShuffle(array) {
    let arr = [...array];
    for (let pass = 0; pass < 3; pass++) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        const cutIndex = Math.floor(arr.length / 2) + Math.floor(Math.random() * 9) - 4;
        arr = arr.slice(cutIndex).concat(arr.slice(0, cutIndex));
    }
    return arr;
}

function generateDeck() {
    let deck = [];
    SUITS.forEach(suit => {
        NUMBERS.forEach(val => deck.push({ id: `${val}_${suit}`, type: 'number', suit: suit, value: val }));
        FACES.forEach(val => deck.push({ id: `${val}_${suit}`, type: 'face', suit: suit, value: val }));
        SPECIALS.forEach(val => deck.push({ id: `${val}_${suit}`, type: 'special', suit: suit, value: val }));
    });
    return thoroughShuffle(deck);
}

let playerSlots = { 1: null, 2: null };
let playerHands = { 1: [], 2: [] };
let playerUhOh = { 1: false, 2: false };
let boardState = {};
let drawPile = [];
let currentTurn = 1;
let currentRotation = 0;
let gameOver = false;

// ATTACK STATE VARIABLES
let attackMagnitude = 0;
let attackType = 'draw'; // 'draw' or 'give'
let givePending = null;  // Tracks when a player owes cards to the opponent

function resetGame() {
    drawPile = generateDeck();
    boardState = {};
    currentRotation = 0;
    currentTurn = 1;
    gameOver = false;
    attackMagnitude = 0;
    attackType = 'draw';
    givePending = null;
    playerUhOh = { 1: false, 2: false };
    playerHands[1] = drawPile.splice(0, 7);
    playerHands[2] = drawPile.splice(0, 7);

    let firstCard;
    do {
        firstCard = drawPile.shift();
        if (firstCard.type !== 'number') drawPile.push(firstCard);
    } while (firstCard.type !== 'number');

    firstCard.vx = 0;
    firstCard.vy = 0;
    firstCard.vz = 0;
    firstCard.globalRotation = 0;

    boardState["0,0,0"] = firstCard;
}

resetGame();

function broadcastState() {
    io.emit('stateSync', {
        board: boardState,
        currentTurn,
        currentRotation,
        gameOver,
        attackMagnitude,
        attackType,
        givePending,
        playerCardCounts: { 1: playerHands[1].length, 2: playerHands[2].length },
        playerUhOhStatus: { 1: playerUhOh[1], 2: playerUhOh[2] }
    });
}

function getCardAt(x, y, z) { return boardState[`${x},${y},${z}`] || null; }
function getCardByVisual(vx, vy, vz) {
    for (let card of Object.values(boardState)) {
        if (card.vx === vx && card.vy === vy && card.vz === vz) return card;
    }
    return null;
}

function getVisualCoords(targetX, targetY, targetZ) {
    let anchor = null, stepAxis = '';
    if (getCardAt(targetX, targetY, targetZ - 1)) { anchor = getCardAt(targetX, targetY, targetZ - 1); stepAxis = 'Z'; }
    else if (getCardAt(targetX - 1, targetY, targetZ)) { anchor = getCardAt(targetX - 1, targetY, targetZ); stepAxis = 'X'; }
    else if (getCardAt(targetX, targetY - 1, targetZ)) { anchor = getCardAt(targetX, targetY - 1, targetZ); stepAxis = 'Y'; }

    if (!anchor) return { vx: 0, vy: 0, vz: 0 };

    let vx = anchor.vx, vy = anchor.vy, vz = anchor.vz;
    const aRot = anchor.globalRotation || 0;
    let visualAxis = stepAxis;

    if (aRot === 1) {
        if (stepAxis === 'Z') visualAxis = 'X';
        if (stepAxis === 'X') visualAxis = 'Y';
        if (stepAxis === 'Y') visualAxis = 'Z';
    } else if (aRot === 2) {
        if (stepAxis === 'Z') visualAxis = 'Y';
        if (stepAxis === 'X') visualAxis = 'Z';
        if (stepAxis === 'Y') visualAxis = 'X';
    }

    if (visualAxis === 'Z') vz += 1;
    if (visualAxis === 'X') vx += 1;
    if (visualAxis === 'Y') vy += 1;

    return { vx, vy, vz };
}

function isOccludedVisual(vx, vy, vz) {
    if (getCardByVisual(vx, vy, vz + 1)) return true;
    if (getCardByVisual(vx + 1, vy, vz)) return true;
    if (getCardByVisual(vx, vy + 1, vz)) return true;
    return false;
}

function isValidMove(card, targetX, targetY, targetZ) {
    if (getCardAt(targetX, targetY, targetZ)) return { valid: false, reason: "Space is already occupied." };

    const cardBelow = getCardAt(targetX, targetY, targetZ - 1);
    const cardLeft = getCardAt(targetX - 1, targetY, targetZ);
    const cardBehind = getCardAt(targetX, targetY - 1, targetZ);

    if (Object.keys(boardState).length > 0 && !cardBelow && !cardLeft && !cardBehind) {
        return { valid: false, reason: "Card must connect to an existing STACC." };
    }

    const vCoords = getVisualCoords(targetX, targetY, targetZ);
    if (isOccludedVisual(vCoords.vx, vCoords.vy, vCoords.vz)) {
        return { valid: false, reason: "BLOCKED: This surface is visually covered by a foreground card." };
    }

    if (cardBelow) {
        if (cardBelow.isLocked) return { valid: false, reason: "LOCKED: Cannot play on cards placed before a WILD." };
        if (cardBelow.value === '0' && cardBelow.zeroBlockTurns > 0) return { valid: false, reason: "ZERO BLOCK: Active '0' block on this surface." };
        if (card.value !== 'WILD' && cardBelow.suit !== card.suit) return { valid: false, reason: `TOP MATCH: Suit must match ${cardBelow.suit.toUpperCase()}.` };
    }

    if (cardLeft) {
        if (cardLeft.isLocked) return { valid: false, reason: "LOCKED: Cannot play on cards placed before a WILD." };
        if (cardLeft.value === 'WILD') return { valid: false, reason: "WILD RULE: You can only play on the active TOP path of a WILD." };
        if (card.type === 'face') return { valid: false, reason: "SIDE MATCH: Cannot play FACE cards on a SIDE surface." };
        if (card.value === 'WILD') return { valid: false, reason: "SIDE MATCH: Cannot play WILD cards on a SIDE surface." };
        if (cardLeft.value !== card.value) return { valid: false, reason: `SIDE MATCH: Number must be exactly ${cardLeft.value}.` };
    }

    if (cardBehind) {
        if (cardBehind.isLocked) return { valid: false, reason: "LOCKED: Cannot play on cards placed before a WILD." };
        if (cardBehind.value === 'WILD') return { valid: false, reason: "WILD RULE: You can only play on the active TOP path of a WILD." };
        if (card.type !== 'face') return { valid: false, reason: "FACE MATCH: Cannot play NUMBER cards on a FACE surface." };
        if (card.value === 'WILD') return { valid: false, reason: "FACE MATCH: Cannot play WILD cards on a FACE surface." };
        if (cardBehind.value !== card.value) return { valid: false, reason: `FACE MATCH: Letter must be exactly ${cardBehind.value}.` };
    }

    return { valid: true };
}

function lockPreviousCards() {
    Object.values(boardState).forEach(card => card.isLocked = true);
}

function checkWinOrPenalty(playerNum, socket) {
    const hand = playerHands[playerNum];

    if (hand.length === 0) {
        if (playerUhOh[playerNum]) {
            gameOver = true;
            io.emit('playerWon', { winner: playerNum });
            return true;
        } else {
            socket.emit('playError', "Forgot to call UH OH! Penalty: Draw 2 cards.");
            if (drawPile.length > 0) hand.push(drawPile.shift());
            if (drawPile.length > 0) hand.push(drawPile.shift());
            playerUhOh[playerNum] = false;
            socket.emit('handSync', { hand, hasCalledUhOh: false });
            return false;
        }
    }
    if (hand.length > 2) playerUhOh[playerNum] = false;
    return false;
}

io.on('connection', (socket) => {
    let assignedNum = null;
    if (!playerSlots[1]) assignedNum = 1;
    else if (!playerSlots[2]) assignedNum = 2;

    if (assignedNum) {
        playerSlots[assignedNum] = socket.id;
        socket.emit('playerAssigned', { playerNum: assignedNum, hand: playerHands[assignedNum], hasCalledUhOh: playerUhOh[assignedNum] });
    } else {
        socket.emit('playerAssigned', { playerNum: null, hand: [], hasCalledUhOh: false });
    }
    broadcastState();

    socket.on('sortHand', (sortBy) => {
        const playerSlotKey = Object.keys(playerSlots).find(key => playerSlots[key] === socket.id);
        const playerNum = Number(playerSlotKey);
        if (!playerNum) return;

        const hand = playerHands[playerNum];
        hand.sort((a, b) => {
            if (sortBy === 'suit') {
                if (a.suit !== b.suit) return suitOrder[a.suit] - suitOrder[b.suit];
                return valueOrder[a.value] - valueOrder[b.value];
            } else {
                if (a.value !== b.value) return valueOrder[a.value] - valueOrder[b.value];
                return suitOrder[a.suit] - suitOrder[b.suit];
            }
        });
        socket.emit('handSync', { hand, hasCalledUhOh: playerUhOh[playerNum] });
    });

    socket.on('callUhOh', () => {
        const playerSlotKey = Object.keys(playerSlots).find(key => playerSlots[key] === socket.id);
        const playerNum = Number(playerSlotKey);
        if (!playerNum) return;
        playerUhOh[playerNum] = true;
        io.emit('uhOhAnnounced', { playerNum });
    });

    socket.on('catchUhOh', () => {
        if (gameOver) return;
        const playerSlotKey = Object.keys(playerSlots).find(key => playerSlots[key] === socket.id);
        const myNum = Number(playerSlotKey);
        if (!myNum) return;

        const oppNum = myNum === 1 ? 2 : 1;
        if (playerHands[oppNum].length === 1 && !playerUhOh[oppNum]) {
            if (drawPile.length > 0) playerHands[oppNum].push(drawPile.shift());
            if (drawPile.length > 0) playerHands[oppNum].push(drawPile.shift());
            io.emit('playError', `Player ${oppNum} got CAUGHT! +2 Penalty.`);
            const oppSocketId = playerSlots[oppNum];
            if (oppSocketId) io.to(oppSocketId).emit('handSync', { hand: playerHands[oppNum], hasCalledUhOh: false });
            broadcastState();
        } else {
            socket.emit('playError', "Opponent is safe!");
        }
    });

    socket.on('playCards', (data) => {
        if (gameOver) return socket.emit('playError', "Game is already over.");

        if (givePending) return socket.emit('playError', "Resolve card exchange first!");

        const { cardIndices, x, y, z, logicalName } = data;
        const playerSlotKey = Object.keys(playerSlots).find(key => playerSlots[key] === socket.id);
        const playerNum = Number(playerSlotKey);

        if (!playerNum) return socket.emit('playError', "Spectators cannot play cards.");
        if (playerNum !== currentTurn) return socket.emit('playError', "Not your turn!");

        const hand = playerHands[playerNum];
        const cardsToPlay = cardIndices.map(idx => hand[idx]).filter(Boolean);
        if (cardsToPlay.length === 0) return socket.emit('playError', "No cards selected.");

        // DEFLECT LOGIC
        const isAttackCard = ['J', 'Q', 'K'].includes(cardsToPlay[0].value);
        if (attackMagnitude > 0 && !isAttackCard) {
            return socket.emit('playError', `ATTACK INCOMING! You must play a J, Q, or K to deflect!`);
        }

        if (cardsToPlay[0].value === 'WILD') return socket.emit('playError', "Wild cards must be resolved via Wild modal.");

        const baseCheck = isValidMove(cardsToPlay[0], x, y, z);
        if (!baseCheck.valid) return socket.emit('playError', baseCheck.reason);

        for (let i = 0; i < cardsToPlay.length; i++) {
            const card = cardsToPlay[i];
            const tx = x + i, ty = y, tz = z;
            const vCoords = getVisualCoords(tx, ty, tz);
            card.vx = vCoords.vx; card.vy = vCoords.vy; card.vz = vCoords.vz;
            card.globalRotation = currentRotation;
            boardState[`${tx},${ty},${tz}`] = card;
        }

        [...cardIndices].sort((a, b) => b - a).forEach(idx => hand.splice(idx, 1));

        const won = checkWinOrPenalty(playerNum, socket);
        if (won) {
            socket.emit('handSync', { hand: [], hasCalledUhOh: true });
            broadcastState();
            return;
        }

        // NEW: MULTIPLIER MATH
        if (isAttackCard) {
            cardsToPlay.forEach(c => {
                if (c.value === 'J' || c.value === 'Q') attackMagnitude += 1;
                if (c.value === 'K') attackMagnitude += 2;
            });
            attackType = cardsToPlay[0].value === 'Q' ? 'give' : 'draw';
        }

        const playedAce = cardsToPlay.some(card => card.value === 'A');
        if (playedAce) {
            io.emit('playError', `Player ${playerNum} played an ACE! Extra turn!`);
        } else {
            currentTurn = currentTurn === 1 ? 2 : 1;
        }

        socket.emit('handSync', { hand, hasCalledUhOh: playerUhOh[playerNum] });
        broadcastState();
    });

    // SUBMIT QUEEN CARDS TO OPPONENT
    socket.on('submitGiveCards', (indices) => {
        if (gameOver) return;
        const playerSlotKey = Object.keys(playerSlots).find(key => playerSlots[key] === socket.id);
        const playerNum = Number(playerSlotKey);

        if (!playerNum || !givePending || givePending.from !== playerNum) return;

        const hand = playerHands[playerNum];
        const requiredCount = Math.min(givePending.count, hand.length);

        if (indices.length !== requiredCount) {
            return socket.emit('playError', `You must select exactly ${requiredCount} cards.`);
        }

        const victimHand = playerHands[givePending.to];
        const cardsToGive = indices.map(idx => hand[idx]);

        // Remove from attacker, add to victim
        [...indices].sort((a, b) => b - a).forEach(idx => hand.splice(idx, 1));
        cardsToGive.forEach(c => victimHand.push(c));

        io.emit('playError', `Player ${playerNum} force-fed ${requiredCount} cards to Player ${givePending.to}!`);

        const savedTo = givePending.to;
        givePending = null;

        const won = checkWinOrPenalty(playerNum, socket);
        if (won) {
            socket.emit('handSync', { hand: [], hasCalledUhOh: true });
        } else {
            socket.emit('handSync', { hand, hasCalledUhOh: playerUhOh[playerNum] });
        }

        const toSocket = playerSlots[savedTo];
        if (toSocket) {
            io.to(toSocket).emit('handSync', { hand: playerHands[savedTo], hasCalledUhOh: playerUhOh[savedTo] });
        }

        broadcastState();
    });

    socket.on('resolveWildCard', (data) => {
        if (gameOver) return socket.emit('playError', "Game is already over.");
        if (givePending) return socket.emit('playError', "Resolve card exchange first!");

        const { cardIndex, x, y, z, suit, rotationValue } = data;
        const playerSlotKey = Object.keys(playerSlots).find(key => playerSlots[key] === socket.id);
        const playerNum = Number(playerSlotKey);

        if (!playerNum) return socket.emit('playError', "Spectators cannot play.");
        if (playerNum !== currentTurn) return socket.emit('playError', "Not your turn!");

        const hand = playerHands[playerNum];
        const card = hand[cardIndex];
        if (!card || card.value !== 'WILD') return socket.emit('playError', "Invalid Wild card.");

        lockPreviousCards();
        currentRotation = (currentRotation + rotationValue) % 3;
        card.suit = suit;
        card.wildResolved = true;

        const vCoords = getVisualCoords(x, y, z);
        card.vx = vCoords.vx; card.vy = vCoords.vy; card.vz = vCoords.vz;
        card.globalRotation = currentRotation;
        boardState[`${x},${y},${z}`] = card;

        hand.splice(cardIndex, 1);

        const won = checkWinOrPenalty(playerNum, socket);
        if (won) {
            socket.emit('handSync', { hand: [], hasCalledUhOh: true });
            broadcastState();
            return;
        }

        currentTurn = currentTurn === 1 ? 2 : 1;
        socket.emit('handSync', { hand, hasCalledUhOh: playerUhOh[playerNum] });
        broadcastState();
    });

    socket.on('drawCard', () => {
        if (gameOver) return socket.emit('playError', "Game is already over.");
        if (givePending) return socket.emit('playError', "Resolve card exchange first!");

        const playerSlotKey = Object.keys(playerSlots).find(key => playerSlots[key] === socket.id);
        const playerNum = Number(playerSlotKey);
        if (playerNum !== currentTurn) return socket.emit('playError', "Not your turn to draw!");

        // ABSORB PENDING ATTACKS (DOES NOT SKIP TURN)
        if (attackMagnitude > 0) {
            if (attackType === 'draw') {
                for (let i = 0; i < attackMagnitude; i++) {
                    if (drawPile.length > 0) playerHands[playerNum].push(drawPile.shift());
                }
                io.emit('playError', `Player ${playerNum} absorbed +${attackMagnitude} from the deck!`);
                attackMagnitude = 0;
            } else if (attackType === 'give') {
                const oppNum = playerNum === 1 ? 2 : 1;
                givePending = { from: oppNum, to: playerNum, count: attackMagnitude };
                attackMagnitude = 0;
                io.emit('playError', `Player ${oppNum} is choosing ${givePending.count} cards to give...`);
            }

            if (playerHands[playerNum].length > 2) playerUhOh[playerNum] = false;
            socket.emit('handSync', { hand: playerHands[playerNum], hasCalledUhOh: playerUhOh[playerNum] });
            broadcastState();
            return; // EXIT EARLY: TURN IS NOT SKIPPED!
        }

        // STANDARD DRAW (SKIPS TURN)
        if (drawPile.length > 0) playerHands[playerNum].push(drawPile.shift());
        if (playerHands[playerNum].length > 2) playerUhOh[playerNum] = false;

        currentTurn = currentTurn === 1 ? 2 : 1;
        socket.emit('handSync', { hand: playerHands[playerNum], hasCalledUhOh: playerUhOh[playerNum] });
        broadcastState();
    });

    socket.on('requestRestart', () => {
        if (!gameOver) return;

        // Reset the core game state
        resetGame();

        // Re-sync hands directly to both connected slots
        for (const [slotNum, sockId] of Object.entries(playerSlots)) {
            if (sockId) {
                io.to(sockId).emit('handSync', {
                    hand: playerHands[slotNum],
                    hasCalledUhOh: false
                });
            }
        }

        // Notify all clients to clear their win banners and render the fresh board
        io.emit('gameRestarted');
        broadcastState();
    });

    socket.on('disconnect', () => {
        for (const [num, id] of Object.entries(playerSlots)) {
            if (id === socket.id) {
                playerSlots[num] = null;
                console.log(`[DISCONNECT] Player ${num} left (${socket.id})`);
            }
        }
        if (!playerSlots[1] && !playerSlots[2]) resetGame();
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`STACCS Server running on http://localhost:${PORT}`);
});