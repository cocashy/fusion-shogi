import test from "node:test";
import assert from "node:assert/strict";
import {
  FusionShogiGame,
  PLAYERS,
  TYPES,
} from "../src/game.js";
import {
  AI_LEVELS,
  ComputerEngine,
  evaluatePosition,
  positionKey,
} from "../src/ai/engine.js";

function position({ pieces, hands, turn = PLAYERS.BLACK }) {
  return new FusionShogiGame({ pieces, hands, turn });
}

function sameSquare(move, from, to) {
  return move?.from?.row === from.row
    && move?.from?.col === from.col
    && move?.to?.row === to.row
    && move?.to?.col === to.col;
}

function isCheckmateAfter(game, move, player) {
  const next = game.clone();
  next.applyMoveUnchecked(move);
  return next.isInCheck(player) && next.getLegalMoves().length === 0;
}

function hasImmediateCheckmate(game, player) {
  return game.getLegalMoves().some((move) => isCheckmateAfter(game, move, player));
}

function testEngine(options = {}) {
  return new ComputerEngine({
    maxDepth: 1,
    timeLimitMs: 2_000,
    nodeLimit: 100_000,
    ...options,
  });
}

test("探索キーは手順に依存せず、融合構成の順序を正規化する", () => {
  const game = position({
    pieces: [
      { row: 8, col: 8, owner: PLAYERS.BLACK, type: TYPES.KING },
      {
        row: 5,
        col: 4,
        owner: PLAYERS.BLACK,
        type: TYPES.ROOK,
        fused: true,
        components: [TYPES.ROOK, TYPES.BISHOP],
      },
      { row: 0, col: 0, owner: PLAYERS.WHITE, type: TYPES.KING },
    ],
  });
  const reordered = game.clone();
  reordered.getPiece(5, 4).components = [TYPES.BISHOP, TYPES.ROOK];
  const differentLastMove = game.clone();
  differentLastMove.lastMove = {
    kind: "move",
    from: { row: 5, col: 4 },
    to: { row: 5, col: 4 },
    promote: false,
    fusion: false,
  };

  assert.equal(positionKey(game, 1), positionKey(reordered, 1));
  assert.equal(positionKey(game, 1), positionKey(differentLastMove, 1));
});

test("CPUは一手詰めを選ぶ", () => {
  const game = position({
    pieces: [
      { row: 0, col: 0, owner: PLAYERS.WHITE, type: TYPES.KING },
      { row: 8, col: 8, owner: PLAYERS.BLACK, type: TYPES.KING },
      { row: 2, col: 2, owner: PLAYERS.BLACK, type: TYPES.GOLD },
      { row: 2, col: 1, owner: PLAYERS.BLACK, type: TYPES.ROOK },
    ],
  });
  const engine = testEngine();
  const move = engine.chooseMove(game);
  const stats = engine.getLastSearchStats();

  assert.ok(move);
  assert.equal(isCheckmateAfter(game, move, PLAYERS.WHITE), true);
  assert.equal(stats.completedDepth, 1);
  assert.equal(stats.legalMoves, game.getLegalMoves().length);
  assert.ok(stats.searchedNodes > 0);
});

test("CPUはただで取れる高価な駒を取る", () => {
  const game = position({
    pieces: [
      { row: 8, col: 8, owner: PLAYERS.BLACK, type: TYPES.KING },
      { row: 6, col: 4, owner: PLAYERS.BLACK, type: TYPES.ROOK },
      { row: 0, col: 0, owner: PLAYERS.WHITE, type: TYPES.KING },
      { row: 5, col: 4, owner: PLAYERS.WHITE, type: TYPES.ROOK },
      { row: 5, col: 5, owner: PLAYERS.WHITE, type: TYPES.PAWN },
    ],
  });
  const move = testEngine().chooseMove(game);

  assert.equal(sameSquare(move, { row: 6, col: 4 }, { row: 5, col: 4 }), true);
  assert.equal(move.promote, false);
  assert.equal(move.fusion, false);
});

test("CPUは強制成りを選ぶ", () => {
  const game = position({
    pieces: [
      { row: 8, col: 8, owner: PLAYERS.BLACK, type: TYPES.KING },
      { row: 1, col: 4, owner: PLAYERS.BLACK, type: TYPES.PAWN },
      { row: 0, col: 0, owner: PLAYERS.WHITE, type: TYPES.KING },
    ],
  });
  const move = testEngine().chooseMove(game);

  assert.equal(sameSquare(move, { row: 1, col: 4 }, { row: 0, col: 4 }), true);
  assert.equal(move.promote, true);
});

