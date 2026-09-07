export const BOARD_SIZE = 9;

export const PLAYERS = Object.freeze({
  BLACK: "black",
  WHITE: "white",
});

export const TYPES = Object.freeze({
  KING: "K",
  ROOK: "R",
  BISHOP: "B",
  GOLD: "G",
  SILVER: "S",
  KNIGHT: "N",
  LANCE: "L",
  PAWN: "P",
});

const PROMOTABLE_TYPES = new Set([
  TYPES.ROOK,
  TYPES.BISHOP,
  TYPES.SILVER,
  TYPES.KNIGHT,
  TYPES.LANCE,
  TYPES.PAWN,
]);

const HAND_ORDER = [
  TYPES.ROOK,
  TYPES.BISHOP,
  TYPES.GOLD,
  TYPES.SILVER,
  TYPES.KNIGHT,
  TYPES.LANCE,
  TYPES.PAWN,
];

const GLYPHS = Object.freeze({
  K: "王将",
  R: "飛車",
  B: "角行",
  G: "金将",
  S: "銀将",
  N: "桂馬",
  L: "香車",
  P: "歩兵",
  "+R": "龍王",
  "+B": "龍馬",
  "+S": "成銀",
  "+N": "成桂",
  "+L": "成香",
  "+P": "と金",
});

const TYPE_NAMES = Object.freeze({ ...GLYPHS });

const FUSION_STRENGTH = Object.freeze({
  P: 0,
  L: 1,
  N: 2,
  S: 3,
  G: 4,
  B: 5,
  R: 6,
});

const ORTHOGONAL = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAGONAL = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

function opposite(player) {
  return player === PLAYERS.BLACK ? PLAYERS.WHITE : PLAYERS.BLACK;
}

function forward(player) {
  return player === PLAYERS.BLACK ? -1 : 1;
}

