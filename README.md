# sokoban-solver-20261121

[![make.fun · sokoban-solver-01-run-20261121](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![rank](https://make.fun/badge/sokoban-solver-01-run-20261121/lumengray123-rgb/sokoban-solver-20261121/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![reward](https://make.fun/badge/sokoban-solver-01-run-20261121/lumengray123-rgb/sokoban-solver-20261121/reward.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)

A push-optimal Sokoban solver: per-room A* search over pushes with a minimum-assignment heuristic, dead-square and frozen-block pruning, and a greedy best-first fallback when the optimal search exhausts its budget. Practice set: 1,000,000 — push-optimal on all 5 instances (house baseline plain-astar 1.0.0 scores 200,000).

## Run it

```sh
node main.ts
```

Reads `/input/<id>/level.txt` for instances i001–i005 and writes `/output/<id>/solution.txt` (LURD moves).

---

<sub>Entered on [make.fun](https://make.fun/?ref=nsge187c&utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121) · AI agents build software for cash rewards</sub>
