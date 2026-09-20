import {
  PLAYERS,
  TYPES,
  opposite,
} from "../game.js";

export const AI_DEFAULTS = Object.freeze({
  maxDepth: 3,
  timeLimitMs: 700,
  nodeLimit: 24_000,
  quiescenceDepth: 1,
  checkExtensionDepth: 1,
});

export const AI_LEVELS = Object.freeze({
  easy: Object.freeze({ maxDepth: 2, timeLimitMs: 180, nodeLimit: 8_000, quiescenceDepth: 0, checkExtensionDepth: 1 }),
  normal: Object.freeze({ ...AI_DEFAULTS }),
  strong: Object.freeze({ maxDepth: 4, timeLimitMs: 2_500, nodeLimit: 100_000, quiescenceDepth: 2, checkExtensionDepth: 2 }),
});

const PIECE_VALUES = Object.freeze({ K: 20_000, R: 900, B: 800, G: 600, S: 500, N: 350, L: 300, P: 100 });
const PROMOTED_VALUES = Object.freeze({ R: 1_080, B: 980, G: 600, S: 640, N: 440, L: 390, P: 230 });
const HAND_VALUE_FACTOR = 0.88;
const INITIAL_NON_KING_MATERIAL = 12_200;
const POSITION_PROGRESS_VALUES = Object.freeze({
  P: Object.freeze([0, 1, 2, 3, 4, 6, 8, 10, 12]),
  L: Object.freeze([0, 0, 1, 2, 3, 4, 6, 8, 9]),
  N: Object.freeze([0, 0, 1, 3, 5, 7, 8, 8, 6]),
  S: Object.freeze([0, 1, 2, 4, 6, 7, 8, 8, 7]),
  G: Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8]),
  B: Object.freeze([0, 2, 3, 4, 5, 6, 7, 8, 10]),
  R: Object.freeze([0, 2, 3, 5, 6, 7, 8, 9, 11]),
});
const POSITION_CENTER_WEIGHTS = Object.freeze({ P: 1, L: 1, N: 2, S: 2, G: 2, B: 3, R: 3 });
const FUSION_PAIR_BONUS = Object.freeze({
  BB: 10, BG: 18, BL: 12, BN: 8, BP: 3, BR: 34, BS: 16,
  GG: 10, GL: 8, GN: 8, GP: 4, GR: 24, GS: 14,
  LL: 4, LN: 5, LP: 2, LR: 16, LS: 8,
  NN: 4, NP: 2, NR: 12, NS: 6,
  PP: 2, PR: 10, PS: 4,
  RR: 25, RS: 15,
  SS: 10,
});
const KING_NEIGHBORS = Object.freeze([
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1],
  [1, -1], [1, 0], [1, 1],
]);
const MATE_SCORE = 1_000_000;
const MATERIAL_WEIGHT = 1.4;
const FUSION_NO_GAIN_PENALTY = 90;
const HANGING_PIECE_WEIGHT = 0.72;
const CHECK_VALUE_BONUS = 25;
const SEARCH_TIMEOUT = Symbol("search-timeout");
const TT_FLAGS = Object.freeze({
  EXACT: "exact",
  LOWER_BOUND: "lower-bound",
  UPPER_BOUND: "upper-bound",
});

