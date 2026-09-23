import {
  FusionShogiGame,
  PLAYERS,
  pieceGlyph,
  pieceName,
  squareKey,
} from "./game.js";
import { ComputerEngine } from "./ai/engine.js";

const game = new FusionShogiGame();
const computerEngine = new ComputerEngine();
const boardElement = document.querySelector("#board");
const blackHandElement = document.querySelector("#black-hand");
const whiteHandElement = document.querySelector("#white-hand");
const resetButton = document.querySelector("#reset-button");
const helpButton = document.querySelector("#help-button");
const rulesCard = document.querySelector("#rules-card");
const difficultySelect = document.querySelector("#ai-level");
const modeSelects = {
  [PLAYERS.BLACK]: document.querySelector("#black-mode"),
  [PLAYERS.WHITE]: document.querySelector("#white-mode"),
};
const promotionDialog = document.querySelector("#promotion-dialog");
const promoteButton = document.querySelector("#promote-button");
const keepButton = document.querySelector("#keep-button");

let selection = null;
let pendingPromotion = null;
let aiTimer = null;
let aiThinking = false;
let aiGeneration = 0;

function playerLabel(player) {
  return player === PLAYERS.BLACK ? "先手" : "後手";
}

function isComputer(player) {
  return modeSelects[player]?.value === "computer";
}

function isComputerTurn() {
  return isComputer(game.turn);
}

function coordinateLabel(row, col) {
  return `${9 - col}${"一二三四五六七八九"[row]}`;
}

function pieceAccessibleLabel(piece) {
  return `${piece.owner === PLAYERS.BLACK ? "先手" : "後手"}${pieceName(piece)}`;
}

function movesForSquare(row, col) {
  if (!selection) return [];
  return selection.moves.filter((move) => move.to.row === row && move.to.col === col);
}

function clearSelection() {
  selection = null;
  closePromotionDialog();
  render();
}

function selectBoardPiece(row, col) {
  const piece = game.getPiece(row, col);
  if (!piece || piece.owner !== game.turn || game.gameOver || isComputerTurn() || aiThinking) return;
  selection = {
    kind: "board",
    from: { row, col },
    moves: game.getLegalMoves().filter((move) => move.kind === "move" && move.from.row === row && move.from.col === col),
  };
  render();
}

function selectHand(type) {
  if (game.gameOver || isComputerTurn() || aiThinking || game.getHand(game.turn, type) <= 0) return;
  selection = {
    kind: "hand",
    type,
    moves: game.getLegalMoves().filter((move) => move.kind === "drop" && move.type === type),
  };
  render();
}

function openPromotionDialog(candidates) {
  pendingPromotion = candidates;
  promotionDialog.hidden = false;
  promoteButton.focus();
}

function closePromotionDialog() {
  pendingPromotion = null;
  promotionDialog.hidden = true;
}

function performMove(candidates) {
  if (candidates.length > 1) {
    openPromotionDialog(candidates);
    return;
  }
  try {
    game.playMove(candidates[0]);
    selection = null;
    render();
  } catch (error) {
    console.warn(`その手は指せません：${error.message}`);
  }
}

function onSquareClick(row, col) {
  if (game.gameOver || isComputerTurn() || aiThinking) return;
  const candidates = movesForSquare(row, col);
  if (candidates.length > 0) {
    performMove(candidates);
    return;
  }

  if (selection?.kind === "board" && selection.from.row === row && selection.from.col === col) {
    clearSelection();
    return;
  }

  if (game.getPiece(row, col)?.owner === game.turn) selectBoardPiece(row, col);
  else clearSelection();
}

function renderHand(player, element) {
  element.replaceChildren();
  const isTurn = game.turn === player && !game.gameOver && !isComputerTurn() && !aiThinking;
  const entries = game.getHandEntries(player);
  if (entries.length === 0) {
    const empty = document.createElement("span");
    empty.className = "hand-empty";
    empty.textContent = "持ち駒なし";
    element.append(empty);
    return;
  }
  for (const { type, count } of entries) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "hand-piece";
    if (selection?.kind === "hand" && selection.type === type) button.classList.add("selected");
    button.disabled = !isTurn;
    button.title = `${TYPE_NAMES_FOR_HAND[type]}を打つ`;
    button.setAttribute("aria-label", `${playerLabel(player)}の${TYPE_NAMES_FOR_HAND[type]}、${count}枚`);
    const glyph = document.createElement("span");
    glyph.className = "hand-glyph";
    glyph.textContent = pieceGlyph(type);
    const countElement = document.createElement("span");
    countElement.className = "hand-count";
    countElement.textContent = String(count);
    button.append(glyph, countElement);
    button.addEventListener("click", () => selectHand(type));
    element.append(button);
  }
}

const TYPE_NAMES_FOR_HAND = {
  R: "飛車", B: "角行", G: "金将", S: "銀将", N: "桂馬", L: "香車", P: "歩兵",
};

