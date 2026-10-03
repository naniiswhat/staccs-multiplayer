const socket = io();
let myPlayerNum = null;
let myHand = [];
let hasCalledUhOh = false;
let isMyTurn = false;
let opponentCardCount = 0;
let opponentHasCalled = false;

// ATTACK TRACKING
let attackMagnitude = 0;
let attackType = 'draw';
let givePending = null;

socket.on('playerAssigned', (data) => {
    myPlayerNum = data.playerNum;
    myHand = data.hand;
    hasCalledUhOh = data.hasCalledUhOh || false;
    console.log(`Assigned as Player ${myPlayerNum}`);
    renderHand();
});

socket.on('stateSync', (data) => {
    board.clear();
    boardDOM.innerHTML = '';
    renderedCards.clear();

    currentRotation = data.currentRotation;
    attackMagnitude = data.attackMagnitude;
    attackType = data.attackType;
    givePending = data.givePending;

    if (myPlayerNum) {
        const oppNum = myPlayerNum === 1 ? 2 : 1;
        opponentCardCount = data.playerCardCounts[oppNum];
        opponentHasCalled = data.playerUhOhStatus[oppNum];
    }

    Object.entries(data.board).forEach(([coordKey, card]) => {
        card.pixelX = (card.vx * (CARD_WIDTH / 2)) - (card.vy * (CARD_WIDTH / 2));
        card.pixelY = (card.vx * (CARD_HEIGHT / 4)) + (card.vy * (CARD_HEIGHT / 4)) - (card.vz * (CARD_HEIGHT / 2));
        card.zIndex = (card.vx + card.vy) + (card.vz * 10);
        board.set(coordKey, card);
    });

    updateBoardDisplay();

    if (!data.gameOver) {
        const turnText = (data.currentTurn === myPlayerNum) ? "Your Turn!" : `Player ${data.currentTurn}'s Turn`;
        document.getElementById('turnDisplay').innerText = myPlayerNum ? `P${myPlayerNum} (${turnText})` : "Spectating";

        const btnDraw = document.getElementById('btnDraw');
        const btnGive = document.getElementById('btnGive');

        btnDraw.style.display = 'block';
        btnGive.style.display = 'none';

        // Queen "Give" Modal active
        if (givePending) {
            if (givePending.from === myPlayerNum) {
                btnDraw.style.display = 'none';
                btnGive.style.display = 'block';
                const required = Math.min(givePending.count, myHand.length);
                btnGive.innerText = `Give ${selectedCardIndices.length} / ${required} Cards`;
            } else if (givePending.to === myPlayerNum) {
                btnDraw.style.display = 'none';
                document.getElementById('turnDisplay').innerText = `Waiting for Opponent...`;
            }
        }
        // Standard Attack active
        else if (attackMagnitude > 0) {
            if (data.currentTurn === myPlayerNum) {
                btnDraw.style.background = '#f97316';
                btnDraw.innerText = `Absorb +${attackMagnitude} (${attackType === 'give' ? 'From P' + (myPlayerNum === 1 ? 2 : 1) : 'Deck'})`;
            } else {
                btnDraw.style.background = '#ef4444';
                btnDraw.innerText = `Draw 1 Card`;
            }
        }
        // Normal State
        else {
            btnDraw.style.background = '#ef4444';
            btnDraw.innerText = `Draw 1 Card`;
        }
    }
    renderHand();
});

socket.on('handSync', (data) => {
    myHand = Array.isArray(data) ? data : data.hand;
    hasCalledUhOh = data.hasCalledUhOh !== undefined ? data.hasCalledUhOh : hasCalledUhOh;
    selectedCardIndices = [];
    renderHand();
});

socket.on('playError', (msg) => showToast(msg));
socket.on('uhOhAnnounced', (data) => showToast(`Player ${data.playerNum} calls UH OH! 🚨`));

socket.on('playerWon', (data) => {
    const isMe = (data.winner === myPlayerNum);
    document.getElementById('hud').innerHTML = `<h2 style="color: #facc15; font-size: 2rem;">${isMe ? "YOU WIN! 🎉" : `PLAYER ${data.winner} WINS! 🎉`}</h2>`;
    document.getElementById('playerHand').innerHTML = '';
    showToast(isMe ? "VICTORY!" : `Player ${data.winner} takes the game!`);
});