function capturedValue(piece) {
  if (!piece) return 0;
  if (piece.fused) return piece.components.reduce((total, type) => total + PIECE_VALUES[type], 0);
  return piece.promoted
    ? (PROMOTED_VALUES[piece.type] || PIECE_VALUES[piece.type] || 0)
    : (PIECE_VALUES[piece.type] || 0);
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

function pieceMaterialValue(piece) {
  if (!piece) return 0;
  if (piece.fused) {
    return piece.components.reduce((total, type) => total + PIECE_VALUES[type], 0);
  }
  return piece.promoted
    ? (PROMOTED_VALUES[piece.type] || PIECE_VALUES[piece.type] || 0)
    : (PIECE_VALUES[piece.type] || 0);
}

function sideSign(player) {
  return player === PLAYERS.BLACK ? 1 : -1;
}

function progressFor(piece, row) {
  return piece.owner === PLAYERS.BLACK ? 8 - row : row;
}

function normalizedStateForKey(position) {
  const state = position.toJSON();
  state.pieces = state.pieces.map((piece) => piece.fused
    ? { ...piece, components: [...piece.components].sort() }
    : piece);
  return state;
}

export function positionKey(position) {
  return JSON.stringify(normalizedStateForKey(position));
}

function moveKey(move) {
  if (move.kind === "drop") return `drop:${move.type}:${move.to.row},${move.to.col}`;
  return `move:${move.from.row},${move.from.col}:${move.to.row},${move.to.col}:${Boolean(move.promote)}:${Boolean(move.fusion)}`;
}

function isCaptureMove(position, move) {
  if (move.kind !== "move") return false;
  const target = position.getPiece(move.to.row, move.to.col);
  return Boolean(target && target.owner !== position.turn);
}

function isQuietMove(position, move) {
  return move.kind === "drop"
    ? true
    : !isCaptureMove(position, move) && !move.promote && !move.fusion;
}

function historyKey(position, move) {
  return `${position.turn}:${moveKey(move)}`;
}

function isCheckingMove(position, move, context) {
  if (context) context.checksTested += 1;
  const undo = position.makeMove(move);
  try {
    return position.isInCheck(position.turn);
  } finally {
    position.unmakeMove(undo);
  }
}

function moveOrderingScore(position, move, context, ply, preferredKey) {
  let score = 0;
  if (move.kind === "move") {
    const target = position.getPiece(move.to.row, move.to.col);
    const movingPiece = position.getPiece(move.from.row, move.from.col);
    if (target && target.owner !== position.turn) {
      score += 10_000 + capturedValue(target) * 100;
      score -= (movingPiece ? PIECE_VALUES[movingPiece.type] : 0) * 2;
    }
    if (move.fusion) score += 1_500 + Math.max(0, fusionBenefitForMove(position, move)) * 15;
    if (move.promote) score += 3_500;
  } else {
    score += 500;
  }

  const movingPiece = move.kind === "move" ? position.getPiece(move.from.row, move.from.col) : null;
  if (movingPiece) score += progressFor(movingPiece, move.to.row) * 16;
  const centerDistance = Math.abs(move.to.row - 4) + Math.abs(move.to.col - 4);
  score += Math.max(0, 8 - centerDistance) * 3;
  const key = moveKey(move);
  if (key === preferredKey) score += 1_000_000;
  if (context?.killers.get(ply)?.includes(key)) score += 5_000;
  score += Math.min(4_000, context?.history.get(historyKey(position, move)) || 0);
  return score;
}

function orderMoves(
  position,
  moves,
  context = null,
  ply = 0,
  preferredMove = null,
  includeChecks = false,
  checkingMoves = null,
) {
  const preferredKey = preferredMove ? moveKey(preferredMove) : null;
  return [...moves]
    .map((move) => {
      let score = moveOrderingScore(position, move, context, ply, preferredKey);
      if (includeChecks) {
        const checking = checkingMoves ? checkingMoves.has(moveKey(move)) : isCheckingMove(position, move, context);
        if (checking) score += 6_000;
      }
      return { move, score };
    })
    .sort((left, right) => right.score - left.score)
    .map(({ move }) => move);
}

function squareIndex(row, col) {
  return row * 9 + col;
}

function oppositeMapKey(player) {
  return player === PLAYERS.BLACK ? PLAYERS.WHITE : PLAYERS.BLACK;
}

function buildEvaluationFeatures(position) {
  const attackMaps = {
    [PLAYERS.BLACK]: new Array(81).fill(0),
    [PLAYERS.WHITE]: new Array(81).fill(0),
  };
  const kings = {
    [PLAYERS.BLACK]: position.findKing(PLAYERS.BLACK),
    [PLAYERS.WHITE]: position.findKing(PLAYERS.WHITE),
  };
  let remainingMaterial = 0;

  for (let row = 0; row < 9; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      const piece = position.getPiece(row, col);
      if (!piece) continue;
      if (piece.fused) {
        remainingMaterial += piece.components.reduce((total, type) => total + PIECE_VALUES[type], 0);
      } else if (piece.type !== TYPES.KING) {
        remainingMaterial += PIECE_VALUES[piece.type] || 0;
      }
      for (const target of position.getAttackSquares({ row, col }, piece)) {
        attackMaps[piece.owner][squareIndex(target.row, target.col)] += 1;
      }
    }
  }

  for (const player of [PLAYERS.BLACK, PLAYERS.WHITE]) {
    for (const [type, count] of position.hands[playerIndexForEvaluation(player)].entries()) {
      remainingMaterial += (PIECE_VALUES[type] || 0) * count;
    }
  }

  const materialPhase = Math.min(1, remainingMaterial / INITIAL_NON_KING_MATERIAL);
  return {
    attackMaps,
    kings,
    materialPhase,
    endgamePhase: 1 - materialPhase,
  };
}

