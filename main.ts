// Sokoban solver: push-optimal per room, joined by the player's walk.
//
// A level is a one-wide hallway with rooms off it through single doors; a box
// pushed out of a door can never come back, so each room is its own puzzle and
// the level's push optimum is the sum of the rooms' optima. This program
// detects the rooms, solves each with A* over pushes (cost 1 per push, a
// minimum-assignment heuristic over walking distances, dead-square and frozen
// 2x2 pruning), and stitches the rooms together with the walks between them.
//
// Deterministic: budgets are counted in states, never in wall-clock time, and
// every tie breaks on fixed orders, so two runs write the same bytes.
//
// Local run: mkdir -p out && MAKEFUN_INPUT_DIR=<kit>/practice/input MAKEFUN_OUTPUT_DIR=out node main.ts
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** States one room search may create before it gives up (work, never the clock). */
const ROOM_STATE_CAP = 250_000;
/** States the whole run may create across every room and instance: keeps the run inside the wall budget. */
const RUN_STATE_CAP = 1_500_000;

type Dir = { dx: number; dy: number; walk: string; push: string };
const DIRS: Dir[] = [
  { dx: 0, dy: -1, walk: 'u', push: 'U' },
  { dx: 0, dy: 1, walk: 'd', push: 'D' },
  { dx: -1, dy: 0, walk: 'l', push: 'L' },
  { dx: 1, dy: 0, walk: 'r', push: 'R' },
];

type Board = {
  w: number;
  h: number;
  wall: Uint8Array; // 1 where no one may ever stand
  goals: number[]; // sorted goal squares
  boxes: number[]; // sorted box squares
  player: number; // the player's square
};

/** Parse XSB text into a board. Short rows and the outer frame count as wall. */
function parseBoard(text: string): Board {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const h = rows.length;
  const w = Math.max(1, ...rows.map((r) => r.length));
  const wall = new Uint8Array(w * h).fill(1);
  const goals: number[] = [];
  const boxes: number[] = [];
  let player = -1;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const i = y * w + x;
      const ch = row[x];
      if (ch === '#') continue;
      wall[i] = 0;
      if (ch === '.' || ch === '*' || ch === '+') goals.push(i);
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) wall[y * w + x] = 1;
    }
  }
  goals.sort((a, b) => a - b);
  boxes.sort((a, b) => a - b);
  return { w, h, wall, goals, boxes, player };
}

/**
 * Squares from which a lone box can still be pushed onto a goal: start at the
 * goals and pull backwards — a square is live when the square beyond it (the
 * one a push from there would reach) is live and the square behind it (where
 * the player must stand to make that push) is open floor. A box on a dead
 * square can never be solved, so any state holding one is pruned.
 */
function liveMap(w: number, wall: Uint8Array, goals: number[]): Uint8Array {
  const live = new Uint8Array(wall.length);
  const queue: number[] = [];
  for (const g of goals) {
    live[g] = 1;
    queue.push(g);
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const x = queue[qi]!;
    for (const d of DIRS) {
      const step = d.dy * w + d.dx;
      const y = x - step;
      if (wall[y] || live[y] || wall[y - step]) continue;
      live[y] = 1;
      queue.push(y);
    }
  }
  return live;
}

/** Walking distances from one square over open floor (walls only), -1 where unreachable. */
function walkingDistances(w: number, wall: Uint8Array, from: number): Int32Array {
  const dist = new Int32Array(wall.length).fill(-1);
  const queue: number[] = [from];
  dist[from] = 0;
  for (let qi = 0; qi < queue.length; qi++) {
    const p = queue[qi]!;
    for (const d of DIRS) {
      const q = p + d.dy * w + d.dx;
      if (wall[q] || dist[q] >= 0) continue;
      dist[q] = dist[p]! + 1;
      queue.push(q);
    }
  }
  return dist;
}

/**
 * The level's rooms: the hallway is the player's row, and a box there reaches
 * no goal, so its dead squares cut the floor into parts; each part holding
 * boxes is a room. Returns null when the level is no set of rooms (a box in
 * the hallway, a goal in the cut, or a part whose boxes and goals differ).
 */