// ==========================================
// STACCS UI & ENGINE
// ==========================================
const SUITS = ['spades', 'hearts', 'clubs', 'diamonds'];
const NUMBERS = ['2', '3', '4', '5', '6', '7', '8', '9', '10'];
const FACES = ['J', 'Q', 'K', 'A'];
const SPECIALS = ['0', 'WILD'];
const SUIT_SYMBOLS = { 'spades': '♠', 'hearts': '♥', 'clubs': '♣', 'diamonds': '♦' };
const CARD_WIDTH = 120;
const CARD_HEIGHT = 138;
let board = new Map();

function getCardAt(x, y, z) { return board.get(`${x},${y},${z}`) || null; }

const boardDOM = document.getElementById('gameBoard');
const renderedCards = new Set();
let selectedCardIndices = [];
let pendingWildMove = null;
let pendingWildSuit = null;

function createCardElement(card, x, y, z) {
    const cardDiv = document.createElement('div');
    cardDiv.id = `card-${x}-${y}-${z}`;
    cardDiv.className = `stacc-card suit-${card.suit === 'WILD' && !card.wildResolved ? 'spades' : card.suit}`;
    cardDiv.style.top = '50%'; cardDiv.style.left = '50%';
    cardDiv.style.marginTop = `-${CARD_HEIGHT / 2}px`; cardDiv.style.marginLeft = `-${CARD_WIDTH / 2}px`;

    const suitColor = (card.suit === 'hearts' || card.suit === 'diamonds') ? 'var(--text-red)' : 'var(--text-dark)';
    let physicalTopContent = card.value === 'WILD' && !card.wildResolved ? 'W' : (card.wildResolved ? SUIT_SYMBOLS[card.suit] : SUIT_SYMBOLS[card.suit]);
    let physicalFaceContent = card.value === 'WILD' ? 'W' : (card.type === 'face' ? card.value : SUIT_SYMBOLS[card.suit]);
    let physicalSideContent = card.value === 'WILD' ? 'W' : card.value;

    let colorTop = card.wildResolved ? suitColor : (card.value === 'WILD' ? 'var(--text-dark)' : suitColor);
    let colorFace = card.value === 'WILD' ? 'var(--text-dark)' : (card.type === 'face' ? 'var(--text-dark)' : suitColor);
    let colorSide = 'var(--text-dark)';

    let htmlTop = `<span class="watermark" style="color: ${colorTop};">${physicalTopContent}</span>`;
    let htmlFace = `<span class="text-content" style="color: ${colorFace};">${physicalFaceContent}</span>`;
    if (card.value !== 'WILD') htmlFace += `<span class="index-mark" style="color: ${colorFace};">${card.value}</span>`;
    let htmlSide = `<span class="text-content" style="color: ${colorSide};">${physicalSideContent}</span>`;

    let vHtmlTop, vHtmlFace, vHtmlSide;
    let axisTop = 'Z', axisFace = 'Y', axisSide = 'X';
    const rot = card.globalRotation || 0;

    if (rot === 0) {
        vHtmlTop = htmlTop; axisTop = 'Z';
        vHtmlFace = htmlFace; axisFace = 'Y';
        vHtmlSide = htmlSide; axisSide = 'X';
    } else if (rot === 1) {
        vHtmlTop = htmlFace; axisTop = 'Y';
        vHtmlSide = htmlTop; axisSide = 'Z';
        vHtmlFace = htmlSide; axisFace = 'X';
    } else if (rot === 2) {
        vHtmlTop = htmlSide; axisTop = 'X';
        vHtmlSide = htmlFace; axisSide = 'Y';
        vHtmlFace = htmlTop; axisFace = 'Z';
    }

    cardDiv.innerHTML = `<div class="cube-wrapper"><div class="surface top">${vHtmlTop}</div><div class="surface face">${vHtmlFace}</div><div class="surface side">${vHtmlSide}</div></div>`;

    if (card.isLocked) cardDiv.classList.add('locked');
    cardDiv.style.transform = `translate(${card.pixelX}px, ${card.pixelY}px)`;
    cardDiv.style.zIndex = card.zIndex;

    function routeClick(e, logicalAxis) {
        if (logicalAxis === 'Z') handleSurfaceClick(e, x, y, z + 1, 'TOP');
        if (logicalAxis === 'Y') handleSurfaceClick(e, x, y + 1, z, 'FACE');
        if (logicalAxis === 'X') handleSurfaceClick(e, x + 1, y, z, 'SIDE');
    }

    cardDiv.querySelector('.top').addEventListener('click', (e) => routeClick(e, axisTop));
    cardDiv.querySelector('.face').addEventListener('click', (e) => routeClick(e, axisFace));
    cardDiv.querySelector('.side').addEventListener('click', (e) => routeClick(e, axisSide));

    return cardDiv;
}