function inBounds(row, col) {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

function sameSquare(a, b) {
  return a.row === b.row && a.col === b.col;
}

function squareKey(square) {
  return `${square.row},${square.col}`;
}

function clonePiece(piece) {
  return piece ? {
    owner: piece.owner,
    type: piece.type,
    promoted: Boolean(piece.promoted),
    fused: Boolean(piece.fused),
    components: piece.components ? [...piece.components] : null,
  } : null;
}

function emptyBoard() {
  return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
}

function normalizeHands(hands = {}) {
  return [PLAYERS.BLACK, PLAYERS.WHITE].map((player) => {
    const source = hands[player] || {};
    const hand = new Map();
    for (const type of HAND_ORDER) {
      const count = Number(source[type] || 0);
      if (count > 0) hand.set(type, Math.floor(count));
    }
    return hand;
  });
}

function playerIndex(player) {
  return player === PLAYERS.BLACK ? 0 : 1;
}

function profileForType(type, player) {
  const f = forward(player);
  const step = (vectors) => vectors.map(([row, col]) => ({ row, col, slide: false }));
  const slide = (vectors) => vectors.map(([row, col]) => ({ row, col, slide: true }));

  switch (type) {
    case TYPES.PAWN:
      return step([[f, 0]]);
    case TYPES.LANCE:
      return slide([[f, 0]]);
    case TYPES.KNIGHT:
      return step([[2 * f, -1], [2 * f, 1]]);
    case TYPES.SILVER:
      return step([[f, -1], [f, 0], [f, 1], [-f, -1], [-f, 1]]);
    case TYPES.GOLD:
      return step([[f, -1], [f, 0], [f, 1], [0, -1], [0, 1], [-f, 0]]);
    case TYPES.BISHOP:
      return slide(DIAGONAL);
    case TYPES.ROOK:
      return slide(ORTHOGONAL);
    case TYPES.KING:
      return step([...ORTHOGONAL, ...DIAGONAL]);
    default:
      return [];
  }
}

export function pieceGlyph(pieceOrType, promoted = false) {
  if (!pieceOrType) return "";
  if (typeof pieceOrType === "string") return GLYPHS[promoted ? `+${pieceOrType}` : pieceOrType] || pieceOrType;
  if (pieceOrType.fused) {
    return [...(pieceOrType.components || [])]
      .sort((left, right) => FUSION_STRENGTH[left] - FUSION_STRENGTH[right])
      .map((type) => GLYPHS[type]?.[0] || type)
      .join("");
  }
  return GLYPHS[pieceOrType.promoted ? `+${pieceOrType.type}` : pieceOrType.type] || pieceOrType.type;
}

export function pieceName(piece) {
  if (!piece) return "";
  if (piece.fused) return `融合駒（${[...piece.components].sort((left, right) => FUSION_STRENGTH[left] - FUSION_STRENGTH[right]).map((type) => TYPE_NAMES[type]).join("＋")}）`;
  return pieceGlyph(piece);
}

export function createPiece(owner, type, options = {}) {
  return {
    owner,
    type,
    promoted: Boolean(options.promoted),
    fused: Boolean(options.fused),
    components: options.components ? [...options.components] : null,
  };
}

export class FusionShogiGame {
  constructor(state = null) {
    this.turn = PLAYERS.BLACK;
    this.board = emptyBoard();
    this.hands = normalizeHands();
    this.gameOver = false;
    this.result = null;
    this.lastMove = null;
    this.moveNumber = 1;

    if (state) {
      this.loadState(state);
    } else {
      this.reset();
    }
  }

  reset() {
    this.board = emptyBoard();
    this.hands = normalizeHands();
    this.turn = PLAYERS.BLACK;
    this.gameOver = false;
    this.result = null;
    this.lastMove = null;
    this.moveNumber = 1;

    const backRank = [TYPES.LANCE, TYPES.KNIGHT, TYPES.SILVER, TYPES.GOLD, TYPES.KING, TYPES.GOLD, TYPES.SILVER, TYPES.KNIGHT, TYPES.LANCE];
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      this.board[8][col] = createPiece(PLAYERS.BLACK, backRank[col]);
      this.board[0][col] = createPiece(PLAYERS.WHITE, backRank[col]);
      this.board[6][col] = createPiece(PLAYERS.BLACK, TYPES.PAWN);
      this.board[2][col] = createPiece(PLAYERS.WHITE, TYPES.PAWN);
    }
    this.board[7][1] = createPiece(PLAYERS.BLACK, TYPES.BISHOP);
    this.board[7][7] = createPiece(PLAYERS.BLACK, TYPES.ROOK);
    this.board[1][1] = createPiece(PLAYERS.WHITE, TYPES.ROOK);
    this.board[1][7] = createPiece(PLAYERS.WHITE, TYPES.BISHOP);
  }

  loadState(state) {
    this.board = emptyBoard();
    for (const item of state.pieces || []) {
      if (!inBounds(item.row, item.col)) throw new Error("Piece position is outside the board");
      this.board[item.row][item.col] = createPiece(item.owner, item.type, item);
    }
    this.hands = normalizeHands(state.hands);
    this.turn = state.turn || PLAYERS.BLACK;
    this.gameOver = false;
    this.result = null;
    this.lastMove = null;
    this.moveNumber = 1;
  }

  clone() {
    const copy = Object.create(FusionShogiGame.prototype);
    copy.turn = this.turn;
    copy.board = this.board.map((row) => row.map(clonePiece));
    copy.hands = this.hands.map((hand) => new Map(hand));
    copy.gameOver = this.gameOver;
    copy.result = this.result ? { ...this.result } : null;
    copy.lastMove = this.lastMove ? JSON.parse(JSON.stringify(this.lastMove)) : null;
    copy.moveNumber = this.moveNumber;
    return copy;
  }

  toJSON() {
    const pieces = [];
    for (let row = 0; row < BOARD_SIZE; row += 1) {
      for (let col = 0; col < BOARD_SIZE; col += 1) {
        const piece = this.board[row][col];
        if (piece) pieces.push({ row, col, ...clonePiece(piece) });
      }
    }
    const hands = {};
    for (const player of [PLAYERS.BLACK, PLAYERS.WHITE]) {
      hands[player] = Object.fromEntries(this.hands[playerIndex(player)]);
    }
    return { pieces, hands, turn: this.turn };
  }

  getPiece(row, col) {
    return inBounds(row, col) ? this.board[row][col] : null;
  }

  getHand(player, type) {
    return this.hands[playerIndex(player)].get(type) || 0;
  }

  getHandEntries(player) {
    const hand = this.hands[playerIndex(player)];
    return HAND_ORDER.filter((type) => hand.has(type)).map((type) => ({ type, count: hand.get(type) }));
  }

  isPromotionZone(player, row) {
    return player === PLAYERS.BLACK ? row <= 2 : row >= 6;
  }

  canPromote(piece) {
    return Boolean(piece && !piece.fused && !piece.promoted && PROMOTABLE_TYPES.has(piece.type));
  }

  promotionOptions(piece, from, to) {
    if (!this.canPromote(piece)) return [false];
    const zone = this.isPromotionZone(piece.owner, from.row) || this.isPromotionZone(piece.owner, to.row);
    if (!zone) return [false];
    const forced = (piece.type === TYPES.PAWN || piece.type === TYPES.LANCE)
      ? (piece.owner === PLAYERS.BLACK ? to.row === 0 : to.row === 8)
      : piece.type === TYPES.KNIGHT
        ? (piece.owner === PLAYERS.BLACK ? to.row <= 1 : to.row >= 7)
        : false;
    return forced ? [true] : [false, true];
  }

  movementProfile(piece) {
    if (piece.fused) {
      const seen = new Set();
      return piece.components.flatMap((type) => profileForType(type, piece.owner))
        .filter((movement) => {
          const key = `${movement.row},${movement.col},${movement.slide}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
    }
    if (piece.promoted && [TYPES.PAWN, TYPES.LANCE, TYPES.KNIGHT, TYPES.SILVER].includes(piece.type)) {
      return profileForType(TYPES.GOLD, piece.owner);
    }
    if (piece.promoted && piece.type === TYPES.BISHOP) {
      return [...profileForType(TYPES.BISHOP, piece.owner), ...profileForType(TYPES.KING, piece.owner)
        .filter(({ row, col }) => row === 0 || col === 0)];
    }
    if (piece.promoted && piece.type === TYPES.ROOK) {
      return [...profileForType(TYPES.ROOK, piece.owner), ...profileForType(TYPES.KING, piece.owner)
        .filter(({ row, col }) => row !== 0 && col !== 0)];
    }
    return profileForType(piece.type, piece.owner);
  }

  getAttackSquares(from, piece = this.getPiece(from.row, from.col)) {
    if (!piece) return [];
    const squares = [];
    for (const movement of this.movementProfile(piece)) {
      let row = from.row + movement.row;
      let col = from.col + movement.col;
      while (inBounds(row, col)) {
        squares.push({ row, col });
        if (!movement.slide || this.board[row][col]) break;
        row += movement.row;
        col += movement.col;
      }
    }
    return squares;
  }

  attacksSquare(from, to, piece = this.getPiece(from.row, from.col)) {
    return this.getAttackSquares(from, piece).some((square) => sameSquare(square, to));
  }

  isSquareAttacked(square, byPlayer) {
    for (let row = 0; row < BOARD_SIZE; row += 1) {
      for (let col = 0; col < BOARD_SIZE; col += 1) {
        const piece = this.board[row][col];
        if (piece && piece.owner === byPlayer && this.attacksSquare({ row, col }, square, piece)) return true;
      }
    }
    return false;
  }

  findKing(player) {
    for (let row = 0; row < BOARD_SIZE; row += 1) {
      for (let col = 0; col < BOARD_SIZE; col += 1) {
        const piece = this.board[row][col];
        if (piece && piece.owner === player && piece.type === TYPES.KING && !piece.fused) return { row, col };
      }
    }
    return null;
  }

  isInCheck(player) {
    const king = this.findKing(player);
    return !king || this.isSquareAttacked(king, opposite(player));
  }

  isFusionCandidate(piece, target) {
    return Boolean(
      piece && target
      && piece.owner === target.owner
      && piece.type !== TYPES.KING
      && target.type !== TYPES.KING
      && !piece.promoted && !target.promoted
      && !piece.fused && !target.fused,
    );
  }

  pseudoMoves(player) {
    const moves = [];
    for (let row = 0; row < BOARD_SIZE; row += 1) {
      for (let col = 0; col < BOARD_SIZE; col += 1) {
        const piece = this.board[row][col];
        if (!piece || piece.owner !== player) continue;
        const from = { row, col };

        for (const to of this.getAttackSquares(from, piece)) {
          const target = this.board[to.row][to.col];
          if (target && target.owner === player) continue;
          if (target && target.type === TYPES.KING) continue;
          for (const promote of this.promotionOptions(piece, from, to)) {
            moves.push({ kind: "move", from, to, promote, fusion: false });
          }
        }

        if (!piece.fused && !piece.promoted && piece.type !== TYPES.KING) {
          for (let targetRow = 0; targetRow < BOARD_SIZE; targetRow += 1) {
            for (let targetCol = 0; targetCol < BOARD_SIZE; targetCol += 1) {
              const target = this.board[targetRow][targetCol];
              const to = { row: targetRow, col: targetCol };
              if (!this.isFusionCandidate(piece, target) || !this.attacksSquare(from, to, piece)) continue;
              moves.push({ kind: "move", from, to, promote: false, fusion: true });
            }
          }
        }
      }
    }

    const hand = this.hands[playerIndex(player)];
    for (const [type, count] of hand.entries()) {
      if (count <= 0) continue;
      for (let row = 0; row < BOARD_SIZE; row += 1) {
        for (let col = 0; col < BOARD_SIZE; col += 1) {
          if (this.canDrop(type, player, row, col)) moves.push({ kind: "drop", type, to: { row, col } });
        }
      }
    }
    return moves;
  }

  hasUnpromotedPawnInFile(player, col) {
    return this.board.some((row) => {
      const piece = row[col];
      return piece && piece.owner === player && piece.type === TYPES.PAWN && !piece.promoted && !piece.fused;
    });
  }

  canDrop(type, player, row, col) {
    if (this.board[row][col]) return false;
    if ((type === TYPES.PAWN || type === TYPES.LANCE) && (player === PLAYERS.BLACK ? row === 0 : row === 8)) return false;
    if (type === TYPES.KNIGHT && (player === PLAYERS.BLACK ? row <= 1 : row >= 7)) return false;
    if (type === TYPES.PAWN && this.hasUnpromotedPawnInFile(player, col)) return false;
    return true;
  }

  moveKey(move) {
    if (move.kind === "drop") return `drop:${move.type}:${squareKey(move.to)}`;
    return `move:${squareKey(move.from)}:${squareKey(move.to)}:${Boolean(move.promote)}:${Boolean(move.fusion)}`;
  }

  isPawnDropMate(move, nextPlayer) {
    if (move.kind !== "drop" || move.type !== TYPES.PAWN) return false;
    if (!this.isInCheck(nextPlayer)) return false;
    return this.getLegalMoves({ forPlayer: nextPlayer, ignorePawnDropMate: true }).length === 0;
  }

  getLegalMoves({ forPlayer = this.turn, ignorePawnDropMate = false } = {}) {
    if (this.gameOver) return [];
    const legal = [];
    for (const move of this.pseudoMoves(forPlayer)) {
      const next = this.clone();
      next.turn = forPlayer;
      next.applyMoveUnchecked(move);
      if (next.isInCheck(forPlayer)) continue;
      if (!ignorePawnDropMate && next.isPawnDropMate(move, opposite(forPlayer))) continue;
      legal.push(move);
    }
    return legal;
  }

  applyMoveUnchecked(move) {
    const player = this.turn;
    if (move.kind === "drop") {
      const hand = this.hands[playerIndex(player)];
      const count = hand.get(move.type) || 0;
      if (count <= 0 || this.board[move.to.row][move.to.col]) throw new Error("Invalid drop");
      if (count === 1) hand.delete(move.type);
      else hand.set(move.type, count - 1);
      this.board[move.to.row][move.to.col] = createPiece(player, move.type);
    } else {
      const piece = this.board[move.from.row][move.from.col];
      if (!piece) throw new Error("No piece at the source square");
      const target = this.board[move.to.row][move.to.col];
      if (target && target.owner !== player) {
        const hand = this.hands[playerIndex(player)];
        if (target.fused) {
          for (const type of target.components) hand.set(type, (hand.get(type) || 0) + 1);
        } else if (target.type !== TYPES.KING) {
          const type = target.type;
          hand.set(type, (hand.get(type) || 0) + 1);
        }
      }
      this.board[move.from.row][move.from.col] = null;
      if (move.fusion) {
        if (!this.isFusionCandidate(piece, target)) throw new Error("Invalid fusion");
        piece.fused = true;
        piece.promoted = false;
        piece.components = [piece.type, target.type];
      } else if (move.promote) {
        piece.promoted = true;
      }
      this.board[move.to.row][move.to.col] = piece;
    }
    this.lastMove = JSON.parse(JSON.stringify(move));
    this.turn = opposite(player);
    this.moveNumber += 1;
  }

  playMove(move) {
    if (this.gameOver) throw new Error("The game is over");
    const legal = this.getLegalMoves();
    const selected = legal.find((candidate) => this.moveKey(candidate) === this.moveKey(move));
    if (!selected) throw new Error("Illegal move");
    this.applyMoveUnchecked(selected);
    this.updateResult();
    return selected;
  }

  updateResult() {
    const legal = this.getLegalMoves();
    const inCheck = this.isInCheck(this.turn);
    if (legal.length === 0) {
      this.gameOver = true;
      this.result = inCheck
        ? { type: "checkmate", winner: opposite(this.turn), loser: this.turn }
        : { type: "stalemate", winner: null, loser: this.turn };
    } else {
      this.gameOver = false;
      this.result = { type: inCheck ? "check" : "playing", turn: this.turn };
    }
  }

  getStatus() {
    if (this.result?.type === "checkmate") return `${this.result.winner === PLAYERS.BLACK ? "先手" : "後手"}の勝ち（詰み）`;
    if (this.result?.type === "stalemate") return "手詰まりです";
    if (this.result?.type === "check") return "王手です";
    return "対局中";
  }
}

export { HAND_ORDER, GLYPHS, TYPE_NAMES, opposite, squareKey };