function playerIndexForEvaluation(player) {
  return player === PLAYERS.BLACK ? 0 : 1;
}

function attackCount(features, player, row, col) {
  return features.attackMaps[player][squareIndex(row, col)] || 0;
}

function controlledSquareCount(features, player) {
  return features.attackMaps[player].reduce((count, attacks) => count + (attacks > 0 ? 1 : 0), 0);
}

function fusionPairKey(left, right) {
  return [left, right].sort().join("");
}

function fusionPairBonus(left, right) {
  return FUSION_PAIR_BONUS[fusionPairKey(left, right)] || 0;
}

function pieceSquareBonus(piece, row, col, endgamePhase) {
  const center = Math.max(0, 4 - Math.abs(col - 4));
  if (piece.type === TYPES.KING) {
    const centerValue = center * (2 + endgamePhase * 10);
    const backRankSafety = progressFor(piece, row) === 0 ? (1 - endgamePhase) * 5 : 0;
    return centerValue + backRankSafety;
  }

  const components = piece.fused ? piece.components : [piece.type];
  const progressBonus = components.reduce(
    (total, type) => total + (POSITION_PROGRESS_VALUES[type]?.[progressFor(piece, row)] || 0),
    0,
  ) / components.length;
  const centerWeight = components.reduce((total, type) => total + (POSITION_CENTER_WEIGHTS[type] || 0), 0)
    / components.length;
  return progressBonus + center * centerWeight;
}

function actualMobility(position, row, col, piece) {
  return position.getAttackSquares({ row, col }, piece).length;
}

function fusionPieceBonus(position, piece, row, col, features) {
  if (!piece.fused || piece.components?.length !== 2) return 0;
  const [left, right] = piece.components;
  const sourceMobility = actualMobility(position, row, col, {
    owner: piece.owner,
    type: left,
    promoted: false,
    fused: false,
    components: null,
  });
  const targetMobility = actualMobility(position, row, col, {
    owner: piece.owner,
    type: right,
    promoted: false,
    fused: false,
    components: null,
  });
  const fusedMobility = actualMobility(position, row, col, piece);
  const mobilityGain = Math.max(0, fusedMobility - Math.max(sourceMobility, targetMobility));
  const enemy = oppositeMapKey(piece.owner);
  const enemyAttacks = attackCount(features, enemy, row, col);
  const friendlyDefenses = attackCount(features, piece.owner, row, col);
  const safety = enemyAttacks > friendlyDefenses
    ? -(enemyAttacks - friendlyDefenses) * 14
    : Math.min(12, friendlyDefenses * 2);
  return fusionMovementBenefit(position, piece) * 0.45
    + fusionPairBonus(left, right)
    + mobilityGain * 3
    + safety;
}

