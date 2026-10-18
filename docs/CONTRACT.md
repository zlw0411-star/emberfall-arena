# Shared implementation contract

Browser native ES modules in dist/js. No external dependencies. Pure simulation importable by Node. All coordinates in world pixels, seconds for time; browser simulation fixed dt=1/60, RAF interpolation follows screen refresh. Headless rule simulations may use dt=1/30. Previous entity coordinates prevX/prevY support renderer interpolation.

## Architecture changes (2026-10-17 refactor)

Baseline tag `v1.0.0-baseline` marks the pre-refactor state. The architecture refactor is now included on `main`. Every stage must pass `npm run verify` with **byte-identical** per-second state hashes against the tracked `tests/baselines/state-baseline.json` (8 runs x ~500 hashes; classic and melee). Regenerate with `npm run snapshot:write` only when a behaviour change is intentional and documented.

### balance.js (new, zero dependencies)
Single source of numeric truth. Exports `ACTIVES` (per-skill rank scaling), `PASSIVE`, `ATTACK`, `MELEE_ACTIVE_WINDOW`, `MONSTERS`, `MONSTER_SPAWN_POLICY`, `BRUTE_HEAL_DROP_CHANCE`, `MONSTER_FALLBACK`, `isKnownMonster`, derived helpers (`fireballDamage`, `dashDistance`, `lungeDistance`, `whirlwindRadius`, `heavySlashRange`, `skillCooldown`, `bladeReachBonus`, ...), and `DESCRIPTIONS` which generates every Chinese skill description from those constants. `ai.js` imports the melee range helpers so AI reach decisions can never drift from combat execution. Nothing in this module may import combat.js.

Adding a skill now touches one file: add an `ACTIVES` entry, and (for actives) one row in `RANK_EFFECTS`, `CAST_EFFECTS` or `MELEE_SHAPES` inside combat.js. Missing table rows are rejected at cast time instead of falling through to a default branch.

Adding a monster type touches one file: add a `MONSTERS` entry. `spawnMonster` (stats), `tickMonster` (fallback speed), `classifyDamage` (attribution) and `damageCauseLabel` (display name) all read that table. `spawnSpeed` and `fallbackSpeed` are intentionally different values and must stay separate.

### modes.js (registry)
`MODES` is a registry populated by `registerMode(definition)`; registered modes are frozen and validated against 14 required fields. `unregisterMode(id)` exists for tests and refuses to remove the default. Every mode declares `skillsKey`, `combatKey`, `aiKey`, `weaponType`, `usesPointerAttack`, `bodyClass`, `attackControlHtml`, `portraitPose`, `damageLabel`, `damageDisplayMultiplier`. Modules resolve behaviour by looking up their own table with those keys: `SKILL_CATALOGS` / `TICKERS` / `CASTERS` / `ACTOR_SETUP` (combat.js), `THINKERS` (ai.js), `POSE_DRAWERS` (renderer.js). Simulation reads `modeOf(mode).usesPointerAttack` at input time, so modes registered after module import also receive player and AI attacks. No module may branch on `mode === 'melee'` or compare skill catalogs by identity. Registering a third mode must not require editing any branch.

### Determinism is enforced, not assumed
`game.rng` is mandatory. `randomFree`, `getChoices` and `dropGem` throw `TypeError` when no `rng` function is supplied; they never fall back to `Math.random`. `tests/determinism.test.js` covers this plus full-match reproducibility.

### Frontend split
`app.js` is an entry point only: it builds the layers and runs the fixed-step loop. `state.js` holds the single mutable session object (keeps hud/input/overlays free of circular imports). `dom.js` holds `$`, `show`, `timeText`, `beep`, `toast`. `hud.js` refreshes HUD by region and delegates input clearing through its injected actions on death/result. `app.js` must supply both flow callbacks and `input.clearInput` in that actions object. `input.js` owns keyboard, pointer and attack input plus blur-pause. `overlays.js` owns start/pause/menu/choice/help/spectate/sound flows. HUD reads `MODES[game.mode]` for labels and multipliers instead of branching on the mode name.

