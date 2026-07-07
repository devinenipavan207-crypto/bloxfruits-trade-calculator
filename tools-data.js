/* ─── Blox Fruits Game Data for Tools ───
   Max Level: 2600  |  Stats per level: 3  |  Total stat points: 7800
   Stat caps for all 5 stats: 2600 each */

var MAX_LEVEL = 2600;
var STATS_PER_LEVEL = 3;
var MAX_STAT = 2600;

/* ─── Stat Names ─── */
var STAT_NAMES = ["Melee", "Defense", "Sword", "Gun", "Fruit"];

/* ─── Build Templates (recommended stat splits) ─── */
var BUILD_TEMPLATES = [
  { id: "sword", name: "Sword Main", icon: "🗡️", stats: { Melee: 0, Defense: 800, Sword: 2600, Gun: 0, Fruit: 0 }, desc: "Max Sword, rest Defense" },
  { id: "fruit", name: "Fruit Main", icon: "🌀", stats: { Melee: 0, Defense: 800, Sword: 0, Gun: 0, Fruit: 2600 }, desc: "Max Fruit, rest Defense" },
  { id: "gun", name: "Gun Main", icon: "🔫", stats: { Melee: 0, Defense: 800, Sword: 0, Gun: 2600, Fruit: 0 }, desc: "Max Gun, rest Defense" },
  { id: "hybrid", name: "Hybrid", icon: "⚖️", stats: { Melee: 0, Defense: 800, Sword: 1300, Gun: 0, Fruit: 1300 }, desc: "Split Sword & Fruit" },
  { id: "tank", name: "Tank", icon: "🛡️", stats: { Melee: 0, Defense: 2600, Sword: 800, Gun: 0, Fruit: 0 }, desc: "Max Defense, rest Sword" },
  { id: "dragon", name: "Dragon", icon: "🐉", stats: { Melee: 0, Defense: 1300, Sword: 0, Gun: 0, Fruit: 2600 }, desc: "Max Fruit, half Defense (Dragon rework)" },
];

/* ─── XP Table (per level) ───
   Generates XP required per level based on Blox Fruits curve */
function generateXPTable() {
  var table = [];
  var total = 0;
  for (var i = 1; i <= MAX_LEVEL; i++) {
    var xp = Math.floor(5 * i * (1 + i / 500));
    total += xp;
    table.push({ level: i, xpToNext: xp, totalXP: total });
  }
  return table;
}
var XP_TABLE = generateXPTable();

/* ─── Damage Calculator Formulas (simplified) ───
   Based on community-tested values */
function calcDamage(statValue, baseDamage, mastery) {
  var statMult = 1 + (statValue / MAX_STAT) * 0.7;
  var masteryMult = 1 + (mastery || 1) * 0.02;
  return Math.floor(baseDamage * statMult * masteryMult);
}

/* ─── NPC Bosses ─── */
var BOSSES = [
  { name: "Saber Expert", level: 200, hp: 31500, damage: "Medium", drops: "Saber (sword)", location: "Jungle (secret)", img: "" },
  { name: "Rich Boy", level: 280, hp: 43500, damage: "Medium", drops: "Bisento (sword)", location: "Middle Town", img: "" },
  { name: "Smoke Admiral", level: 350, hp: 55000, damage: "High", drops: "Smoke Fruit", location: "Marine Fortress", img: "" },
  { name: "Diamond", level: 490, hp: 80000, damage: "High", drops: "Diamond Fruit", location: "Ice Island", img: "" },
  { name: "Yama", level: 560, hp: 100000, damage: "High", drops: "Saber (duel)", location: "Snow Mountain", img: "" },
  { name: "Darkbeard", level: 700, hp: 140000, damage: "Very High", drops: "Dark Dagger, Dark Coat", location: "Cursed Ship", img: "" },
  { name: "Don Swan", level: 800, hp: 180000, damage: "Very High", drops: "Don Swan's Coat", location: "Ice Castle", img: "" },
  { name: "Sad Miracle", level: 900, hp: 220000, damage: "Very High", drops: "Mirage Staff", location: "Mirage Island", img: "" },
  { name: "Beautiful Pirate", level: 1000, hp: 280000, damage: "Extreme", drops: "Beautiful Sword", location: "Haunted Castle", img: "" },
  { name: "Awakened Ice Admiral", level: 1100, hp: 350000, damage: "Extreme", drops: "Ice Fruit, Large Soul", location: "Ice Castle", img: "" },
  { name: "Cursed Captain", level: 1200, hp: 420000, damage: "Extreme", drops: "Cursed Dual Katana", location: "Cursed Ship", img: "" },
  { name: "Dough King", level: 1300, hp: 500000, damage: "Extreme", drops: "Dough Fruit", location: "Hot & Cold", img: "" },
  { name: "Cake Queen", level: 1400, hp: 600000, damage: "Extreme", drops: "Cake Fruit", location: "Cake Island", img: "" },
  { name: "Flower Admiral", level: 1600, hp: 800000, damage: "Insane", drops: "Blade of the Flower", location: "Hydra Island", img: "" },
  { name: "Longma", level: 1750, hp: 1000000, damage: "Insane", drops: "Longma (mount)", location: "Sea of Treats", img: "" },
  { name: "Rip Indra", level: 1850, hp: 1200000, damage: "Insane", drops: "Dark Dagger V2", location: "Under Island", img: "" },
  { name: "Indra", level: 2000, hp: 1500000, damage: "Insane", drops: "True Triple Katana, Soul Guitar", location: "Indra's Arena", img: "" },
  { name: "Lion", level: 2100, hp: 1800000, damage: "Insane", drops: "Great Flamingo Coat", location: "Sea of Treats", img: "" },
  { name: "Soul Reaper", level: 2200, hp: 2200000, damage: "Insane", drops: "Soul Cane", location: "Haunted Castle", img: "" },
  { name: "Caviar", level: 2400, hp: 2800000, damage: "Insane", drops: "Caviar Coat", location: "Tiki Outpost", img: "" },
];