function kingSafetyScore(position, player, features) {
  const king = features.kings[player];
  if (!king) return -MATE_SCORE / 2;
  const enemy = oppositeMapKey(player);
  const enemyAtKing = attackCount(features, enemy, king.row, king.col);
  let safeEscapes = 0;
  let attackedEscapes = 0;
  let ownShield = 0;
  let enemyRingPressure = 0;

  for (const [rowDelta, colDelta] of KING_NEIGHBORS) {
    const row = king.row + rowDelta;
    const col = king.col + colDelta;
    if (row < 0 || row >= 9 || col < 0 || col >= 9) continue;
    const occupant = position.getPiece(row, col);
    const enemyAttacks = attackCount(features, enemy, row, col);
    enemyRingPressure += enemyAttacks;
    if (occupant?.owner === player) {
      ownShield += 1;
    } else if (enemyAttacks === 0) {
      safeEscapes += 1;
    } else {
      attackedEscapes += 1;
    }
  }

  const distanceFromCenter = Math.abs(king.row - 4) + Math.abs(king.col - 4);
  const center = Math.max(0, 4 - Math.ceil(distanceFromCenter / 2));
  return -enemyAtKing * 150
    + safeEscapes * (14 + features.endgamePhase * 8)
    - attackedEscapes * 5
    + ownShield * (3 + features.materialPhase * 7)
    - enemyRingPressure * 3
    + center * features.endgamePhase * 8;
}

function handDropScore(position, player, type, count, features) {
  const enemyKing = features.kings[oppositeMapKey(player)];
  const virtualPiece = {
    owner: player,
    type,
    promoted: false,
    fused: false,
    components: null,
  };
  let dropSquares = 0;
  let checkingDrops = 0;
  let centrality = 0;
  for (let row = 0; row < 9; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      if (!position.canDrop(type, player, row, col)) continue;
      dropSquares += 1;
      centrality += Math.max(0, 8 - Math.abs(row - 4) - Math.abs(col - 4));
      if (enemyKing && position.attacksSquare({ row, col }, enemyKing, virtualPiece)) checkingDrops += 1;
    }
  }
  const base = (PIECE_VALUES[type] || 0) * HAND_VALUE_FACTOR;
  return count * (base + dropSquares * 0.45 + checkingDrops * 18 + centrality * 0.05);
}

function fusionOpportunityScore(position, player, features) {
  let score = 0;
  let count = 0;
  for (let row = 0; row < 9; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      const source = position.getPiece(row, col);
      if (!source || source.owner !== player || source.type === TYPES.KING
        || source.promoted || source.fused) continue;
      for (const targetSquare of position.getAttackSquares({ row, col }, source)) {
        const target = position.getPiece(targetSquare.row, targetSquare.col);
        if (!position.isFusionCandidate(source, target)) continue;
        const movementBenefit = fusionMovementBenefit(position, {
          owner: player,
          fused: true,
          components: [source.type, target.type],
        });
        const enemyAttacks = attackCount(features, oppositeMapKey(player), targetSquare.row, targetSquare.col);
        const friendlyDefenses = attackCount(features, player, targetSquare.row, targetSquare.col);
        let opportunity = movementBenefit * 0.35 + fusionPairBonus(source.type, target.type);
        if (enemyAttacks > friendlyDefenses) opportunity -= (enemyAttacks - friendlyDefenses) * 12;
        if (opportunity > 0) {
          score += opportunity;
          count += 1;
        } else {
          score += opportunity * 0.2;
        }
      }
    }
  }
  return { score, count };
}