function findRooms(board: Board): { squares: number[]; boxes: number[]; goals: number[] }[] | null {
  const { w, wall, goals, boxes, player } = board;
  const live = liveMap(w, wall, goals);
  const row = Math.floor(player / w);
  const cut = new Uint8Array(wall.length);
  for (let i = row * w; i < (row + 1) * w; i++) {
    if (!wall[i] && !live[i]) cut[i] = 1;
  }
  if (boxes.some((b) => cut[b])) return null;
  const part = new Int32Array(wall.length).fill(-1);
  const rooms: { squares: number[]; boxes: number[]; goals: number[] }[] = [];
  for (let s = 0; s < wall.length; s++) {
    if (wall[s] || cut[s] || part[s] >= 0) continue;
    const squares: number[] = [s];
    part[s] = rooms.length;
    for (let i = 0; i < squares.length; i++) {
      for (const d of DIRS) {
        const q = squares[i]! + d.dy * w + d.dx;
        if (!wall[q] && !cut[q] && part[q] < 0) {
          part[q] = rooms.length;
          squares.push(q);
        }
      }
    }
    rooms.push({ squares, boxes: [], goals: [] });
  }
  for (const b of boxes) rooms[part[b]!]!.boxes.push(b);
  for (const g of goals) {
    if (part[g] < 0) return null;
    rooms[part[g]!]!.goals.push(g);
  }
  if (rooms.some((r) => r.boxes.length !== r.goals.length)) return null;
  return rooms.filter((r) => r.boxes.length > 0);
}

/** A binary heap ordered by [priority, heuristic, insertion order] — fully deterministic. */
class Heap {
  private items: [number, number, number, number][] = [];
  get size(): number {
    return this.items.length;
  }
  push(priority: number, heuristic: number, order: number, state: number): void {
    const items = this.items;
    let i = items.length;
    items.push([priority, heuristic, order, state]);
    while (i > 0) {
      const p = (i - 1) >> 1;
      const a = items[i]!;
      const b = items[p]!;
      if (a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] > b[2])))) break;
      items[i] = b;
      items[p] = a;
      i = p;
    }
  }
  pop(): [number, number, number, number] {
    const items = this.items;
    const top = items[0]!;
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      for (let i = 0; ; ) {
        let c = 2 * i + 1;
        if (c >= items.length) break;
        const left = items[c]!;
        const right = items[c + 1];
        if (right !== undefined && (right[0] < left[0] || (right[0] === left[0] && (right[1] < left[1] || (right[1] === left[1] && right[2] < left[2]))))) c++;
        const child = items[c]!;
        const cur = items[i]!;
        if (child[0] > cur[0] || (child[0] === cur[0] && (child[1] > cur[1] || (child[1] === cur[1] && child[2] > cur[2])))) break;
        items[i] = child;
        items[c] = cur;
        i = c;
      }
    }
    return top;
  }
}

type SearchResult = { pushes: number; moves: string } | null;

/**
 * Push-optimal A* for one board: states are (boxes, player's reachable region),
 * each push costs 1, and the heuristic is the cheapest assignment of boxes to
 * goals over walking distances — admissible, since one push moves one box one
 * square. Dead squares and frozen 2x2 blocks are pruned. `budget` counts the
 * states this search may create; `shared` counts states across the whole run.
 * With `greedy`, the open list orders by the heuristic alone: a best-first
 * search that gives up optimality to still find a solution when the optimal
 * search runs out of budget. Returns null when the budget runs out or no
 * solution exists.
 */