### Verification
`npm run verify` runs six checks: unit tests, full-match simulation at 60Hz for both modes, a DOM smoke test that boots the real `app.js` against a mock DOM/canvas, duel benchmarks, performance, and per-second state hash identity against the baseline. The DOM test covers start/pause/movement/melee input plus both modes' death, spectating, win/loss/same-step draw, input release, restarts and returning through the menu. It uses one monotonic clock for performance/rAF and verifies every frame schedules its successor, even after death or settlement. `npm test` still runs unit tests only.

## World (world.js, owned by map agent)
Exports MATCH_SIZE=12, rngFromSeed(seed)->function random in [0,1), generateMap(seed)->map, randomFree(map,rng,padding=24)->{x,y}, blocked(map,x,y,radius=12)->boolean, moveEntity(map,entity,dx,dy) mutates x/y with collision, lineClear(map,a,b)->boolean. map={width:2048,height:2048,tileSize:32,obstacles:[{x,y,w,h,kind}],traps:[{x,y,r,type:'spike'|'mud',offset}],spawnPoints:[12 {x,y}],freePoints:[{x,y}],seed}. Ensure radius 16 reachable connected ground, final center clear radius 100. Objects are solid rectangles. World generation deterministic. moveEntity uses entity.radius default12.

## AI (ai.js, owned by map agent)
Export think(game,actor,dt)->{mx,my,aimX,aimY,castSlot}; mx/my normalized movement, castSlot=-1 or active slot index. actor.ai can store routing state. game={map,rng,time,phase:'grace'|'hunt'|'finale',actors,monsters,gems,zone:null|{x,y,radius,initialRadius,startedAt},...}. Escape circle, avoid active spike (period4, active phase>=2.8), seek xp, hunt, retreat. Uses world helpers. No combat import (avoid cycle). Actors have activeSkills string array, skills object, cooldowns object.

## Combat (combat.js, owned by combat agent)
Current progression exports PROGRESSION={maxLevel:15,milestones:[2,4,6,8,10,12,14,15],maxActiveSkills:3}. HP and attack grow linearly every level; actor-kill XP is awarded only once to the real killer. Core map gems value5, normal monster xp15, brute xp25. All growth tuning lives in COMBAT_BALANCE and core CONFIG. Core pvpNotice10 schedules one public event at80s, app renders10..1 countdown without pausing.
Exports SKILLS object keyed id {name,description,icon,color,type:'active'|'passive',maxRank,cooldown}, createActor(id,name,x,y,isPlayer,color), addXp(game,actor,amount), getChoices(game,actor)->skill id[3], chooseSkill(game,actor,skillId)->boolean, castSkill(game,actor,slot,aimX,aimY)->boolean, updateCombat(game,dt), damage(game,target,amount,source=null).
Actor={id,name,x,y,radius:12,isPlayer,color,alive:true,hp,maxHp,level:1,xp:0,kills:0,monsterKills:0,damageDealt:0,speed,attackDamage,attackInterval,attackRange,attackTimer,pickupRadius,skills:{},activeSkills:[],cooldowns:{},pendingChoices:0,choices:[],...}. XP threshold export xpNeeded(level), max15 and choices only2/4/6/8/10/12/14/15. getChoices may populate choices. chooseSkill consumes one pending choice and refreshes if queued. AI auto chooses in updateCombat. No global pause ever in skill logic.
updateCombat handles actor cooldowns/autoattack, monster movement/melee, bullets, gem pickups, traps, hp regeneration, transient effects. It does NOT advance game.time, phase/zone, endgame, spawn monsters, or move actors. All spawns core-owned.
Monster={id,x,y,radius:11,hp,maxHp,speed,damage,attackTimer,alive:true,type:'slime'|'bat'|'brute',xp:10}. Gem={id,x,y,value,kind:'xp'|'heal'}. Bullet={x,y,vx,vy,radius,damage,ownerId,ttl,kind,color,...}. May add fields as needed; renderer draws these defensively.
Effects game.effects entries {x,y,kind:'text'|'burst'|'ring'|'slash',text?,color,ttl,maxTtl?,radius?}. game.events human readable entries {text,time,color?}, capped30; game.nextId integer. Helpers can push there. Killing monster add XP to owner and drops gems. Protection prevents any actor-v-actor damage including skills. Death clears pendingChoices,choices; no resurrection. Mud slow is handled by core using traps; spike damage combat. Traps cycle 4s active at phase>=2.8, warning>=2.1. No object sprites/assets required, root renderer handles.

