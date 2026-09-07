import {
  FusionShogiGame,
  PLAYERS,
  TYPES,
  opposite,
  pieceGlyph,
  pieceName,
  squareKey,
} from "./game.js";

const game = new FusionShogiGame();
const boardElement = document.querySelector("#board");
const blackHandElement = document.querySelector("#black-hand");
const whiteHandElement = document.querySelector("#white-hand");
const resetButton = document.querySelector("#reset-button");
const helpButton = document.querySelector("#help-button");
const rulesCard = document.querySelector("#rules-card");
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
      if (lastMove && squareKey(lastMove.to) === key) square.classList.add("last-move");
      if (selection?.kind === "board" && selection.from.row === row && selection.from.col === col) square.classList.add("selected");
      if (legalDestinationKeys.has(key)) {
        const destinations = movesForSquare(row, col);
        square.classList.add("legal");
        if (destinations.some((move) => move.fusion)) square.classList.add("fusion-target");
        square.setAttribute("aria-label", `${coordinateLabel(row, col)}、${destinations.some((move) => move.fusion) ? "融合" : "移動"}`);
      }
      if (piece) {
        square.classList.add(piece.owner === PLAYERS.BLACK ? "black-piece" : "white-piece");
        if (piece.promoted) square.classList.add("promoted-piece");
        if (piece.fused) square.classList.add("fused-piece");
        const destinationHint = legalDestinationKeys.has(key)
          ? `、${movesForSquare(row, col).some((move) => move.fusion) ? "融合" : "移動"}`
          : "";
        square.setAttribute("aria-label", `${coordinateLabel(row, col)}、${pieceAccessibleLabel(piece)}${destinationHint}`);
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

const PIECE_VALUES = Object.freeze({ K: 20000, R: 900, B: 800, G: 600, S: 500, N: 350, L: 300, P: 100 });
const PROMOTED_VALUES = Object.freeze({ R: 1080, B: 980, G: 600, S: 640, N: 440, L: 390, P: 230 });
const AI_MAX_DEPTH = 3;
const AI_TIME_LIMIT_MS = 700;
const AI_NODE_LIMIT = 24000;
const MATE_SCORE = 1_000_000;
const MATERIAL_WEIGHT = 1.4;
const FUSION_NO_GAIN_PENALTY = 90;
const HANGING_PIECE_WEIGHT = 0.72;
const CHECK_VALUE_BONUS = 25;
const SEARCH_TIMEOUT = Symbol("search-timeout");

let searchDeadline = 0;
let searchedNodes = 0;
let transpositionTable = null;

function capturedValue(piece) {
  if (!piece) return 0;
  if (piece.fused) return piece.components.reduce((total, type) => total + PIECE_VALUES[type], 0);
  return PIECE_VALUES[piece.type] || 0;
}

function movementSignature(movement) {
  // A one-step move in a direction already covered by a sliding move adds no
  // reachable square, so it should not make a fusion look more valuable.
  return `${movement.row},${movement.col}`;
}

function movementProfileFor(position, owner, type) {
  return position.movementProfile({ owner, type, promoted: false, fused: false, components: null });
}

function fusionMovementBenefit(position, piece) {
  if (!piece?.fused || piece.components?.length !== 2) return 0;
  const [sourceType, targetType] = piece.components;
  const sourceProfile = movementProfileFor(position, piece.owner, sourceType);
  const targetProfile = movementProfileFor(position, piece.owner, targetType);
  const unionKeys = new Map();
  for (const movement of [...sourceProfile, ...targetProfile]) {
    unionKeys.set(movementSignature(movement), movement);
  }

  const benefitFromProfile = (profile) => {
    const profileKeys = new Set(profile.map(movementSignature));
    let addedMovements = 0;
    let addedSlidingMovements = 0;
    for (const [key, movement] of unionKeys) {
      if (profileKeys.has(key)) continue;
      addedMovements += 1;
      if (movement.slide) addedSlidingMovements += 1;
    }
    return addedMovements * 22 + addedSlidingMovements * 18;
  };

  const addedValue = Math.min(
    benefitFromProfile(sourceProfile),
    benefitFromProfile(targetProfile),
  );
  return addedValue > 0 ? addedValue : -FUSION_NO_GAIN_PENALTY;
}

function fusionBenefitForMove(position, move) {
  if (!move.fusion) return 0;
  const source = position.getPiece(move.from.row, move.from.col);
  const target = position.getPiece(move.to.row, move.to.col);
  if (!source || !target) return 0;
  return fusionMovementBenefit(position, {
    owner: source.owner,
    fused: true,
    components: [source.type, target.type],
  });
}

function evaluatedPieceValue(position, piece) {
  if (!piece) return 0;
  if (piece.fused) {
    return piece.components.reduce((total, type) => total + PIECE_VALUES[type], 0) + fusionMovementBenefit(position, piece);
  }
  return piece.promoted ? (PROMOTED_VALUES[piece.type] || PIECE_VALUES[piece.type] || 0) : (PIECE_VALUES[piece.type] || 0);
}

function sideSign(player) {
  return player === PLAYERS.BLACK ? 1 : -1;
}

function progressFor(piece, row) {
  return piece.owner === PLAYERS.BLACK ? 8 - row : row;
}

function positionKey(position, depth) {
  return `${depth}:${JSON.stringify(position.toJSON())}`;
}

function checkSearchBudget() {
  searchedNodes += 1;
  if (searchedNodes >= AI_NODE_LIMIT || Date.now() >= searchDeadline) throw SEARCH_TIMEOUT;
}

function moveOrderingScore(position, move) {
  let score = 0;
  if (move.kind === "move") {
    const target = position.getPiece(move.to.row, move.to.col);
    if (target && target.owner !== position.turn) score += capturedValue(target) * 100;
    if (move.fusion) score += 1500 + Math.max(0, fusionBenefitForMove(position, move)) * 15;
    if (move.promote) score += 3500;
  } else {
    score += 500;
  }

  const movingPiece = move.kind === "move" ? position.getPiece(move.from.row, move.from.col) : null;
  if (movingPiece) score += progressFor(movingPiece, move.to.row) * 16;
  const centerDistance = Math.abs(move.to.row - 4) + Math.abs(move.to.col - 4);
  score += Math.max(0, 8 - centerDistance) * 3;
  return score;
}

function orderMoves(position, moves) {
  return [...moves].sort((left, right) => moveOrderingScore(position, right) - moveOrderingScore(position, left));
}

function getLastMovedPiece(position) {
  const square = position.lastMove?.to;
  if (!square) return null;
  const piece = position.getPiece(square.row, square.col);
  return piece ? { piece, square } : null;
}

function evaluatePosition(position, perspective) {
  let score = 0;
  let blackFusionMoves = 0;
  let whiteFusionMoves = 0;
  let blackPromotionMoves = 0;
  let whitePromotionMoves = 0;

  for (let row = 0; row < 9; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      const piece = position.getPiece(row, col);
      if (!piece) continue;
      const sign = sideSign(piece.owner);
      const value = evaluatedPieceValue(position, piece);
      const advancement = progressFor(piece, row);
      const centerDistance = Math.abs(row - 4) + Math.abs(col - 4);
      const activityBonus = Math.max(0, 8 - centerDistance) * (piece.type === "K" ? 1 : 3);
      score += sign * (value * MATERIAL_WEIGHT + advancement * (piece.fused ? 5 : 2) + activityBonus);
    }
  }

  const lastMoved = getLastMovedPiece(position);
  if (lastMoved && lastMoved.piece.type !== TYPES.KING) {
    const { piece, square } = lastMoved;
    const enemyAttacks = position.isSquareAttacked(square, opposite(piece.owner));
    const friendlyDefenses = position.isSquareAttacked(square, piece.owner);
    if (enemyAttacks && !friendlyDefenses) {
      score -= sideSign(piece.owner) * evaluatedPieceValue(position, piece) * HANGING_PIECE_WEIGHT;
    }
  }

  for (const player of [PLAYERS.BLACK, PLAYERS.WHITE]) {
    const sign = sideSign(player);
    for (const [type, count] of position.hands[player === PLAYERS.BLACK ? 0 : 1].entries()) {
      score += sign * count * (PIECE_VALUES[type] || 0) * 0.88 * MATERIAL_WEIGHT;
    }
  }

  const pseudoMoves = {
    [PLAYERS.BLACK]: position.pseudoMoves(PLAYERS.BLACK),
    [PLAYERS.WHITE]: position.pseudoMoves(PLAYERS.WHITE),
  };
  for (const move of pseudoMoves[PLAYERS.BLACK]) {
    if (move.fusion && fusionBenefitForMove(position, move) > 0) blackFusionMoves += 1;
    if (move.promote) blackPromotionMoves += 1;
  }
  for (const move of pseudoMoves[PLAYERS.WHITE]) {
    if (move.fusion && fusionBenefitForMove(position, move) > 0) whiteFusionMoves += 1;
    if (move.promote) whitePromotionMoves += 1;
  }
  score += (pseudoMoves[PLAYERS.BLACK].length - pseudoMoves[PLAYERS.WHITE].length) * 2;
  score += (blackFusionMoves - whiteFusionMoves) * 6;
  score += (blackPromotionMoves - whitePromotionMoves) * 7;
  if (position.isInCheck(PLAYERS.BLACK)) score -= CHECK_VALUE_BONUS;
  if (position.isInCheck(PLAYERS.WHITE)) score += CHECK_VALUE_BONUS;
  if (position.turn === PLAYERS.BLACK) score += 5;
  else score -= 5;

  return perspective === PLAYERS.BLACK ? score : -score;
}

