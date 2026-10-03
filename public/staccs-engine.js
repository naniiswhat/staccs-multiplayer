// staccs-engine.js - Core Logic and 3D State Machine

// --- 1. THE DECK ARCHITECTURE ---
const SUITS = ['spades', 'hearts', 'clubs', 'diamonds'];
const NUMBERS = ['2', '3', '4', '5', '6', '7', '8', '9', '10'];
const FACES = ['J', 'Q', 'K', 'A'];
const SPECIALS = ['0', 'WILD'];

function generateDeck() {
    let deck = [];
    SUITS.forEach(suit => {
        NUMBERS.forEach(val => deck.push({ id: `${val}_${suit}`, type: 'number', suit: suit, value: val }));
        FACES.forEach(val => deck.push({ id: `${val}_${suit}`, type: 'face', suit: suit, value: val }));
        SPECIALS.forEach(val => deck.push({ id: `${val}_${suit}`, type: 'special', suit: suit, value: val }));
    });
    return shuffle(deck);
}

function shuffle(array) {
    let currentIndex = array.length, randomIndex;
    while (currentIndex !== 0) {
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex--;
        [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
    }
    return array;
}

// --- 2. THE 3D BOARD STATE ---
let board = new Map();

function getCardAt(x, y, z) {
    return board.get(`${x},${y},${z}`) || null;
}

// --- 3. ADVANCED VALIDATION (MULTI-CARD & AXIS RULES) ---
function isValidMove(cardsToPlay, startX, startY, startZ) {
    const cards = Array.isArray(cardsToPlay) ? cardsToPlay : [cardsToPlay];

    // Validate multi-card combos
    if (cards.length > 1) {
        const firstCard = cards[0];
        if (firstCard.type !== 'number' && firstCard.value !== '0') return false;
        const allSameNumber = cards.every(c => c.value === firstCard.value);
        if (!allSameNumber) return false;
    }

    for (let i = 0; i < cards.length; i++) {
        const card = cards[i];

        // Multi-card plays chain outward sequentially along the X-axis (SIDE)
        const targetX = startX + i;
        const targetY = startY;
        const targetZ = startZ;

        if (getCardAt(targetX, targetY, targetZ)) return false;

        const cardBelow = getCardAt(targetX, targetY, targetZ - 1);
        const cardLeft = getCardAt(targetX - 1, targetY, targetZ);
        const cardBehind = getCardAt(targetX, targetY - 1, targetZ);

        if (board.size > 0 && !cardBelow && !cardLeft && !cardBehind) return false;

        // TOP MATCHING (+Z Axis)
        if (cardBelow) {
            if (cardBelow.value === '0' && gameState.zeroBlockActive) return false;
            if (card.value !== 'WILD' && cardBelow.suit !== card.suit) return false;
        }

        // SIDE MATCHING (+X Axis / Right)
        if (cardLeft) {
            if (card.type === 'face' || card.value === 'WILD') return false;
            if (cardLeft.value !== card.value) return false;
        }

        // FACE MATCHING (+Y Axis / Left)
        if (cardBehind) {
            if (card.type !== 'face' || card.value === 'WILD') return false;
            if (cardBehind.value !== card.value) return false;
        }
    }

    return true;
}

// --- 4. THE STATE MACHINE ---
const gameState = {
    players: [],
    currentPlayerIndex: 0,
    drawPile: [],
    direction: 1,
    activeAttacc: null,
    attaccMultiplier: 0,
    zeroBlockActive: false,
    wildLock: false
};

function startGame(numPlayers) {
    gameState.drawPile = generateDeck();
    const cardsPerPlayer = numPlayers === 5 ? 5 : 7;

    for (let i = 0; i < numPlayers; i++) {
        gameState.players.push({
            id: i,
            hand: gameState.drawPile.splice(0, cardsPerPlayer),
            hasCalledUhOh: false
        });
    }

    // Flip the first card (must be a number, skip specials)
    let firstCard;
    do {
        firstCard = gameState.drawPile.shift();
        if (firstCard.type !== 'number') {
            gameState.drawPile.push(firstCard);
        }
    } while (firstCard.type !== 'number');

    board.set("0,0,0", firstCard);
}

// --- 5. RESOLVING CARD EFFECTS ---
function applySpecialEffects(card) {
    gameState.zeroBlockActive = false;

    switch (card.value) {
        case '0':
            gameState.zeroBlockActive = true;
            if (gameState.players.length >= 3) {
                gameState.direction *= -1; // Reverse play
            }
            break;
        case 'J':
            gameState.activeAttacc = 'DRAW';
            gameState.attaccMultiplier += 1;
            break;
        case 'K':
            gameState.activeAttacc = 'DRAW';
            gameState.attaccMultiplier += 2;
            break;
        case 'Q':
            gameState.activeAttacc = 'GIVE';
            gameState.attaccMultiplier += 1;
            break;
        case 'A':
            return true; // Ace grants an immediate extra turn
        case 'WILD':
            gameState.wildLock = true;
            break;
    }
    return false;
}

function nextTurn() {
    const numPlayers = gameState.players.length;
    gameState.currentPlayerIndex = (gameState.currentPlayerIndex + gameState.direction + numPlayers) % numPlayers;
}

// --- 6. WILD CARD LOCKING ---
function lockPreviousCards() {
    // Flag all currently placed cards as locked
    board.forEach((card, coord) => {
        card.isLocked = true;
    });
}