## Core (simulation.js owned by root)
Exports CONFIG, createGame(seed), stepGame(game,dt,input={mx:0,my:0,aimX,aimY,castSlot:-1}), startFinale(game,reason='level'), spawnMonster(game), spawnGem(game). game.paused boolean, game.result=null|{winnerId:null|string,time}. startFinale once when any alive max15; disables future mob/gem spawn, zone safe center, initial radius covers entire map;10s warning+180 shrink. result resolved after all same-tick damage. Live time doesn't advance if paused or finished. At520s, a match still in hunt enters the same finale with reason=time. Simulation time is clamped to720s; at the deadline a remaining group is eliminated together by the final storm and draws. An existing sole survivor wins. Root handles players/bot movement+casts then updateCombat, spawn timers, shrinking circle+damage, result. input.autoPlayer=true drives player movement with AI; headless full-AI simulations additionally set all actors.isPlayer=false for automatic skill choices.

## Tests (tests agent)
Own tests/*.test.js, tests/simulate.js. Node built-in test runner. Test contracts, seeded maps reachability, grace, milestone queued selections, no pause during choice, maxlevel triggers once, no new spawns after finale, safe circle and final resolution. Wait until modules exist then run. Report bugs to owner rather than edit their modules.

## Mode and melee contract (2026-10-16)

createGame(seed, {mode}) accepts classic or melee; omission/unknown defaults classic. game.mode is enumerable and immutable for that round. New games/restarts configure every actor via configureActorForMode; one player plus11 AI. Classic SKILLS remains the original catalog export; getSkills(gameOrMode) returns the selected mode catalog. modes.js owns MODES, normalizeMode and MELEE_BALANCE.

Melee command extends movement/cast/aim with attackHeld and attackPressed. Core sets aimAngle from nonzero aim before skill casting and passes requests to combat. controls.js owns pointer capture and click-edge consumption; pause, death, blur and menu reset call clear. Canvas alone accepts attack presses, so clicking a choice card does not attack.

Melee action is actor.meleeAction={id,kind,phase,angle,range,arc,elapsed,windup,active,recovery,hitIds:Set,damage}; angles in radians, distances in world pixels. Every action has an actor-scoped monotonic unique id; no RNG consumption. Basic windup.20,active.08,total.65 seconds,sector120deg/range68,damage2.2*base; haste modifies interval and bladeReach adds4px/6deg per rank. Direction locks on startup, actor may move, valid targets hit once across active frames. LOS blocks all knife hits. Active skills interrupt basic, active actions do not interrupt one another. Death clears action and attack requests.

Independent melee pool: lunge/whirlwind/heavySlash(max4),power/haste/vitality/magnet/bladeReach(max5). Existing power/vitality/haste/magnet effects retained. lunge112+12*(r-1) movement then68px120deg hit,damage2.8+.3*(r-1),cd7. whirlwind radius78+6*(r-1),360deg,damage3+.3*(r-1),cd8. heavySlash windup.35,range96+6*(r-1),80deg,damage3.5+.4*(r-1),24px knockback,cd8. Skill damage coefficients multiply base attack and power. Skills active.08/recovery.25; lunge and whirlwind are immediate. Geometry and all growth/stage/settlement remain shared.

UI/input/renderer/simulation and publication owned by root; combat/catalog/modes by combat agent; ai.js by AI agent; tests/ by validation agent. Tests read GAME_MODE and SIM_HZ for explicit benchmark mode/rate.