test("CPUは融合による一手詰めを選ぶ", () => {
  const game = position({
    pieces: [
      { row: 0, col: 0, owner: PLAYERS.WHITE, type: TYPES.KING },
      { row: 8, col: 8, owner: PLAYERS.BLACK, type: TYPES.KING },
      { row: 2, col: 2, owner: PLAYERS.BLACK, type: TYPES.BISHOP },
      { row: 1, col: 1, owner: PLAYERS.BLACK, type: TYPES.ROOK },
      { row: 2, col: 1, owner: PLAYERS.BLACK, type: TYPES.GOLD },
    ],
  });
  const move = testEngine().chooseMove(game);

  assert.equal(move.fusion, true);
  assert.equal(isCheckmateAfter(game, move, PLAYERS.WHITE), true);
});

test("CPUは相手の一手詰めを許す手を避ける", () => {
  const game = position({
    pieces: [
      { row: 8, col: 8, owner: PLAYERS.BLACK, type: TYPES.KING },
      { row: 7, col: 5, owner: PLAYERS.BLACK, type: TYPES.ROOK },
      { row: 6, col: 6, owner: PLAYERS.WHITE, type: TYPES.BISHOP },
      { row: 7, col: 7, owner: PLAYERS.WHITE, type: TYPES.ROOK },
      { row: 6, col: 7, owner: PLAYERS.WHITE, type: TYPES.GOLD },
      { row: 0, col: 0, owner: PLAYERS.WHITE, type: TYPES.KING },
    ],
  });
  const move = testEngine({ maxDepth: 2 }).chooseMove(game);
  const next = game.clone();
  next.applyMoveUnchecked(move);

  assert.equal(hasImmediateCheckmate(next, PLAYERS.WHITE), false);
});

test("CPUは王手中でも自王を王手に残す手を返さない", () => {
  const game = position({
    pieces: [
      { row: 8, col: 4, owner: PLAYERS.BLACK, type: TYPES.KING },
      { row: 0, col: 4, owner: PLAYERS.WHITE, type: TYPES.ROOK },
      { row: 0, col: 0, owner: PLAYERS.WHITE, type: TYPES.KING },
    ],
  });
  assert.equal(game.isInCheck(PLAYERS.BLACK), true);

  const move = testEngine().chooseMove(game);
  assert.ok(move);
  const next = game.clone();
  next.applyMoveUnchecked(move);
  assert.equal(next.isInCheck(PLAYERS.BLACK), false);
});

test("探索は静的探索とアルファベータ枝刈りを実行し、元の局面を変更しない", () => {
  const game = new FusionShogiGame();
  const before = {
    state: game.toJSON(),
    lastMove: game.lastMove,
    moveNumber: game.moveNumber,
  };
  const engine = new ComputerEngine({
    maxDepth: 2,
    timeLimitMs: 5_000,
    nodeLimit: 100_000,
    quiescenceDepth: 1,
    checkExtensionDepth: 1,
  });

  assert.ok(engine.chooseMove(game));
  const stats = engine.getLastSearchStats();
  assert.equal(stats.completedDepth, 2);
  assert.ok(stats.quiescenceNodes > 0);
  assert.ok(stats.betaCutoffs > 0);
  assert.equal(stats.stopReason, "completed");
  assert.deepEqual({
    state: game.toJSON(),
    lastMove: game.lastMove,
    moveNumber: game.moveNumber,
  }, before);
});