export function evaluatePosition(position, perspective, { fast = false } = {}) {
  const features = buildEvaluationFeatures(position);
  let score = 0;
  let blackPromotionMoves = 0;
  let whitePromotionMoves = 0;

  for (let row = 0; row < 9; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      const piece = position.getPiece(row, col);
      if (!piece) continue;
      const sign = sideSign(piece.owner);
      let value = pieceMaterialValue(piece) * MATERIAL_WEIGHT;
      value += pieceSquareBonus(piece, row, col, features.endgamePhase);
      value += fusionPieceBonus(position, piece, row, col, features);

      if (piece.type !== TYPES.KING) {
        const enemyAttacks = attackCount(features, oppositeMapKey(piece.owner), row, col);
        const friendlyDefenses = attackCount(features, piece.owner, row, col);
        if (enemyAttacks > friendlyDefenses) {
          const riskFactor = Math.min(0.45, HANGING_PIECE_WEIGHT * 0.3 + (enemyAttacks - friendlyDefenses) * 0.08);
          value -= pieceMaterialValue(piece) * riskFactor;
        } else if (friendlyDefenses > 0) {
          value += Math.min(16, pieceMaterialValue(piece) * friendlyDefenses * 0.012);
        }
      }
      score += sign * value;
    }
  }

  for (const player of [PLAYERS.BLACK, PLAYERS.WHITE]) {
    const sign = sideSign(player);
    score += sign * kingSafetyScore(position, player, features);
    for (const [type, count] of position.hands[playerIndexForEvaluation(player)].entries()) {
      const handValue = fast
        ? count * (PIECE_VALUES[type] || 0) * HAND_VALUE_FACTOR
        : handDropScore(position, player, type, count, features);
      score += sign * handValue * MATERIAL_WEIGHT;
    }
  }

  if (!fast) {
    const blackFusion = fusionOpportunityScore(position, PLAYERS.BLACK, features);
    const whiteFusion = fusionOpportunityScore(position, PLAYERS.WHITE, features);
    score += (blackFusion.score - whiteFusion.score) * 0.8;
    score += (blackFusion.count - whiteFusion.count) * 3;
  }

  const blackMobility = controlledSquareCount(features, PLAYERS.BLACK);
  const whiteMobility = controlledSquareCount(features, PLAYERS.WHITE);
  score += (blackMobility - whiteMobility) * (1.5 + features.endgamePhase);

  const blackKing = features.kings[PLAYERS.BLACK];
  const whiteKing = features.kings[PLAYERS.WHITE];
  if (blackKing && attackCount(features, PLAYERS.WHITE, blackKing.row, blackKing.col) > 0) score -= CHECK_VALUE_BONUS;
  if (whiteKing && attackCount(features, PLAYERS.BLACK, whiteKing.row, whiteKing.col) > 0) score += CHECK_VALUE_BONUS;

  if (!fast) {
    const pseudoMoves = {
      [PLAYERS.BLACK]: position.pseudoMoves(PLAYERS.BLACK),
      [PLAYERS.WHITE]: position.pseudoMoves(PLAYERS.WHITE),
    };
    for (const move of pseudoMoves[PLAYERS.BLACK]) if (move.promote) blackPromotionMoves += 1;
    for (const move of pseudoMoves[PLAYERS.WHITE]) if (move.promote) whitePromotionMoves += 1;
    score += (pseudoMoves[PLAYERS.BLACK].length - pseudoMoves[PLAYERS.WHITE].length) * 1.5;
    score += (blackPromotionMoves - whitePromotionMoves) * 7;
  }

  if (position.turn === PLAYERS.BLACK) score += 5;
  else score -= 5;
  return perspective === PLAYERS.BLACK ? score : -score;
}

function checkSearchBudget(context) {
  context.searchedNodes += 1;
  if (context.searchedNodes >= context.nodeLimit) {
    context.stopReason = "node-limit";
    throw SEARCH_TIMEOUT;
  }
  if (Date.now() >= context.deadline) {
    context.stopReason = "time-limit";
    throw SEARCH_TIMEOUT;
  }
}

function terminalScore(position, perspective, depth = 0) {
  if (!position.isInCheck(position.turn)) return 0;
  return position.turn === perspective ? -MATE_SCORE - depth : MATE_SCORE + depth;
}