function minimax(position, depth, alpha, beta, perspective) {
  checkSearchBudget();
  const key = positionKey(position, depth);
  const cached = transpositionTable.get(key);
  if (cached !== undefined) return cached;

  const legalMoves = position.getLegalMoves();
  if (legalMoves.length === 0) {
    const terminal = position.isInCheck(position.turn)
      ? (position.turn === perspective ? -MATE_SCORE - depth : MATE_SCORE + depth)
      : 0;
    transpositionTable.set(key, terminal);
    return terminal;
  }
  if (depth <= 0) {
    const evaluated = evaluatePosition(position, perspective);
    transpositionTable.set(key, evaluated);
    return evaluated;
  }

  const maximizing = position.turn === perspective;
  let best = maximizing ? -Infinity : Infinity;
  let cutoff = false;
  for (const move of orderMoves(position, legalMoves)) {
    const next = position.clone();
    next.applyMoveUnchecked(move);
    const score = minimax(next, depth - 1, alpha, beta, perspective);
    if (maximizing) {
      best = Math.max(best, score);
      alpha = Math.max(alpha, best);
    } else {
      best = Math.min(best, score);
      beta = Math.min(beta, best);
    }
    if (beta <= alpha) {
      cutoff = true;
      break;
    }
  }
  if (!cutoff) transpositionTable.set(key, best);
  return best;
}

function searchRoot(position, moves, depth, perspective) {
  let bestMove = moves[0];
  let bestScore = -Infinity;
  let alpha = -Infinity;
  const beta = Infinity;
  for (const move of orderMoves(position, moves)) {
    checkSearchBudget();
    const next = position.clone();
    next.applyMoveUnchecked(move);
    const score = minimax(next, depth - 1, alpha, beta, perspective);
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
    alpha = Math.max(alpha, bestScore);
  }
  return { move: bestMove, score: bestScore };
}

function chooseComputerMove() {
  const legalMoves = game.getLegalMoves();
  if (legalMoves.length === 0) return null;
  if (legalMoves.length === 1) return legalMoves[0];

  searchDeadline = Date.now() + AI_TIME_LIMIT_MS;
  searchedNodes = 0;
  transpositionTable = new Map();
  const perspective = game.turn;
  let bestMove = orderMoves(game, legalMoves)[0];

  for (let depth = 1; depth <= AI_MAX_DEPTH; depth += 1) {
    try {
      bestMove = searchRoot(game, legalMoves, depth, perspective).move;
    } catch (error) {
      if (error !== SEARCH_TIMEOUT) throw error;
      break;
    }
  }
  return bestMove;
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
    const move = chooseComputerMove();
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