test("評価関数は浮き駒・王の安全・持ち駒・融合価値を区別する", () => {
  const kings = [
    { row: 8, col: 8, owner: PLAYERS.BLACK, type: TYPES.KING },
    { row: 0, col: 0, owner: PLAYERS.WHITE, type: TYPES.KING },
  ];
  const hanging = position({
    pieces: [
      ...kings,
      { row: 4, col: 4, owner: PLAYERS.BLACK, type: TYPES.ROOK },
      { row: 3, col: 3, owner: PLAYERS.WHITE, type: TYPES.BISHOP },
    ],
  });
  const defended = position({
    pieces: [
      ...kings,
      { row: 4, col: 4, owner: PLAYERS.BLACK, type: TYPES.ROOK },
      { row: 5, col: 5, owner: PLAYERS.BLACK, type: TYPES.GOLD },
      { row: 3, col: 3, owner: PLAYERS.WHITE, type: TYPES.BISHOP },
    ],
  });
  assert.ok(evaluatePosition(defended, PLAYERS.BLACK) > evaluatePosition(hanging, PLAYERS.BLACK));
  assert.ok(evaluatePosition(defended, PLAYERS.BLACK, { fast: true }) > evaluatePosition(hanging, PLAYERS.BLACK, { fast: true }));

  const unsafeKing = position({
    pieces: [
      { row: 4, col: 4, owner: PLAYERS.BLACK, type: TYPES.KING },
      { row: 0, col: 0, owner: PLAYERS.WHITE, type: TYPES.KING },
      { row: 3, col: 0, owner: PLAYERS.WHITE, type: TYPES.ROOK },
    ],
  });
  const safeKing = position({
    pieces: [
      { row: 4, col: 4, owner: PLAYERS.BLACK, type: TYPES.KING },
      { row: 0, col: 0, owner: PLAYERS.WHITE, type: TYPES.KING },
      { row: 3, col: 0, owner: PLAYERS.WHITE, type: TYPES.ROOK },
      { row: 4, col: 3, owner: PLAYERS.BLACK, type: TYPES.GOLD },
      { row: 5, col: 3, owner: PLAYERS.BLACK, type: TYPES.GOLD },
    ],
  });
  assert.ok(evaluatePosition(safeKing, PLAYERS.BLACK) > evaluatePosition(unsafeKing, PLAYERS.BLACK));

  const handRook = position({ pieces: kings, hands: { [PLAYERS.BLACK]: { [TYPES.ROOK]: 1 } } });
  const handPawn = position({ pieces: kings, hands: { [PLAYERS.BLACK]: { [TYPES.PAWN]: 1 } } });
  assert.ok(evaluatePosition(handRook, PLAYERS.BLACK) > evaluatePosition(handPawn, PLAYERS.BLACK));

  const fused = position({
    pieces: [
      ...kings,
      { row: 4, col: 4, owner: PLAYERS.BLACK, type: TYPES.ROOK, fused: true, components: [TYPES.ROOK, TYPES.BISHOP] },
    ],
  });
  const separate = position({
    pieces: [
      ...kings,
      { row: 4, col: 4, owner: PLAYERS.BLACK, type: TYPES.ROOK },
      { row: 4, col: 5, owner: PLAYERS.BLACK, type: TYPES.BISHOP },
    ],
  });
  assert.ok(evaluatePosition(fused, PLAYERS.BLACK) > evaluatePosition(separate, PLAYERS.BLACK));
  assert.ok(evaluatePosition(fused, PLAYERS.BLACK, { fast: true }) > evaluatePosition(separate, PLAYERS.BLACK, { fast: true }));
});

test("CPU難易度は探索予算を段階的に切り替える", () => {
  assert.deepEqual(
    Object.keys(AI_LEVELS),
    ["easy", "normal", "strong"],
  );
  assert.ok(AI_LEVELS.easy.timeLimitMs < AI_LEVELS.normal.timeLimitMs);
  assert.ok(AI_LEVELS.normal.timeLimitMs < AI_LEVELS.strong.timeLimitMs);
  assert.ok(AI_LEVELS.easy.nodeLimit < AI_LEVELS.normal.nodeLimit);
  assert.ok(AI_LEVELS.normal.nodeLimit < AI_LEVELS.strong.nodeLimit);
  assert.ok(AI_LEVELS.easy.quiescenceDepth <= AI_LEVELS.normal.quiescenceDepth);
  assert.ok(AI_LEVELS.normal.quiescenceDepth <= AI_LEVELS.strong.quiescenceDepth);
});

test("短い自己対局ではCPUの着手が常に合法で局面を壊さない", () => {
  const game = new FusionShogiGame();
  const engines = {
    [PLAYERS.BLACK]: new ComputerEngine({ maxDepth: 1, timeLimitMs: 120, nodeLimit: 4_000, quiescenceDepth: 0 }),
    [PLAYERS.WHITE]: new ComputerEngine({ maxDepth: 1, timeLimitMs: 120, nodeLimit: 4_000, quiescenceDepth: 0 }),
  };
  let plies = 0;

  while (!game.gameOver && plies < 8) {
    const legalMoves = game.getLegalMoves();
    if (legalMoves.length === 0) break;
    const move = engines[game.turn].chooseMove(game);
    assert.ok(move);
    assert.ok(legalMoves.some((candidate) => game.moveKey(candidate) === game.moveKey(move)));
    game.playMove(move);
    assert.ok(game.findKing(PLAYERS.BLACK));
    assert.ok(game.findKing(PLAYERS.WHITE));
    plies += 1;
  }

  assert.equal(plies, 8);
});