/* ─── Fruit Spawn Locations ─── */
var FRUIT_SPAWN_LOCATIONS = [
  { name: "Rocket", island: "Jungle", area: "Behind tree near river", sea: "First", img: "" },
  { name: "Bomb", island: "Pirate Village", area: "On rooftop", sea: "First", img: "" },
  { name: "Spin", island: "Shell Town", area: "West side alley", sea: "First", img: "" },
  { name: "Chop", island: "Desert", area: "Near house interior", sea: "First", img: "" },
  { name: "Spring", island: "Pirate Village", area: "Waterfall cave", sea: "First", img: "" },
  { name: "Kilo", island: "Marine Start", area: "Behind building", sea: "First", img: "" },
  { name: "Smoke", island: "Marine Fortress", area: "Top of castle", sea: "First", img: "" },
  { name: "Spike", island: "Desert", area: "Near pond", sea: "First", img: "" },
  { name: "Flame", island: "Ice Island", area: "Behind frozen waterfall", sea: "First", img: "" },
  { name: "Falcon", island: "Skylands", area: "Top floating island", sea: "First", img: "" },
  { name: "Ice", island: "Ice Island", area: "Castle top", sea: "Second", img: "" },
  { name: "Light", island: "Mansion", area: "Roof of mansion", sea: "Second", img: "" },
  { name: "Dark", island: "Cursed Ship", area: "Ship deck", sea: "Second", img: "" },
  { name: "Diamond", island: "Ice Castle", area: "Top tower", sea: "Second", img: "" },
  { name: "Rumble", island: "Kingdom of Rose", area: "Behind throne", sea: "Second", img: "" },
  { name: "Magma", island: "Prison", area: "Volcano interior", sea: "Second", img: "" },
  { name: "Water", island: "Fountain Town", area: "Fountain base", sea: "Second", img: "" },
  { name: "Ghost", island: "Haunted Castle", area: "Graveyard", sea: "Second", img: "" },
  { name: "Sand", island: "Desert", area: "Pyramid top", sea: "First", img: "" },
  { name: "Dark", island: "Cursed Ship", area: "Ship deck", sea: "Second", img: "" },
  { name: "Rubber", island: "Pirate Village", area: "Dock", sea: "First", img: "" },
  { name: "Barrier", island: "Middle Town", area: "Behind bank", sea: "First", img: "" },
  { name: "Dough", island: "Dough Island", area: "Inside cake castle", sea: "Third", img: "" },
  { name: "Shadow", island: "Haunted Castle", area: "Basement", sea: "Third", img: "" },
  { name: "Venom", island: "Hydra Island", area: "Jungle cave", sea: "Third", img: "" },
  { name: "Control", island: "Sea of Treats", area: "Floating island top", sea: "Third", img: "" },
  { name: "Spirit", island: "Cursed Ship V2", area: "Ship bow", sea: "Third", img: "" },
  { name: "Dragon", island: "Under Island", area: "Dragon's nest", sea: "Third", img: "" },
  { name: "Leopard", island: "Under Island", area: "Secret cave behind waterfall", sea: "Third", img: "" },
  { name: "Yeti", island: "Snow Mountain", area: "Ice cave", sea: "Third", img: "" },
  { name: "Kitsune", island: "Sea of Treats", area: "Shrine top", sea: "Third", img: "" },
  { name: "Gas", island: "Tiki Outpost", area: "Volcano crater", sea: "Third", img: "" },
  { name: "Mammoth", island: "Ice Island", area: "Frozen lake center", sea: "Third", img: "" },
  { name: "Trex", island: "Jungle", area: "Ancient temple ruins", sea: "Third", img: "" },
  { name: "Phoenix", island: "Skylands", area: "Highest island", sea: "Third", img: "" },
];

