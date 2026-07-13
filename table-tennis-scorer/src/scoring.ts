export type Side = "A" | "B";

export interface PointEvent {
  id: string;
  time: number; // seconds, when the point was decided
  winner: Side;
  auto: boolean; // true = AI提案から確定, false = 手動追加
}

export interface MatchConfig {
  pointsToWin: number; // 通常11点
  bestOf: number; // 何ゲーム先取のマッチか（奇数、例: 5 = 3先取で勝ち）
  firstServer: Side; // 第1ゲームの最初のサーバー
}

export interface FinishedGame {
  A: number;
  B: number;
  winner: Side;
}

export interface MatchSnapshot {
  pointId: string;
  time: number;
  gameIndex: number; // 現在（進行中）のゲーム番号（0始まり）
  currentGame: { A: number; B: number };
  finishedGames: FinishedGame[];
  gamesWon: { A: number; B: number };
  server: Side; // 次のポイントのサーバー
  matchWinner: Side | null;
}

export function otherSide(side: Side): Side {
  return side === "A" ? "B" : "A";
}

function computeServer(a: number, b: number, gameFirstServer: Side, pointsToWin: number): Side {
  const total = a + b;
  const deuce = a >= pointsToWin - 1 && b >= pointsToWin - 1;
  const firstIsServing = deuce ? total % 2 === 0 : Math.floor(total / 2) % 2 === 0;
  return firstIsServing ? gameFirstServer : otherSide(gameFirstServer);
}

export function gamesToWinMatch(bestOf: number): number {
  return Math.ceil(bestOf / 2);
}

/**
 * 確定したポイント履歴（時系列）から、各ポイント直後の試合状態（スコア・サーブ権・
 * 勝敗）を再構成する。卓球ルール（11点先取・2点差・デュース時は1点ごとにサーブ交代）
 * に従う。
 */
export function replayMatch(points: PointEvent[], config: MatchConfig): MatchSnapshot[] {
  const sorted = [...points].sort((a, b) => a.time - b.time);
  const finishedGames: FinishedGame[] = [];
  let current = { A: 0, B: 0 };
  let gameFirstServer: Side = config.firstServer;
  let gamesWon = { A: 0, B: 0 };
  let matchWinner: Side | null = null;
  const gamesToWin = gamesToWinMatch(config.bestOf);
  const snapshots: MatchSnapshot[] = [];

  for (const pt of sorted) {
    if (!matchWinner) {
      current = { ...current, [pt.winner]: current[pt.winner] + 1 };
      const { A, B } = current;
      const gameOver = Math.max(A, B) >= config.pointsToWin && Math.abs(A - B) >= 2;
      if (gameOver) {
        const winner: Side = A > B ? "A" : "B";
        finishedGames.push({ A, B, winner });
        gamesWon = { ...gamesWon, [winner]: gamesWon[winner] + 1 };
        if (gamesWon[winner] >= gamesToWin) matchWinner = winner;
        current = { A: 0, B: 0 };
        gameFirstServer = otherSide(gameFirstServer);
      }
    }

    const server = computeServer(current.A, current.B, gameFirstServer, config.pointsToWin);
    snapshots.push({
      pointId: pt.id,
      time: pt.time,
      gameIndex: finishedGames.length,
      currentGame: { ...current },
      finishedGames: [...finishedGames],
      gamesWon: { ...gamesWon },
      server,
      matchWinner,
    });
  }

  return snapshots;
}

export function initialServer(config: MatchConfig): Side {
  return config.firstServer;
}