function renderBoard() {
  boardElement.replaceChildren();
  const lastMove = game.lastMove;
  const legalDestinationKeys = new Set((selection?.moves || []).map((move) => squareKey(move.to)));

  for (let row = 0; row < 9; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      const square = document.createElement("button");
      square.type = "button";
      square.className = "square";
      square.setAttribute("role", "gridcell");
      square.dataset.row = String(row);
      square.dataset.col = String(col);
      square.setAttribute("aria-label", coordinateLabel(row, col));
      const piece = game.getPiece(row, col);
      const key = `${row},${col}`;
      const destinations = movesForSquare(row, col);
      const isLegalDestination = legalDestinationKeys.has(key);
      const isFusionTarget = destinations.some((move) => move.fusion);
      const isCaptureTarget = destinations.some((move) => (
        move.kind === "move"
        && !move.fusion
        && piece
        && piece.owner !== game.turn
      ));
      const destinationHint = isCaptureTarget ? "駒取り" : isFusionTarget ? "融合" : "移動";
      if (lastMove && squareKey(lastMove.to) === key) square.classList.add("last-move");
      if (selection?.kind === "board" && selection.from.row === row && selection.from.col === col) square.classList.add("selected");
      if (isLegalDestination) {
        square.classList.add("legal");
        if (isFusionTarget) square.classList.add("fusion-target");
        if (isCaptureTarget) square.classList.add("capture-target");
        square.setAttribute("aria-label", `${coordinateLabel(row, col)}、${destinationHint}`);
      }
      if (piece) {
        square.classList.add(piece.owner === PLAYERS.BLACK ? "black-piece" : "white-piece");
        if (piece.promoted) square.classList.add("promoted-piece");
        if (piece.fused) square.classList.add("fused-piece");
        const destinationLabel = isLegalDestination ? `、${destinationHint}` : "";
        square.setAttribute("aria-label", `${coordinateLabel(row, col)}、${pieceAccessibleLabel(piece)}${destinationLabel}`);
        const token = document.createElement("span");
        token.className = "piece-token";
        if (piece.promoted) token.classList.add("promoted-token");
        if (piece.fused) token.classList.add("fused-token");
        const glyph = document.createElement("span");
        glyph.className = "piece-glyph";
        for (const character of pieceGlyph(piece)) {
          const characterElement = document.createElement("span");
          characterElement.className = "piece-character";
          characterElement.textContent = character;
          glyph.append(characterElement);
        }
        token.append(glyph);
        square.append(token);
      }
      square.addEventListener("click", () => onSquareClick(row, col));
      boardElement.append(square);
    }
  }
}

function render() {
  renderBoard();
  renderHand(PLAYERS.BLACK, blackHandElement);
  renderHand(PLAYERS.WHITE, whiteHandElement);
  if (!game.gameOver && isComputerTurn() && !aiThinking) startComputerTurn();
}

function cancelComputerTurn() {
  aiGeneration += 1;
  if (aiTimer !== null) window.clearTimeout(aiTimer);
  aiTimer = null;
  aiThinking = false;
}

function startComputerTurn() {
  if (aiThinking || game.gameOver || !isComputerTurn()) return;
  aiThinking = true;
  const generation = ++aiGeneration;
  render();
  aiTimer = window.setTimeout(() => {
    aiTimer = null;
    if (generation !== aiGeneration || game.gameOver || !isComputerTurn()) {
      aiThinking = false;
      render();
      return;
    }
    const move = computerEngine.chooseMove(game, { difficulty: difficultySelect.value });
    if (move) game.playMove(move);
    selection = null;
    aiThinking = false;
    render();
  }, 450);
}

helpButton.addEventListener("click", () => {
  const isOpening = rulesCard.hidden;
  rulesCard.hidden = !isOpening;
  helpButton.setAttribute("aria-expanded", String(isOpening));
  helpButton.textContent = isOpening ? "ヘルプを閉じる" : "ヘルプ";
});

resetButton.addEventListener("click", () => {
  if (game.moveNumber > 1 && !window.confirm("対局を最初からやり直しますか？")) return;
  cancelComputerTurn();
  game.reset();
  selection = null;
  render();
});

for (const player of [PLAYERS.BLACK, PLAYERS.WHITE]) {
  modeSelects[player].addEventListener("change", () => {
    cancelComputerTurn();
    selection = null;
    render();
  });
}

difficultySelect.addEventListener("change", () => {
  cancelComputerTurn();
  render();
});

promoteButton.addEventListener("click", () => {
  const move = pendingPromotion?.find((candidate) => candidate.promote);
  closePromotionDialog();
  if (move) performMove([move]);
});

keepButton.addEventListener("click", () => {
  const move = pendingPromotion?.find((candidate) => !candidate.promote);
  closePromotionDialog();
  if (move) performMove([move]);
});

promotionDialog.addEventListener("click", (event) => {
  if (event.target === promotionDialog) closePromotionDialog();
});

render();