function solveBoard(board: Board, budget: { left: number }, shared: { left: number }, greedy = false): SearchResult {
  const { w, wall, goals } = board;
  const size = wall.length;
  const isGoal = new Uint8Array(size);
  for (const g of goals) isGoal[g] = 1;
  const live = liveMap(w, wall, goals);
  if (board.boxes.some((b) => !live[b])) return null;

  // Walking distance from every square to each goal (walls only, boxes ignored).
  const goalDist = goals.map((g) => walkingDistances(w, wall, g));
  const n = goals.length;

  // Cheapest assignment of the boxes to the goals, by brute force over the
  // permutations (at most 4 boxes, 24 of them). Memoised on the box layout:
  // many states share one layout with different player regions.
  const heuristicCache = new Map<number, number>();
  const assignment = (boxes: number[]): number => {
    let layoutKey = 0;
    for (const b of boxes) layoutKey = layoutKey * size + b;
    const cached = heuristicCache.get(layoutKey);
    if (cached !== undefined) return cached;
    let best = Infinity;
    const used = new Uint8Array(n);
    const assign = (bi: number, cost: number): void => {
      if (cost >= best) return;
      if (bi === n) {
        best = cost;
        return;
      }
      for (let gi = 0; gi < n; gi++) {
        if (used[gi]) continue;
        const d = goalDist[gi]![boxes[bi]!]!;
        if (d < 0) continue;
        used[gi] = 1;
        assign(bi + 1, cost + d);
        used[gi] = 0;
      }
    };
    assign(0, 0);
    heuristicCache.set(layoutKey, best);
    return best;
  };

  const solved = (boxes: number[]): boolean => boxes.every((b) => isGoal[b]);
  if (solved(board.boxes)) return { pushes: 0, moves: '' };

  // State storage: boxes, the player's square after the push that made the
  // state, its parent, and the push (from, to) that made it.
  const stateBoxes: number[][] = [board.boxes.slice()];
  const statePlayer: number[] = [board.player];
  const stateParent: number[] = [-1];
  const stateFrom: number[] = [-1];
  const stateTo: number[] = [-1];
  const stateG: number[] = [0];

  const occupied = new Uint8Array(size);
  const seen = new Int32Array(size);
  const flood = new Int32Array(size);
  let stamp = 0;
  // A second marker holds the region of the state being expanded, so the
  // region-low floods of the pushes it generates cannot clobber it.
  const regionSeen = new Int32Array(size);
  let regionStamp = 0;

  /** Flood the player's region from `from` around walls and boxes; returns its lowest square. */
  const regionLow = (from: number): number => {
    stamp++;
    let low = from;
    let top = 0;
    flood[top++] = from;
    seen[from] = stamp;
    while (top > 0) {
      const p = flood[--top]!;
      if (p < low) low = p;
      for (const d of DIRS) {
        const q = p + d.dy * w + d.dx;
        if (wall[q] || occupied[q] || seen[q] === stamp) continue;
        seen[q] = stamp;
        flood[top++] = q;
      }
    }
    return low;
  };

  /** Mark the player's whole region from `from` in regionSeen under a fresh stamp. */
  const markRegion = (from: number): void => {
    regionStamp++;
    let top = 0;
    flood[top++] = from;
    regionSeen[from] = regionStamp;
    while (top > 0) {
      const p = flood[--top]!;
      for (const d of DIRS) {
        const q = p + d.dy * w + d.dx;
        if (wall[q] || occupied[q] || regionSeen[q] === regionStamp) continue;
        regionSeen[q] = regionStamp;
        flood[top++] = q;
      }
    }
  };

  /** Whether the box just pushed onto `t` sits in a frozen 2x2 block of walls and boxes. */
  const inFrozenBlock = (t: number): boolean => {
    for (const a of [t, t - 1, t - w, t - w - 1]) {
      const b = a + 1;
      const c = a + w;
      const e = c + 1;
      if (!(wall[a] || occupied[a]) || !(wall[b] || occupied[b]) || !(wall[c] || occupied[c]) || !(wall[e] || occupied[e])) continue;
      if ((occupied[a] && !isGoal[a]) || (occupied[b] && !isGoal[b]) || (occupied[c] && !isGoal[c]) || (occupied[e] && !isGoal[e])) return true;
    }
    return false;
  };

  const stateKey = (boxes: number[], low: number): number => {
    let k = low;
    for (const b of boxes) k = k * size + b;
    return k;
  };

  for (const b of board.boxes) occupied[b] = 1;
  const startLow = regionLow(board.player);
  for (const b of board.boxes) occupied[b] = 0;

  const bestG = new Map<number, number>();
  bestG.set(stateKey(board.boxes, startLow), 0);
  const open = new Heap();
  const h0 = assignment(board.boxes);
  open.push(h0, h0, 0, 0);
  let order = 1;

  let found = -1;
  while (open.size > 0) {
    const [, , , s] = open.pop();
    const boxes = stateBoxes[s]!;
    const g = stateG[s]!;
    for (const b of boxes) occupied[b] = 1;
    const low = regionLow(statePlayer[s]!);
    if (bestG.get(stateKey(boxes, low)) !== g) {
      for (const b of boxes) occupied[b] = 0;
      continue; // a stale entry: this state was reached cheaper already
    }
    if (solved(boxes)) {
      found = s;
      for (const b of boxes) occupied[b] = 0;
      break;
    }
    markRegion(statePlayer[s]!);
    const here = regionStamp;
    for (let bi = 0; bi < boxes.length; bi++) {
      const b = boxes[bi]!;
      for (const d of DIRS) {
        const step = d.dy * w + d.dx;
        const dest = b + step;
        if (regionSeen[b - step] !== here || wall[dest] || occupied[dest] || !live[dest]) continue;
        occupied[b] = 0;
        occupied[dest] = 1;
        const frozen = inFrozenBlock(dest);
        let key = -1;
        let next: number[] | null = null;
        if (!frozen) {
          next = boxes.slice();
          next[bi] = dest;
          next.sort((x, y) => x - y);
          key = stateKey(next, regionLow(b));
        }
        occupied[dest] = 0;
        occupied[b] = 1;
        if (frozen || key < 0) continue;
        const ng = g + 1;
        const prev = bestG.get(key);
        if (prev !== undefined && prev <= ng) continue;
        if (budget.left <= 0 || shared.left <= 0) {
          for (const x of boxes) occupied[x] = 0;
          return null;
        }
        budget.left--;
        shared.left--;
        bestG.set(key, ng);
        const t = stateBoxes.length;
        stateBoxes.push(next);
        statePlayer.push(b);
        stateParent.push(s);
        stateFrom.push(b);
        stateTo.push(dest);
        stateG.push(ng);
        const h = assignment(next);
        open.push(greedy ? h : ng + h, h, order++, t);
      }
    }
    for (const b of boxes) occupied[b] = 0;
  }
  if (found < 0) return null;

  // Rebuild the moves: walk to each push's square, then push.
  const path: number[] = [];
  for (let s = found; s > 0; s = stateParent[s]!) path.push(s);
  path.reverse();
  let moves = '';
  let player = board.player;
  let boxes = board.boxes.slice();
  for (const s of path) {
    const from = stateFrom[s]!;
    const to = stateTo[s]!;
    const step = to - from;
    const dir = DIRS.find((d) => d.dy * w + d.dx === step)!;
    for (const b of boxes) occupied[b] = 1;
    moves += walkPath(w, wall, occupied, player, from - step);
    for (const b of boxes) occupied[b] = 0;
    moves += dir.push;
    player = from;
    boxes = stateBoxes[s]!.slice();
  }
  return { pushes: path.length, moves };
}