function handleSurfaceClick(e, x, y, z, logicalName) {
    if (isDragging) return;
    if (givePending) return showToast("Resolve card exchange first!");

    if (selectedCardIndices.length === 0) return showToast("Select a card from your hand first!");
    if (!myPlayerNum) return showToast("You are spectating.");

    const cardsToPlay = selectedCardIndices.map(idx => myHand[idx]);
    const firstCard = cardsToPlay[0];

    if (cardsToPlay.length > 1 && logicalName !== 'SIDE') {
        return triggerErrorFeedback(e.currentTarget, "COMBO RULE: Multiples can only be chained on a SIDE match!");
    }

    if (firstCard.value === 'WILD') {
        if (cardsToPlay.length > 1) return triggerErrorFeedback(e.currentTarget, "Cannot combo WILD cards!");
        if (logicalName !== 'TOP') return triggerErrorFeedback(e.currentTarget, "WILD RULE: Can ONLY be placed on TOP surfaces.");

        pendingWildMove = { cardIndex: selectedCardIndices[0], x, y, z };
        document.getElementById('wildModal').classList.add('show');
        document.getElementById('wildStep1').style.display = 'block';
        document.getElementById('wildStep2').style.display = 'none';
        return;
    }

    socket.emit('playCards', { cardIndices: selectedCardIndices, x, y, z, logicalName });
}

window.selectWildSuit = function (chosenSuit) {
    pendingWildSuit = chosenSuit;
    document.getElementById('wildStep1').style.display = 'none';
    document.getElementById('wildStep2').style.display = 'block';
};

window.resolveWild = function (rotationValue) {
    if (!pendingWildMove) return;
    socket.emit('resolveWildCard', {
        cardIndex: pendingWildMove.cardIndex, x: pendingWildMove.x, y: pendingWildMove.y, z: pendingWildMove.z,
        suit: pendingWildSuit, rotationValue: rotationValue
    });
    document.getElementById('wildModal').classList.remove('show');
    selectedCardIndices = [];
    pendingWildMove = null;
    pendingWildSuit = null;
};

function updateBoardDisplay() {
    board.forEach((card, coordString) => {
        const [x, y, z] = coordString.split(',').map(Number);
        if (!renderedCards.has(coordString)) {
            boardDOM.appendChild(createCardElement(card, x, y, z));
            renderedCards.add(coordString);
        } else if (card.isLocked) {
            document.getElementById(`card-${x}-${y}-${z}`)?.classList.add('locked');
        }
    });
}

