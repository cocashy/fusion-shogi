import test from "node:test";
import assert from "node:assert/strict";
import {
  FusionShogiGame,
  PLAYERS,
  TYPES,
  createPiece,
  pieceGlyph,
} from "../src/game.js";

function position({ pieces, hands, turn = PLAYERS.BLACK }) {
  return new FusionShogiGame({ pieces, hands, turn });
}

function movesFrom(game, row, col) {
  return game.getLegalMoves().filter((move) => move.kind === "move" && move.from.row === row && move.from.col === col);
}

function stateSnapshot(game) {
  return {
    state: game.toJSON(),
    lastMove: game.lastMove,
    moveNumber: game.moveNumber,
    gameOver: game.gameOver,
    result: game.result,
  };
}

test("駒名は二文字、融合駒は強さ順の一文字ずつで表示する", () => {
  assert.equal(pieceGlyph(createPiece(PLAYERS.BLACK, TYPES.PAWN)), "歩兵");
  assert.equal(pieceGlyph(createPiece(PLAYERS.BLACK, TYPES.KING)), "王将");
  assert.equal(pieceGlyph(createPiece(PLAYERS.BLACK, TYPES.BISHOP, { promoted: true })), "龍馬");
  assert.equal(pieceGlyph(createPiece(PLAYERS.BLACK, TYPES.ROOK, { promoted: true })), "龍王");
  assert.equal(pieceGlyph(createPiece(PLAYERS.BLACK, TYPES.BISHOP, {
    fused: true,
    components: [TYPES.BISHOP, TYPES.PAWN],
  })), "歩角");
  assert.equal(pieceGlyph(createPiece(PLAYERS.BLACK, TYPES.SILVER, {
    fused: true,
    components: [TYPES.BISHOP, TYPES.SILVER],
  })), "銀角");
});

test("自駒に利いているマスへの移動で融合でき、動きは和集合になる", () => {
  const game = position({
    pieces: [
      { row: 8, col: 8, owner: PLAYERS.BLACK, type: TYPES.KING },
      { row: 0, col: 0, owner: PLAYERS.WHITE, type: TYPES.KING },
      { row: 6, col: 3, owner: PLAYERS.BLACK, type: TYPES.BISHOP },
      { row: 5, col: 4, owner: PLAYERS.BLACK, type: TYPES.ROOK },
    ],
  });

  const fusion = movesFrom(game, 6, 3).find((move) => move.to.row === 5 && move.to.col === 4 && move.fusion);
  assert.ok(fusion, "斜めに利いている自駒への融合手が生成される");
  game.playMove(fusion);

  const fused = game.getPiece(5, 4);
  assert.equal(fused.fused, true);
  assert.deepEqual(fused.components, [TYPES.BISHOP, TYPES.ROOK]);
  assert.ok(game.attacksSquare({ row: 5, col: 4 }, { row: 5, col: 6 }, fused), "飛車の横移動を持つ");
  assert.ok(game.attacksSquare({ row: 5, col: 4 }, { row: 3, col: 6 }, fused), "角の斜め移動を持つ");
});

test("王・成駒・融合済みの駒は融合できない", () => {
  const game = position({
    pieces: [
      { row: 8, col: 8, owner: PLAYERS.BLACK, type: TYPES.KING },
      { row: 0, col: 0, owner: PLAYERS.WHITE, type: TYPES.KING },
      { row: 7, col: 4, owner: PLAYERS.BLACK, type: TYPES.KING },
      { row: 6, col: 4, owner: PLAYERS.BLACK, type: TYPES.PAWN },
      { row: 5, col: 3, owner: PLAYERS.BLACK, type: TYPES.SILVER, promoted: true },
      { row: 4, col: 4, owner: PLAYERS.BLACK, type: TYPES.PAWN, fused: true, components: [TYPES.PAWN, TYPES.SILVER] },
      { row: 3, col: 4, owner: PLAYERS.BLACK, type: TYPES.GOLD },
    ],
  });

  const allMoves = game.getLegalMoves();
  assert.equal(allMoves.some((move) => move.fusion && move.from.row === 7), false);
  assert.equal(allMoves.some((move) => move.fusion && move.from.row === 5), false);
  assert.equal(allMoves.some((move) => move.fusion && move.from.row === 4), false);
});

test("融合駒を取ると構成元の2駒が捕獲側の持ち駒になる", () => {
  const game = position({
    pieces: [
      { row: 8, col: 8, owner: PLAYERS.BLACK, type: TYPES.KING },
      { row: 0, col: 0, owner: PLAYERS.WHITE, type: TYPES.KING },
      { row: 6, col: 4, owner: PLAYERS.BLACK, type: TYPES.ROOK },
      { row: 5, col: 4, owner: PLAYERS.WHITE, type: TYPES.PAWN, fused: true, components: [TYPES.PAWN, TYPES.SILVER] },
    ],
  });

  const capture = movesFrom(game, 6, 4).find((move) => move.to.row === 5 && move.to.col === 4 && !move.fusion);
  assert.ok(capture);
  game.playMove(capture);
  assert.equal(game.getHand(PLAYERS.BLACK, TYPES.PAWN), 1);
  assert.equal(game.getHand(PLAYERS.BLACK, TYPES.SILVER), 1);
  assert.equal(game.getPiece(5, 4).type, TYPES.ROOK);
});