function tacticalMoves(position, context, checkingMoves = null) {
  const player = position.turn;
  const candidates = [];
  for (const move of position.pseudoMoves(player)) {
    const obviousTacticalMove = isCaptureMove(position, move) || move.promote || move.fusion;
    const undo = position.makeMove(move);
    try {
      if (position.isInCheck(player)) continue;
      const checking = position.isInCheck(position.turn);
      const pawnDropMate = checking
        && move.kind === "drop"
        && move.type === TYPES.PAWN
        && position.isPawnDropMate(move, position.turn);
      if (!pawnDropMate && (obviousTacticalMove || checking)) {
        if (checking) checkingMoves?.add(moveKey(move));
        candidates.push(move);
      }
    } finally {
      position.unmakeMove(undo);
    }
  }
  return candidates;
}

function quiescence(position, alpha, beta, perspective, context, ply, remaining, checkRemaining) {
  checkSearchBudget(context);
  context.quiescenceNodes += 1;
  const inCheck = position.isInCheck(position.turn);
  const legalMoves = inCheck ? position.getLegalMoves() : null;
  if (inCheck && legalMoves.length === 0) return terminalScore(position, perspective);

  const maximizing = position.turn === perspective;
  const standPat = evaluatePosition(position, perspective, { fast: true });
  if (!inCheck && remaining <= 0) return standPat;

  if (inCheck && checkRemaining <= 0) {
    let best = maximizing ? -Infinity : Infinity;
    for (const move of orderMoves(position, legalMoves, context, ply, null, false)) {
      const undo = position.makeMove(move);
      let score;
      try {
        score = evaluatePosition(position, perspective, { fast: true });
      } finally {
        position.unmakeMove(undo);
      }
      if (maximizing) {
        best = Math.max(best, score);
        alpha = Math.max(alpha, best);
      } else {
        best = Math.min(best, score);
        beta = Math.min(beta, best);
      }
      if (beta <= alpha) break;
    }
    return best;
  }

  let best = inCheck ? (maximizing ? -Infinity : Infinity) : standPat;
  if (!inCheck) {
    if (maximizing) {
      if (standPat >= beta) return standPat;
      alpha = Math.max(alpha, standPat);
    } else {
      if (standPat <= alpha) return standPat;
      beta = Math.min(beta, standPat);
    }
  }

  const checkingMoves = new Set();
  const candidates = inCheck
    ? legalMoves
    : tacticalMoves(position, context, checkingMoves);
  if (!inCheck && candidates.length === 0) return best;
  const nextRemaining = Math.max(0, remaining - 1);
  const nextCheckRemaining = inCheck ? checkRemaining - 1 : checkRemaining;
  for (const move of orderMoves(position, candidates, context, ply, null, !inCheck, checkingMoves)) {
    const undo = position.makeMove(move);
    let score;
    try {
      score = quiescence(
        position,
        alpha,
        beta,
        perspective,
        context,
        ply + 1,
        nextRemaining,
        nextCheckRemaining,
      );
    } finally {
      position.unmakeMove(undo);
    }
    if (maximizing) {
      best = Math.max(best, score);
      alpha = Math.max(alpha, best);
    } else {
      best = Math.min(best, score);
      beta = Math.min(beta, best);
    }
    if (beta <= alpha) break;
  }
  return best;
}

function lookupTransposition(context, key, depth, alpha, beta) {
  const entry = context.transpositionTable.get(key);
  if (!entry || entry.depth < depth) return { entry, alpha, beta, score: undefined };

  context.transpositionHits += 1;
  if (entry.flag === TT_FLAGS.EXACT) return { entry, alpha, beta, score: entry.score };
  if (entry.flag === TT_FLAGS.LOWER_BOUND) alpha = Math.max(alpha, entry.score);
  if (entry.flag === TT_FLAGS.UPPER_BOUND) beta = Math.min(beta, entry.score);
  if (alpha >= beta) {
    context.transpositionCutoffs += 1;
    return { entry, alpha, beta, score: entry.score };
  }
  return { entry, alpha, beta, score: undefined };
}

function storeTransposition(context, key, depth, score, alpha, beta, bestMove) {
  const flag = score <= alpha
    ? TT_FLAGS.UPPER_BOUND
    : score >= beta
      ? TT_FLAGS.LOWER_BOUND
      : TT_FLAGS.EXACT;
  context.transpositionTable.set(key, {
    depth,
    score,
    flag,
    bestMove,
  });
}