function renderHand() {
    const handDOM = document.getElementById('playerHand');
    handDOM.innerHTML = '';
    const btnUhOh = document.getElementById('btnUhOh');
    const btnCatch = document.getElementById('btnCatch');
    const btnGive = document.getElementById('btnGive');

    if (!myPlayerNum) {
        if (btnUhOh) btnUhOh.style.display = 'none';
        return;
    }

    // Dynamic give text
    const requiredGive = givePending ? Math.min(givePending.count, myHand.length) : 0;
    if (btnGive && givePending && givePending.from === myPlayerNum) {
        btnGive.innerText = `Give ${selectedCardIndices.length} / ${requiredGive} Cards`;
    }

    const projectedHandSize = myHand.length - (givePending ? 0 : selectedCardIndices.length);
    if (projectedHandSize <= 1 || myHand.length <= 2) {
        btnUhOh.style.display = 'block';
        btnUhOh.innerText = hasCalledUhOh ? "CALLED!" : "UH OH!";
        btnUhOh.style.opacity = hasCalledUhOh ? "0.6" : "1";
    } else {
        btnUhOh.style.display = 'none';
    }

    if (btnCatch) {
        btnCatch.style.display = (opponentCardCount === 1 && !opponentHasCalled) ? 'block' : 'none';
    }

    myHand.forEach((card, index) => {
        const div = document.createElement('div');
        div.className = `hand-card suit-${card.suit}`;
        div.innerHTML = `<div>${card.value === 'WILD' ? '' : card.value}</div><div>${card.value === 'WILD' ? 'W' : SUIT_SYMBOLS[card.suit]}</div>`;

        if (selectedCardIndices.includes(index)) div.classList.add('selected');

        div.addEventListener('click', () => {
            if (selectedCardIndices.includes(index)) {
                selectedCardIndices = selectedCardIndices.filter(i => i !== index);
            } else {
                if (givePending && givePending.from === myPlayerNum) {
                    // Selecting cards to give (Any card allowed)
                    if (selectedCardIndices.length < requiredGive) {
                        selectedCardIndices.push(index);
                    } else {
                        showToast(`You only need to give ${requiredGive} cards.`);
                    }
                } else {
                    // Standard gameplay STACC selection (Must match value)
                    if (selectedCardIndices.length > 0) {
                        const firstSelected = myHand[selectedCardIndices[0]];
                        if ((card.type === 'number' || card.value === '0') && card.value === firstSelected.value) {
                            selectedCardIndices.push(index);
                        } else {
                            selectedCardIndices = [index];
                        }
                    } else {
                        selectedCardIndices = [index];
                    }
                }
            }
            renderHand();
        });
        handDOM.appendChild(div);
    });
}

document.getElementById('btnDraw').addEventListener('click', () => {
    if (!myPlayerNum) return;
    socket.emit('drawCard');
});

document.getElementById('btnGive')?.addEventListener('click', () => {
    if (!myPlayerNum || !givePending) return;
    const required = Math.min(givePending.count, myHand.length);
    if (selectedCardIndices.length !== required) return showToast(`Select exactly ${required} cards to give!`);
    socket.emit('submitGiveCards', selectedCardIndices);
});

document.getElementById('btnUhOh').addEventListener('click', () => {
    if (!myPlayerNum || hasCalledUhOh) return;
    hasCalledUhOh = true;
    socket.emit('callUhOh');
    renderHand();
});

document.getElementById('btnCatch').addEventListener('click', () => {
    if (!myPlayerNum) return;
    socket.emit('catchUhOh');
});

let currentSort = 'value';
document.getElementById('btnSort')?.addEventListener('click', () => {
    if (!myPlayerNum || myHand.length === 0) return;
    socket.emit('sortHand', currentSort);
    currentSort = currentSort === 'suit' ? 'value' : 'suit';
    document.getElementById('btnSort').innerText = `Sort: ${currentSort === 'suit' ? 'Suit' : 'Value'}`;
});

let isDragging = false, startX, startY, scrollLeft, scrollTop, toastTimeout;
boardDOM.addEventListener('mousedown', (e) => {
    if (e.target !== boardDOM) return;
    isDragging = true;
    startX = e.pageX - boardDOM.offsetLeft;
    startY = e.pageY - boardDOM.offsetTop;
    const matrix = new DOMMatrixReadOnly(window.getComputedStyle(boardDOM).transform);
    scrollLeft = matrix.m41; scrollTop = matrix.m42;
});
window.addEventListener('mouseup', () => isDragging = false);
window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    boardDOM.style.transform = `translate(${scrollLeft + (e.pageX - boardDOM.offsetLeft - startX)}px, ${scrollTop + (e.pageY - boardDOM.offsetTop - startY)}px)`;
});

function showToast(msg) {
    const t = document.getElementById('toastMsg');
    t.innerText = msg; t.classList.add('show');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => t.classList.remove('show'), 2500);
}

function triggerErrorFeedback(el, reasonString) {
    if (el) {
        el.classList.remove('shake-error'); void el.offsetWidth; el.classList.add('shake-error');
        showToast(reasonString || "Invalid move!");
    }
}