test("融合駒は成りの範囲に入っても成れない", () => {
  const game = position({
    pieces: [
      { row: 8, col: 8, owner: PLAYERS.BLACK, type: TYPES.KING },
      { row: 0, col: 0, owner: PLAYERS.WHITE, type: TYPES.KING },
      { row: 5, col: 4, owner: PLAYERS.BLACK, type: TYPES.ROOK, fused: true, components: [TYPES.ROOK, TYPES.BISHOP] },
    ],
  });
  const moves = movesFrom(game, 5, 4).filter((move) => move.to.row === 2 && move.to.col === 4);
  assert.equal(moves.length, 1);
  assert.equal(moves[0].promote, false);
});

test("通常将棋の二歩・行き所のない駒打ち・成りを適用する", () => {
  const game = position({
    pieces: [
      { row: 8, col: 8, owner: PLAYERS.BLACK, type: TYPES.KING },
      { row: 0, col: 0, owner: PLAYERS.WHITE, type: TYPES.KING },
      { row: 5, col: 4, owner: PLAYERS.BLACK, type: TYPES.PAWN },
      { row: 1, col: 3, owner: PLAYERS.BLACK, type: TYPES.PAWN },
    ],
    hands: { [PLAYERS.BLACK]: { [TYPES.PAWN]: 1, [TYPES.KNIGHT]: 1 } },
  });
  const moves = game.getLegalMoves();
  assert.equal(moves.some((move) => move.kind === "drop" && move.type === TYPES.PAWN && move.to.col === 4), false);
  assert.equal(moves.some((move) => move.kind === "drop" && move.type === TYPES.KNIGHT && move.to.row <= 1), false);
  const pawnPromotion = moves.filter((move) => move.kind === "move" && move.from.row === 1 && move.from.col === 3 && move.to.row === 0);
  assert.equal(pawnPromotion.length, 1);
  assert.equal(pawnPromotion[0].promote, true);
});

test("王手放置になる移動は合法手から除外する", () => {
  const game = position({
    pieces: [
      { row: 8, col: 4, owner: PLAYERS.BLACK, type: TYPES.KING },
      { row: 7, col: 4, owner: PLAYERS.BLACK, type: TYPES.ROOK },
      { row: 0, col: 4, owner: PLAYERS.WHITE, type: TYPES.ROOK },
    ],
  });
  assert.equal(movesFrom(game, 7, 4).some((move) => move.to.row === 7 && move.to.col === 3), false);
});

test("通常将棋の打ち歩詰めを禁止する", () => {
  const game = position({
    pieces: [
      { row: 8, col: 8, owner: PLAYERS.BLACK, type: TYPES.KING },
      { row: 0, col: 4, owner: PLAYERS.WHITE, type: TYPES.KING },
      { row: 1, col: 2, owner: PLAYERS.BLACK, type: TYPES.GOLD },
      { row: 1, col: 6, owner: PLAYERS.BLACK, type: TYPES.GOLD },
      { row: 2, col: 4, owner: PLAYERS.BLACK, type: TYPES.GOLD },
    ],
    hands: { [PLAYERS.BLACK]: { [TYPES.PAWN]: 1 } },
  });
  assert.equal(game.getLegalMoves().some((move) => move.kind === "drop" && move.type === TYPES.PAWN && move.to.row === 1 && move.to.col === 4), false);
});

test("makeMoveとunmakeMoveは通常手・成り・融合・駒打ちを完全に復元する", () => {
  const cases = [
    position({
      pieces: [
        { row: 8, col: 8, owner: PLAYERS.BLACK, type: TYPES.KING },
        { row: 0, col: 0, owner: PLAYERS.WHITE, type: TYPES.KING },
        { row: 6, col: 3, owner: PLAYERS.BLACK, type: TYPES.BISHOP },
        { row: 5, col: 4, owner: PLAYERS.BLACK, type: TYPES.ROOK },
      ],
    }),
    position({
      pieces: [
        { row: 8, col: 8, owner: PLAYERS.BLACK, type: TYPES.KING },
        { row: 0, col: 0, owner: PLAYERS.WHITE, type: TYPES.KING },
        { row: 1, col: 4, owner: PLAYERS.BLACK, type: TYPES.PAWN },
      ],
    }),
    position({
      pieces: [
        { row: 8, col: 8, owner: PLAYERS.BLACK, type: TYPES.KING },
        { row: 0, col: 0, owner: PLAYERS.WHITE, type: TYPES.KING },
        { row: 6, col: 4, owner: PLAYERS.BLACK, type: TYPES.ROOK },
        { row: 5, col: 4, owner: PLAYERS.WHITE, type: TYPES.PAWN },
      ],
    }),
    position({
      pieces: [
        { row: 8, col: 8, owner: PLAYERS.BLACK, type: TYPES.KING },
        { row: 0, col: 0, owner: PLAYERS.WHITE, type: TYPES.KING },
      ],
      hands: { [PLAYERS.BLACK]: { [TYPES.PAWN]: 1 } },
    }),
  ];

  for (const game of cases) {
    const move = game.getLegalMoves().find((candidate) => (
      candidate.fusion
      || candidate.promote
      || candidate.kind === "drop"
      || candidate.to.row === 5
    ));
    assert.ok(move);
    const before = stateSnapshot(game);
    const undo = game.makeMove(move);
    game.unmakeMove(undo);
    assert.deepEqual(stateSnapshot(game), before);
  }
});