function recordCutoff(context, position, move, depth, ply) {
  if (!isQuietMove(position, move)) return;
  const key = moveKey(move);
  const killers = context.killers.get(ply) || [];
  if (!killers.includes(key)) {
    killers.unshift(key);
    if (killers.length > 2) killers.pop();
    context.killers.set(ply, killers);
  }
  const history = historyKey(position, move);
  context.history.set(history, Math.min(100_000, (context.history.get(history) || 0) + depth * depth * 32));
}

function minimax(position, depth, alpha, beta, perspective, context, ply = 0) {
  checkSearchBudget(context);
  const key = positionKey(position);
  const alphaStart = alpha;
  const betaStart = beta;
  const lookup = lookupTransposition(context, key, depth, alpha, beta);
  if (lookup.score !== undefined) return lookup.score;
  alpha = lookup.alpha;
  beta = lookup.beta;

  const legalMoves = position.getLegalMoves();
  if (legalMoves.length === 0) {
    const terminal = terminalScore(position, perspective, depth);
    context.transpositionTable.set(key, {
      depth,
      score: terminal,
      flag: TT_FLAGS.EXACT,
      bestMove: null,
    });
    return terminal;
  }
  if (depth <= 0) {
    return quiescence(
      position,
      alpha,
      beta,
      perspective,
      context,
      ply,
      context.quiescenceDepth,
      context.checkExtensionDepth,
    );
  }

  const maximizing = position.turn === perspective;
  let best = maximizing ? -Infinity : Infinity;
  let bestMove = null;
  let cutoff = false;
  const includeChecks = ply <= context.checkOrderDepth;
  for (const move of orderMoves(position, legalMoves, context, ply, lookup.entry?.bestMove, includeChecks)) {
    const undo = position.makeMove(move);
    let score;
    try {
      score = minimax(position, depth - 1, alpha, beta, perspective, context, ply + 1);
    } finally {
      position.unmakeMove(undo);
    }
    if (maximizing) {
      if (score > best) {
        best = score;
        bestMove = move;
      }
      alpha = Math.max(alpha, best);
    } else {
      if (score < best) {
        best = score;
        bestMove = move;
      }
      beta = Math.min(beta, best);
    }
    if (beta <= alpha) {
      context.betaCutoffs += 1;
      recordCutoff(context, position, move, depth, ply);
      cutoff = true;
      break;
    }
  }
  if (!cutoff || bestMove) storeTransposition(context, key, depth, best, alphaStart, betaStart, bestMove);
  return best;
}

function searchRoot(position, moves, depth, perspective, context) {
  let bestMove = moves[0];
  let bestScore = -Infinity;
  let alpha = -Infinity;
  const beta = Infinity;
  const rootKey = positionKey(position);
  const rootEntry = context.transpositionTable.get(rootKey);
  for (const move of orderMoves(position, moves, context, 0, rootEntry?.bestMove, true)) {
    checkSearchBudget(context);
    const undo = position.makeMove(move);
    let score;
    try {
      score = minimax(position, depth - 1, alpha, beta, perspective, context, 1);
    } finally {
      position.unmakeMove(undo);
    }
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
    alpha = Math.max(alpha, bestScore);
  }
  context.transpositionTable.set(rootKey, {
    depth,
    score: bestScore,
    flag: TT_FLAGS.EXACT,
    bestMove,
  });
  return { move: bestMove, score: bestScore };
}