/* ─── Recommended Builds (for Build Optimizer) ─── */
var RECOMMENDED_BUILDS = [
  {
    name: "Buddha Sword",
    type: "PvE Farming",
    fruit: "Buddha",
    stats: { Melee: 0, Defense: 1300, Sword: 2600, Gun: 0, Fruit: 0 },
    weapons: "Saber / Dark Dagger / TTK",
    fighting: "Electric / Water Kung Fu",
    desc: "Best for grinding. Buddha's hitbox + sword damage."
  },
  {
    name: "Dragon Tank",
    type: "PvP",
    fruit: "Dragon",
    stats: { Melee: 0, Defense: 2000, Sword: 0, Gun: 0, Fruit: 2600 },
    weapons: "Soul Cane (stun)",
    fighting: "Godhuman",
    desc: "Unkillable in Dragon form. Max Fruit + high Defense."
  },
  {
    name: "Kitsune Rush",
    type: "PvP",
    fruit: "Kitsune",
    stats: { Melee: 0, Defense: 800, Sword: 0, Gun: 0, Fruit: 2600 },
    weapons: "Cursed Dual Katana",
    fighting: "Godhuman",
    desc: "Insane speed + combo potential."
  },
  {
    name: "Dark Gunner",
    type: "PvP Hybrid",
    fruit: "Dark",
    stats: { Melee: 0, Defense: 800, Sword: 0, Gun: 2600, Fruit: 800 },
    weapons: "Skull Guitar / Serpent Bow",
    fighting: "Death Step",
    desc: "Dark's teleport + gun damage."
  },
  {
    name: "Flame Hybrid",
    type: "PvE/PvP",
    fruit: "Flame",
    stats: { Melee: 0, Defense: 800, Sword: 1300, Gun: 0, Fruit: 1300 },
    weapons: "Saber / Bisento",
    fighting: "Dragon Breath",
    desc: "Budget-friendly. Good for both PvE and PvP."
  },
  {
    name: "Yeti Brawler",
    type: "PvP",
    fruit: "Yeti",
    stats: { Melee: 0, Defense: 1300, Sword: 0, Gun: 0, Fruit: 2600 },
    weapons: "Dark Dagger",
    fighting: "Godhuman",
    desc: "Yeti freeze + high fruit damage."
  },
];

/* ─── Fruit Mastery Levels ───
   1–350 mastery per fruit for unlockable moves */
var MASTERY_LEVELS = [
  { level: 1, movesUnlock: 1 },
  { level: 50, movesUnlock: 2 },
  { level: 100, movesUnlock: 3 },
  { level: 200, movesUnlock: 4 },
  { level: 350, movesUnlock: 5 },
];

/* ─── Sword Mastery Levels ─── */
var SWORD_MASTERY_LEVELS = [
  { level: 1, movesUnlock: 1 },
  { level: 50, movesUnlock: 2 },
  { level: 100, movesUnlock: 3 },
  { level: 200, movesUnlock: 4 },
  { level: 350, movesUnlock: 5 },
];

/* ─── Fighting Style Mastery ─── */
var FIGHTING_STYLES = [
  { name: "Combat", levelReq: 1, masteryReq: 0 },
  { name: "Dragon Breath", levelReq: 400, masteryReq: 50 },
  { name: "Electric", levelReq: 600, masteryReq: 100 },
  { name: "Water Kung Fu", levelReq: 800, masteryReq: 150 },
  { name: "Fishman Karate", levelReq: 1000, masteryReq: 200 },
  { name: "Dark Step", levelReq: 1200, masteryReq: 300 },
  { name: "Electro", levelReq: 1400, masteryReq: 350 },
  { name: "Godhuman", levelReq: 1800, masteryReq: 400 },
  { name: "Superhuman", levelReq: 2000, masteryReq: 450 },
  { name: "Sanguine Art", levelReq: 2300, masteryReq: 500 },
  { name: "Dragon Talon", levelReq: 2500, masteryReq: 600 },
];
