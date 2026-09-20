import { performance } from "node:perf_hooks";
import { FusionShogiGame, PLAYERS } from "../src/game.js";
import { AI_LEVELS, ComputerEngine, positionKey } from "../src/ai/engine.js";

const requestedPlies = Number.parseInt(process.argv[2] || "12", 10);
const maxPlies = Number.isFinite(requestedPlies) ? Math.max(2, requestedPlies) : 12;

function playerLabel(player) {
  return player === PLAYERS.BLACK ? "先手" : "後手";
}

function benchmarkLevels() {
  const rows = [];
  for (const level of Object.keys(AI_LEVELS)) {
    const game = new FusionShogiGame();
    const engine = new ComputerEngine({ difficulty: level });
    const startedAt = performance.now();
    const move = engine.chooseMove(game);
    const elapsedMs = Math.round(performance.now() - startedAt);
    rows.push({
      level,
      move: game.moveKey(move),
      elapsedMs,
      stats: engine.getLastSearchStats(),
    });
  }
  return rows;
}

function selfPlay() {
  const game = new FusionShogiGame();
  const engines = {
    [PLAYERS.BLACK]: new ComputerEngine({
      maxDepth: 1,
      timeLimitMs: 120,
      nodeLimit: 4_000,
      quiescenceDepth: 0,
      checkExtensionDepth: 0,
    }),
    [PLAYERS.WHITE]: new ComputerEngine({
      maxDepth: 1,
      timeLimitMs: 120,
      nodeLimit: 4_000,
      quiescenceDepth: 0,
      checkExtensionDepth: 0,
    }),
  };
  const trace = [];
  const visited = new Set([positionKey(game)]);
  const startedAt = performance.now();

  while (!game.gameOver && trace.length < maxPlies) {
    const legalMoves = game.getLegalMoves();
    if (legalMoves.length === 0) break;
    const player = game.turn;
    const move = engines[player].chooseMove(game);
    const key = game.moveKey(move);
    if (!legalMoves.some((candidate) => game.moveKey(candidate) === key)) {
      throw new Error(`${playerLabel(player)}が合法手以外を返しました: ${key}`);
    }
    game.playMove(move);
    const stateKey = positionKey(game);
    visited.add(stateKey);
    trace.push({ ply: trace.length + 1, player, move: key });
  }

  return {
    maxPlies,
    plies: trace.length,
    gameOver: game.gameOver,
    result: game.result,
    uniquePositions: visited.size,
    elapsedMs: Math.round(performance.now() - startedAt),
    trace,
  };
}

console.log("CPUレベル別ベンチマーク");
for (const row of benchmarkLevels()) {
  const stats = row.stats;
  console.log(JSON.stringify({
    level: row.level,
    move: row.move,
    elapsedMs: row.elapsedMs,
    completedDepth: stats.completedDepth,
    searchedNodes: stats.searchedNodes,
    quiescenceNodes: stats.quiescenceNodes,
    stopReason: stats.stopReason,
  }));
}

console.log("短い自己対局");
console.log(JSON.stringify(selfPlay()));