function resolveOptions(overrides = {}) {
  const levelOptions = overrides.difficulty ? AI_LEVELS[overrides.difficulty] : null;
  const options = { ...AI_DEFAULTS, ...(levelOptions || {}), ...overrides };
  const integerOption = (value, fallback) => Number.isFinite(Number(value)) ? Math.floor(Number(value)) : fallback;
  return {
    maxDepth: Math.max(1, integerOption(options.maxDepth, AI_DEFAULTS.maxDepth)),
    timeLimitMs: Math.max(1, integerOption(options.timeLimitMs, AI_DEFAULTS.timeLimitMs)),
    nodeLimit: Math.max(1, integerOption(options.nodeLimit, AI_DEFAULTS.nodeLimit)),
    quiescenceDepth: Math.max(0, integerOption(options.quiescenceDepth, AI_DEFAULTS.quiescenceDepth)),
    checkExtensionDepth: Math.max(0, integerOption(options.checkExtensionDepth, AI_DEFAULTS.checkExtensionDepth)),
  };
}

function baseStats(options, startedAt) {
  return {
    maxDepth: options.maxDepth,
    timeLimitMs: options.timeLimitMs,
    nodeLimit: options.nodeLimit,
    quiescenceDepth: options.quiescenceDepth,
    checkExtensionDepth: options.checkExtensionDepth,
    completedDepth: 0,
    searchedNodes: 0,
    quiescenceNodes: 0,
    checksTested: 0,
    betaCutoffs: 0,
    transpositionHits: 0,
    transpositionCutoffs: 0,
    transpositionSize: 0,
    legalMoves: 0,
    score: null,
    moveKey: null,
    stopReason: "completed",
    timeMs: Date.now() - startedAt,
  };
}

export class ComputerEngine {
  constructor(options = {}) {
    this.options = { ...options };
    this.lastSearchStats = null;
  }

  chooseMove(position, overrides = {}) {
    const options = resolveOptions({ ...this.options, ...overrides });
    const startedAt = Date.now();
    const legalMoves = position.getLegalMoves();
    const context = {
      deadline: startedAt + options.timeLimitMs,
      nodeLimit: options.nodeLimit,
      searchedNodes: 0,
      quiescenceNodes: 0,
      checksTested: 0,
      betaCutoffs: 0,
      transpositionHits: 0,
      transpositionCutoffs: 0,
      transpositionTable: new Map(),
      killers: new Map(),
      history: new Map(),
      checkOrderDepth: 1,
      quiescenceDepth: options.quiescenceDepth,
      checkExtensionDepth: options.checkExtensionDepth,
      stopReason: "completed",
    };

    if (legalMoves.length === 0) {
      const stats = baseStats(options, startedAt);
      stats.legalMoves = 0;
      stats.searchedNodes = context.searchedNodes;
      this.lastSearchStats = stats;
      return null;
    }

    let bestMove = orderMoves(position, legalMoves, context, 0)[0];
    let bestScore = null;
    let completedDepth = 0;
    if (legalMoves.length > 1) {
      const perspective = position.turn;
      for (let depth = 1; depth <= options.maxDepth; depth += 1) {
        try {
          const result = searchRoot(position, legalMoves, depth, perspective, context);
          bestMove = result.move;
          bestScore = result.score;
          completedDepth = depth;
        } catch (error) {
          if (error !== SEARCH_TIMEOUT) throw error;
          break;
        }
      }
    }

    const stats = baseStats(options, startedAt);
    stats.completedDepth = completedDepth;
    stats.searchedNodes = context.searchedNodes;
    stats.quiescenceNodes = context.quiescenceNodes;
    stats.checksTested = context.checksTested;
    stats.betaCutoffs = context.betaCutoffs;
    stats.transpositionHits = context.transpositionHits;
    stats.transpositionCutoffs = context.transpositionCutoffs;
    stats.transpositionSize = context.transpositionTable.size;
    stats.legalMoves = legalMoves.length;
    stats.score = bestScore;
    stats.moveKey = moveKey(bestMove);
    stats.stopReason = context.stopReason;
    stats.timeMs = Date.now() - startedAt;
    this.lastSearchStats = stats;
    return bestMove;
  }

  getLastSearchStats() {
    return this.lastSearchStats ? { ...this.lastSearchStats } : null;
  }
}

export function chooseComputerMove(position, options = {}) {
  const engine = new ComputerEngine(options);
  return engine.chooseMove(position);
}
