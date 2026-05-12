/**
 * Levels — sequential level progression (WO-016, REQ-015).
 *
 * The manager owns an ordered list of levels and the current index. Callers
 * drive transitions:
 *
 *   reachGoal()         → flips into transitioning state; isTransitioning()
 *                         is true while the caller shows a level-transition
 *                         screen.
 *   completeTransition()→ advances to the next level OR fires onVictory if
 *                         the goal was reached on the final level.
 *
 * The module is pure data orchestration — it does NOT mutate the tilemap,
 * camera, or entity pools directly. The integration layer hooks via
 * `onLoadLevel(level, index)` to rebuild the world for the new map and
 * `onVictory()` to trigger the victory state.
 *
 * Maps include three new sentinel chars in addition to the regular tile +
 * sensor chars already defined elsewhere:
 *
 *   P — player spawn (non-solid sensor; consumed by getSpawnPosition)
 *   G — goal flag (existing — handled by goalContact)
 *
 * Each level's `map` is the same 32-char-wide grid format the rest of the
 * codebase already speaks, so tilemap.charAt/tileAt continue to work
 * unchanged.
 */
(function (root) {
  'use strict';

  const SPAWN_CHAR = 'P';
  const GOAL_CHAR = 'G';
  const DEFAULT_SPAWN = Object.freeze({ x: 32, y: 100 });

  // -------- Level data — three themed maps. --------
  // Grasslands (Level 1): introduces ground + platforms + a coin + a mystery.
  const LEVEL_GRASSLANDS = [
    '................................',
    '................................',
    '................................',
    '................................',
    '........=====...................',
    '....................f....c.c....',
    '................=====...........',
    '..........c.....................',
    '....======...M.....M.......h....',
    'P..c.c....................G.....',
    '...............g........ssg.....',
    '################################',
    '################################',
  ];

  // Cave (Level 2): tight corridors, more spikes, mystery placement adjusted.
  const LEVEL_CAVE = [
    '################################',
    '#..............................#',
    '#............ssss..............#',
    '#............####..............#',
    '#.....=====.................c..#',
    '#............................g.#',
    '#............=========.........#',
    '#.M.................c..........#',
    '#====...........ss.............#',
    '#P..............##........h.G..#',
    '#..f...........................#',
    '################################',
    '################################',
  ];

  // Sky (Level 3): wide gaps, lots of moving platforms, final goal.
  const LEVEL_SKY = [
    '................................',
    '................................',
    'P............................G..',
    '###....h..........v..........###',
    '...........................##...',
    '...c..............M.c...........',
    '......======................f...',
    '..............h.................',
    '....f...........................',
    '..ss............................',
    '##...........====...........====',
    '................................',
    '................................',
  ];

  const DEFAULT_LEVELS = Object.freeze([
    Object.freeze({ name: 'Grasslands', map: Object.freeze(LEVEL_GRASSLANDS.slice()) }),
    Object.freeze({ name: 'Cave', map: Object.freeze(LEVEL_CAVE.slice()) }),
    Object.freeze({ name: 'Sky', map: Object.freeze(LEVEL_SKY.slice()) }),
  ]);

  function createLevelManager(config) {
    const cfg = config || {};
    const levels = cfg.levels ? cfg.levels.slice() : DEFAULT_LEVELS.slice();
    if (levels.length === 0) throw new RangeError('createLevelManager: at least one level required');

    let index = 0;
    let transitioning = false;
    let pendingVictory = false;

    function currentLevel() { return levels[index]; }
    function currentIndex() { return index; }
    function totalLevels() { return levels.length; }
    function isVictoryNext() { return index >= levels.length - 1; }
    function isTransitioning() { return transitioning; }

    // Scan the current level's map for the spawn marker; fall back to the
    // canonical default (32, 100) if none is present so older maps still work.
    function getSpawnPositionFor(level) {
      const tileSize = cfg.tileSize || 16;
      if (!level || !level.map) return { x: DEFAULT_SPAWN.x, y: DEFAULT_SPAWN.y };
      for (let ty = 0; ty < level.map.length; ty++) {
        const row = level.map[ty];
        for (let tx = 0; tx < row.length; tx++) {
          if (row.charAt(tx) === SPAWN_CHAR) {
            return { x: tx * tileSize, y: ty * tileSize };
          }
        }
      }
      return { x: DEFAULT_SPAWN.x, y: DEFAULT_SPAWN.y };
    }

    function getSpawnPosition() { return getSpawnPositionFor(currentLevel()); }

    // Goal contact: player's AABB overlaps any tile marked 'G' in the tilemap.
    function goalContact(player, tilemap) {
      if (!tilemap || typeof tilemap.charAt !== 'function') return false;
      const ts = tilemap.tileSize || cfg.tileSize || 16;
      const tx0 = Math.floor(player.x / ts);
      const ty0 = Math.floor(player.y / ts);
      const tx1 = Math.floor((player.x + player.w - 0.0001) / ts);
      const ty1 = Math.floor((player.y + player.h - 0.0001) / ts);
      for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          if (tilemap.charAt(tx, ty) === GOAL_CHAR) return true;
        }
      }
      return false;
    }

    // Caller fires this when the player reaches the goal. Captures whether
    // the upcoming transition will roll into victory so the transition screen
    // can show the correct label.
    function reachGoal() {
      if (transitioning) return;
      transitioning = true;
      pendingVictory = isVictoryNext();
    }

    // Caller fires this after the transition screen finishes. Advances the
    // level index (or triggers onVictory) and invokes onLoadLevel.
    function completeTransition() {
      if (!transitioning) return;
      transitioning = false;
      if (pendingVictory) {
        pendingVictory = false;
        if (typeof cfg.onVictory === 'function') cfg.onVictory();
        return;
      }
      index++;
      if (typeof cfg.onLoadLevel === 'function') {
        cfg.onLoadLevel(currentLevel(), index);
      }
    }

    function reset() {
      index = 0;
      transitioning = false;
      pendingVictory = false;
      if (typeof cfg.onLoadLevel === 'function') {
        cfg.onLoadLevel(currentLevel(), 0);
      }
    }

    // For tests / UI peeking at the upcoming label.
    function nextLevelName() {
      const next = levels[index + 1];
      return next ? next.name : null;
    }

    return {
      currentLevel: currentLevel,
      currentIndex: currentIndex,
      totalLevels: totalLevels,
      isVictoryNext: isVictoryNext,
      isTransitioning: isTransitioning,
      getSpawnPosition: getSpawnPosition,
      getSpawnPositionFor: getSpawnPositionFor,
      goalContact: goalContact,
      reachGoal: reachGoal,
      completeTransition: completeTransition,
      nextLevelName: nextLevelName,
      reset: reset,
      // Test hooks
      _levels: levels,
      constants: Object.freeze({
        tileSize: cfg.tileSize || 16,
        SPAWN_CHAR: SPAWN_CHAR,
        GOAL_CHAR: GOAL_CHAR,
      }),
    };
  }

  const api = {
    createLevelManager: createLevelManager,
    DEFAULT_LEVELS: DEFAULT_LEVELS,
    LEVEL_GRASSLANDS: LEVEL_GRASSLANDS,
    LEVEL_CAVE: LEVEL_CAVE,
    LEVEL_SKY: LEVEL_SKY,
    SPAWN_CHAR: SPAWN_CHAR,
    GOAL_CHAR: GOAL_CHAR,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.LevelsModule = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