/** Shortest walk from `from` to `to` around walls and boxes, in LURD letters. */
function walkPath(w: number, wall: Uint8Array, occupied: Uint8Array, from: number, to: number): string {
  if (from === to) return '';
  const prev = new Int32Array(wall.length).fill(-1);
  const how: string[] = new Array(wall.length);
  const queue: number[] = [from];
  prev[from] = from;
  for (let qi = 0; qi < queue.length; qi++) {
    const p = queue[qi]!;
    if (p === to) break;
    for (const d of DIRS) {
      const q = p + d.dy * w + d.dx;
      if (wall[q] || occupied[q] || prev[q] !== -1) continue;
      prev[q] = p;
      how[q] = d.walk;
      queue.push(q);
    }
  }
  if (prev[to] === -1) throw new Error('walkPath: the push square is out of reach');
  let s = '';
  for (let p = to; p !== from; p = prev[p]!) s = how[p]! + s;
  return s;
}

/** The player's square after playing `moves` from `from` on a board `w` wide. */
function endSquare(w: number, from: number, moves: string): number {
  let p = from;
  for (const ch of moves.toLowerCase()) p += ch === 'u' ? -w : ch === 'd' ? w : ch === 'l' ? -1 : 1;
  return p;
}

/**
 * Solve one level: room by room when it is a set of rooms (each room solved
 * with the other rooms' boxes standing as walls, the player walking on from
 * where the last room left it), else one search over the whole level. A room
 * the optimal search gives up on is retried greedily, so a hard room still
 * earns partial credit instead of nothing. Returns the move string, or ''
 * when some room gives up even greedily.
 */
function solveLevel(board: Board, shared: { left: number }): string {
  const rooms = findRooms(board);
  if (rooms === null) {
    const whole = solveBoard(board, { left: ROOM_STATE_CAP }, shared)
      ?? solveBoard(board, { left: ROOM_STATE_CAP }, shared, true);
    return whole === null ? '' : whole.moves;
  }
  let player = board.player;
  let moves = '';
  const done = new Set<number>();
  for (let ri = 0; ri < rooms.length; ri++) {
    const room = rooms[ri]!;
    const wall = board.wall.slice();
    for (let oj = 0; oj < rooms.length; oj++) {
      if (oj === ri) continue;
      const other = rooms[oj]!;
      for (const b of done.has(oj) ? other.goals : other.boxes) wall[b] = 1;
    }
    const sub: Board = {
      w: board.w,
      h: board.h,
      wall,
      goals: room.goals.slice().sort((a, b) => a - b),
      boxes: room.boxes.slice().sort((a, b) => a - b),
      player,
    };
    const solved = solveBoard(sub, { left: ROOM_STATE_CAP }, shared)
      ?? solveBoard(sub, { left: ROOM_STATE_CAP }, shared, true);
    if (solved === null) return '';
    moves += solved.moves;
    player = endSquare(board.w, player, solved.moves);
    done.add(ri);
  }
  return moves;
}

const sharedBudget = { left: RUN_STATE_CAP };
for (const id of readdirSync(INPUT_DIR).sort()) {
  let moves = '';
  try {
    const board = parseBoard(readFileSync(join(INPUT_DIR, id, 'level.txt'), 'utf8'));
    moves = solveLevel(board, sharedBudget);
  } catch {
    moves = '';
  }
  mkdirSync(join(OUTPUT_DIR, id), { recursive: true });
  writeFileSync(join(OUTPUT_DIR, id, 'solution.txt'), `${moves}\n`);
}
