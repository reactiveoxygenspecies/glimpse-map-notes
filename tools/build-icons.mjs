// Generates the Glimpse map icon set: white symbols on a transparent background, like Foundry's own note icons.
// Run with `node tools/build-icons.mjs`; writes icons/*.svg and scripts/icon-set.mjs.
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* -------------------------------------------- */
/*  Drawing Helpers (100 x 100 canvas)          */
/* -------------------------------------------- */

/** A filled shape. Use `M...Z` sub-paths with evenodd to cut holes. */
const fill = d => `<path fill-rule="evenodd" d="${d}"/>`;

/** A stroked line. */
const line = (d, w = 6) => `<path fill="none" stroke-width="${w}" d="${d}"/>`;

const circle = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`;
const ring = (cx, cy, r, w = 6) => `<circle fill="none" stroke-width="${w}" cx="${cx}" cy="${cy}" r="${r}"/>`;
const rect = (x, y, w, h, rx = 0) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"/>`;

/** A house: body with a pitched roof, optional door cut-out. */
function house(x, y, w, h, {door = true} = {}) {
  const roof = w * 0.55;
  let d = `M${x} ${y + h}V${y}L${x + w / 2} ${y - roof}L${x + w} ${y}V${y + h}Z`;
  if ( door ) {
    const dw = w * 0.3;
    d += `M${x + (w - dw) / 2} ${y + h}V${y + h - h * 0.55}H${x + (w + dw) / 2}V${y + h}Z`;
  }
  return fill(d);
}

/** A pine tree. */
function pine(x, y, s) {
  return fill(`M${x} ${y}L${x + 13 * s} ${y + 18 * s}H${x + 6 * s}L${x + 16 * s} ${y + 32 * s}H${x + 3 * s}V${y + 40 * s}`
    + `H${x - 3 * s}V${y + 32 * s}H${x - 16 * s}L${x - 6 * s} ${y + 18 * s}H${x - 13 * s}Z`);
}

/** A regular star polygon. */
function starPoints(cx, cy, outer, inner, points = 5, rotation = -90) {
  const pts = [];
  for ( let i = 0; i < points * 2; i++ ) {
    const r = i % 2 ? inner : outer;
    const a = ((rotation + (i * 180) / points) * Math.PI) / 180;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return `M${pts.join("L")}Z`;
}

/** Rays around a centre, as a stroked path. */
function rays(cx, cy, r1, r2, count, offset = 0) {
  let d = "";
  for ( let i = 0; i < count; i++ ) {
    const a = ((offset + (i * 360) / count) * Math.PI) / 180;
    d += `M${(cx + r1 * Math.cos(a)).toFixed(1)} ${(cy + r1 * Math.sin(a)).toFixed(1)}`
      + `L${(cx + r2 * Math.cos(a)).toFixed(1)} ${(cy + r2 * Math.sin(a)).toFixed(1)}`;
  }
  return d;
}

/** A dashed stroked line. */
const dashed = (d, w = 6, dash = "8 9") => `<path fill="none" stroke-width="${w}" stroke-dasharray="${dash}" d="${d}"/>`;

/** An Archimedean spiral from the centre outwards, as a stroked path. */
function spiral(cx, cy, turns, growth, start = 2) {
  const pts = [];
  for ( let t = 0; t <= turns * Math.PI * 2; t += 0.15 ) {
    const r = start + growth * t;
    pts.push(`${(cx + r * Math.cos(t)).toFixed(1)} ${(cy + r * Math.sin(t)).toFixed(1)}`);
  }
  return `M${pts.join("L")}`;
}

/** A pentagram traced through every other point of a pentagon. */
function pentagram(cx, cy, r) {
  const pt = k => { const a = ((-90 + 72 * k) * Math.PI) / 180; return `${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)}`; };
  return `M${[0, 2, 4, 1, 3].map(pt).join("L")}Z`;
}

/* -------------------------------------------- */
/*  The Icons                                   */
/* -------------------------------------------- */

const ICONS = {
  settlements: {
    capital: [
      fill("M14 74L10 30L30 50L50 18L70 50L90 30L86 74Z"),
      rect(14, 80, 72, 10, 2),
      circle(10, 28, 6), circle(50, 15, 6), circle(90, 28, 6)
    ],
    city: [fill("M8 90V56H20V42L26 32L32 42V56H38V40A12 12 0 0 1 62 40V56H66V28L73 14L80 28V56H92V90Z"
      + "M14 64h6v8h-6zM48 62h6v8h-6zM72 40h4v8h-4zM80 64h6v8h-6zM26 64h6v8h-6z")],
    town: [house(8, 54, 26, 36, {door: false}), house(38, 40, 28, 50), house(70, 58, 22, 32, {door: false})],
    village: [house(10, 62, 24, 28), house(56, 62, 24, 28), house(33, 38, 22, 24, {door: false})],
    house: [fill("M14 90V48L50 18L86 48V90H62V66H38V90Z"), rect(64, 20, 9, 18)],
    farm: [fill("M12 90V50L30 32H70L88 50V90Z M40 90V64H60V90Z M44 50A6 6 0 0 1 56 50V54H44Z")],
    windmill: [
      fill("M40 90L44 50H56L60 90Z"),
      fill("M48 44L22 18L28 12L54 38Z M52 44L78 18L72 12L46 38Z M48 48L22 74L28 80L54 54Z M52 48L78 74L72 80L46 54Z"),
      circle(50, 46, 6)
    ],
    inn: [
      fill("M24 30H64V84A6 6 0 0 1 58 90H30A6 6 0 0 1 24 84Z"),
      line("M64 42H74A8 8 0 0 1 82 50V62A8 8 0 0 1 74 70H64", 7),
      fill("M20 30A10 10 0 0 1 34 18A12 12 0 0 1 56 16A10 10 0 0 1 68 30Z")
    ],
    market: [
      fill("M10 36L20 16H80L90 36A10 10 0 0 1 70 36A10 10 0 0 1 50 36A10 10 0 0 1 30 36A10 10 0 0 1 10 36Z"),
      rect(16, 44, 6, 46), rect(78, 44, 6, 46), rect(12, 62, 76, 10, 2)
    ],
    port: [
      ring(50, 18, 7),
      line("M50 26V86M34 38H66"),
      line("M18 62A32 28 0 0 0 82 62"),
      fill("M10 66L22 54L26 68Z M90 66L78 54L74 68Z")
    ],
    library: [fill("M8 26C20 20 36 20 47 28V86C36 78 20 78 8 84Z M53 28C64 20 80 20 92 26V84C80 78 64 78 53 86Z")],
    airship: [
      fill("M10 36C10 18 30 10 50 10C70 10 90 18 90 36C90 54 70 62 50 62C30 62 10 54 10 36Z"),
      line("M32 60L38 76M68 60L62 76", 4),
      fill("M28 76H72L66 90H34Z")
    ]
  },
  fortifications: {
    castle: [fill("M10 90V20H16V27H21V20H27V27H32V20H38V40H43V46H48V40H52V46H57V40H62V20H68V27H73V20H79V27H84V20H90V90Z"
      + "M42 90V74A8 8 0 0 1 58 74V90Z M20 38h6v10h-6z M74 38h6v10h-6z")],
    tower: [fill("M32 90L36 34H30V16H38V23H46V16H54V23H62V16H70V34H64L68 90Z M46 42h8v12h-8z M44 90V78A6 6 0 0 1 56 78V90Z")],
    watchtower: [
      fill("M24 32L50 10L76 32Z"), rect(30, 32, 40, 12, 2),
      line("M36 44L28 90M64 44L72 90M33 62L67 80M67 62L33 80", 5)
    ],
    fort: [fill([14, 26, 38, 50, 62, 74].map(x => `M${x} 90V38L${x + 6} 26L${x + 12} 38V90Z`).join("")
      + "M42 90V70A8 8 0 0 1 58 70V90Z")],
    gate: [fill("M12 90V24H30V16H70V24H88V90H66V58A16 16 0 0 0 34 58V90Z M18 32h8v8h-8z M74 32h8v8h-8z")],
    camp: [fill("M8 88L50 14L92 88Z M50 88L38 64L50 46L62 64Z"), line("M50 14L44 6M50 14L56 6", 4)],
    ruins: [fill("M14 90V40L20 34L26 42V90Z M40 90V24L46 18L52 28L48 34L52 40V90Z M66 90V52L74 46L80 56V90Z"),
      rect(8, 84, 84, 6, 2), fill("M58 80L70 72L76 78L64 86Z")]
  },
  sacred: {
    temple: [fill("M8 34L50 10L92 34Z"), rect(12, 38, 76, 6),
      rect(18, 48, 8, 32), rect(34, 48, 8, 32), rect(58, 48, 8, 32), rect(74, 48, 8, 32), rect(8, 82, 84, 8, 2)],
    shrine: [fill("M8 22C30 28 70 28 92 22L90 32H10Z"), rect(14, 40, 72, 7), rect(24, 30, 8, 60), rect(68, 30, 8, 60),
      rect(46, 30, 8, 10)],
    stones: [fill("M12 90V42C12 34 22 32 24 40L28 90Z M40 90L38 30H62L60 90Z M72 90L76 40C78 32 88 34 88 42V90Z"),
      rect(32, 22, 36, 9, 2)],
    obelisk: [fill("M38 90L42 22L50 10L58 22L62 90Z"), rect(30, 84, 40, 6, 2)],
    portal: [`<ellipse fill="none" stroke-width="8" cx="50" cy="52" rx="28" ry="40"/>`, fill(starPoints(50, 52, 20, 5, 4, -90))],
    crystal: [fill("M50 8L64 30L56 90H44L36 30Z M24 40L34 50L32 90H22L16 54Z M76 40L66 50L68 90H78L84 54Z")],
    eye: [fill("M6 50C24 22 76 22 94 50C76 78 24 78 6 50Z M50 50m-16 0a16 16 0 1 0 32 0a16 16 0 1 0 -32 0Z"),
      circle(50, 50, 8)],
    moon: [fill("M62 10A40 40 0 1 0 90 66A32 32 0 1 1 62 10Z")],
    sun: [circle(50, 50, 20), line(rays(50, 50, 28, 42, 12), 6)],
    star: [fill(starPoints(50, 52, 42, 18))],
    arcane: [ring(50, 50, 42, 5), line(pentagram(50, 51, 34), 4)]
  },
  nature: {
    mountain: [fill("M4 90L36 30L48 48L62 22L96 90Z M36 30L28 46L36 42L42 48Z M62 22L54 38L62 34L70 40Z")],
    volcano: [fill("M8 90L36 40H64L92 90Z M42 40L48 50L52 44L58 50L64 40Z"),
      fill("M44 34A8 8 0 0 1 48 20A10 10 0 0 1 64 16A8 8 0 0 1 64 32Z")],
    hills: [fill("M2 90C10 50 44 50 54 90Z M38 90C48 40 90 40 98 90Z")],
    forest: [pine(27, 36, 1.3), pine(73, 36, 1.3), pine(50, 12, 1.6)],
    tree: [fill("M50 10A22 22 0 0 1 72 26A18 18 0 0 1 80 58A18 18 0 0 1 58 68H55V90H45V68H42A18 18 0 0 1 20 58A18 18 0 0 1 28 26A22 22 0 0 1 50 10Z")],
    cave: [fill("M4 90C10 50 30 22 50 22C70 22 90 50 96 90Z M30 90C30 66 40 52 50 52C60 52 70 66 70 90Z")],
    desert: [circle(70, 26, 12), fill("M2 90C20 64 40 62 60 76C72 68 86 68 98 74V90Z")],
    oasis: [
      fill("M48 90L52 46H56L54 90Z"),
      fill("M54 44C40 30 22 32 12 42C26 38 40 40 54 48Z M54 44C60 26 78 20 92 28C78 30 66 36 56 48Z"
        + "M54 46C56 30 46 16 34 12C44 22 48 34 52 48Z"),
      fill("M14 88C14 80 34 76 50 76C66 76 86 80 86 88Z")
    ],
    mushroom: [fill("M10 56C10 30 30 14 50 14C70 14 90 30 90 56Z M40 56H60L62 90H38Z M30 34a6 6 0 1 0 0.1 0Z M62 30a7 7 0 1 0 0.1 0Z")],
    swamp: [line("M8 82C20 76 32 88 44 82C56 76 68 88 80 82C86 79 90 80 94 82", 5),
      line("M30 74V30M44 76V42M60 74V36M72 76V50", 4),
      fill("M26 30a4 9 0 1 0 8 0a4 9 0 1 0 -8 0Z M56 36a4 9 0 1 0 8 0a4 9 0 1 0 -8 0Z")]
  },
  water: {
    lake: [line("M8 34C20 26 32 42 44 34C56 26 68 42 80 34C86 30 90 31 94 34M8 54C20 46 32 62 44 54C56 46 68 62 80 54"
      + "C86 50 90 51 94 54M8 74C20 66 32 82 44 74C56 66 68 82 80 74C86 70 90 71 94 74", 6)],
    waterfall: [fill("M6 10H40V30H6Z M60 10H94V30H60Z"), line("M44 14V78M52 14V84M60 14V78", 6),
      line("M20 88C30 82 40 92 50 86C60 80 70 92 82 86", 5)],
    lighthouse: [fill("M38 90L42 40H58L62 90Z M42 30H58V40H42Z M40 30L50 18L60 30Z"),
      line("M30 30L14 24M30 38L14 44M70 30L86 24M70 38L86 44", 5), rect(30, 84, 40, 6, 2)],
    ship: [fill("M10 64H90L78 86H22Z"), fill("M48 58V10L22 56Z"), fill("M54 58V14L80 56Z"), rect(48, 8, 6, 56)],
    island: [fill("M10 82C20 70 40 66 50 66C60 66 80 70 90 82Z"),
      fill("M46 68L50 34H54L52 68Z"),
      fill("M52 32C40 20 24 22 16 32C28 28 40 30 52 36Z M52 32C58 18 74 14 86 22C74 22 62 28 54 36Z"),
      line("M8 92C20 88 32 94 44 90", 3)],
    whirlpool: [line(spiral(50, 50, 3.4, 1.95, 1), 6)],
    bridge: [fill("M4 46H96V56H86V90H74V74A24 24 0 0 0 26 74V90H14V56H4Z"), line("M10 46V30M30 46V30M50 46V30M70 46V30M90 46V30M4 30H96", 4)],
    well: [fill("M16 36L50 14L84 36Z"), line("M24 36V64M76 36V64", 6), line("M50 36V52", 3), rect(44, 52, 12, 10, 2),
      fill("M14 62H86V84A6 6 0 0 1 80 90H20A6 6 0 0 1 14 84Z")]
  },
  danger: {
    skull: [fill("M50 8C28 8 14 24 14 44C14 56 20 64 28 68V82A8 8 0 0 0 36 90H64A8 8 0 0 0 72 82V68C80 64 86 56 86 44C86 24 72 8 50 8Z"
      + "M26 44a10 10 0 1 0 20 0a10 10 0 1 0 -20 0Z M54 44a10 10 0 1 0 20 0a10 10 0 1 0 -20 0Z M44 66L50 56L56 66Z")],
    battle: [line("M18 18L74 74M82 18L26 74", 7), line("M64 84L84 64M16 64L36 84", 7),
      fill("M76 76L90 90M24 76L10 90"), circle(86, 86, 6), circle(14, 86, 6)],
    danger: [fill("M50 8L94 88H6Z M44 36H56L54 64H46Z M45 72h10v10h-10z")],
    graveyard: [fill("M24 90V40A26 26 0 0 1 76 40V90Z M46 34h8v12h12v8h-12v22h-8v-22h-12v-8h12z"), rect(10, 86, 80, 6, 2)],
    web: [line("M50 6V94M6 50H94M19 19L81 81M81 19L19 81", 3),
      line(["M50 18L73 27L82 50L73 73L50 82L27 73L18 50L27 27Z", "M50 32L63 37L68 50L63 63L50 68L37 63L32 50L37 37Z",
        "M50 4L82 18L96 50L82 82L50 96L18 82L4 50L18 18Z"].join(""), 3)],
    flame: [fill("M50 6C58 26 80 38 80 62A30 30 0 0 1 20 62C20 46 30 38 34 26C40 36 42 44 48 46C52 34 50 20 50 6Z"
      + "M50 90A14 14 0 0 1 36 74C36 64 44 60 46 52C50 60 64 64 64 74A14 14 0 0 1 50 90Z")],
    lair: [`<g transform="rotate(28 50 50)">${fill([0, 24, 48].map(dx => `M${18 + dx} 10C${42 + dx} 34 ${40 + dx} 66 ${16 + dx} 92C${30 + dx} 66 ${30 + dx} 36 ${18 + dx} 10Z`).join(""))}</g>`]
  },
  markers: {
    pin: [fill("M50 94C50 94 18 58 18 38A32 32 0 0 1 82 38C82 58 50 94 50 94Z M50 38m-12 0a12 12 0 1 0 24 0a12 12 0 1 0 -24 0Z")],
    flag: [rect(16, 8, 7, 86, 2), fill("M23 12H84L72 32L84 52H23Z")],
    compass: [ring(50, 50, 40, 5), fill("M50 12L58 50L50 88L42 50Z M12 50L50 44L88 50L50 56Z"), circle(50, 50, 5)],
    signpost: [rect(45, 10, 10, 82, 2), fill("M14 18H70L82 28L70 38H14Z M86 46H30L18 56L30 66H86Z")],
    quest: [fill("M42 8H58L55 64H45Z"), circle(50, 82, 8)],
    mystery: [line("M30 32A20 20 0 1 1 58 50C52 54 50 58 50 66", 9), circle(50, 84, 7)],
    key: [ring(28, 50, 16, 8), fill("M42 46H92V56H84V70H74V56H66V66H56V56H42Z")],
    treasure: [fill("M10 46A16 16 0 0 1 26 30H74A16 16 0 0 1 90 46V52H10Z M10 58H90V88H10Z M44 52H56V68H44Z")],
    scroll: [fill("M24 14H76A10 10 0 0 1 86 24V30H76V80A10 10 0 0 1 66 90H20A10 10 0 0 1 10 80V74H24Z"
      + "M30 30h36v5h-36z M30 44h36v5h-36z M30 58h28v5h-28z")],
    trail: [dashed("M10 88C28 78 22 58 40 52C58 46 56 30 68 26", 6), line("M72 8L90 26M90 8L72 26", 7)],
    campfire: [fill("M50 10C56 24 70 32 70 48A20 20 0 0 1 30 48C30 38 36 32 40 24C44 32 46 36 50 36C52 28 52 20 50 10Z"),
      line("M18 78L82 92M18 92L82 78", 9)],
    mine: [line("M20 82L72 30M80 82L28 30", 7),
      fill("M60 14C74 16 86 28 88 42L76 34L68 26Z M40 14C26 16 14 28 12 42L24 34L32 26Z")],
    shield: [fill("M50 8L86 20V46C86 70 70 86 50 94C30 86 14 70 14 46V20Z M50 20L74 28V46C74 62 64 74 50 80Z")]
  },
  shapes: {
    circle: [circle(50, 50, 38)],
    ring: [ring(50, 50, 34, 10)],
    square: [rect(14, 14, 72, 72, 6)],
    frame: [`<rect fill="none" stroke-width="10" x="19" y="19" width="62" height="62" rx="4"/>`],
    triangle: [fill("M50 10L92 86H8Z")],
    "triangle-down": [fill("M50 90L92 14H8Z")],
    "triangle-outline": [fill("M50 10L92 86H8Z M50 34L72 74H28Z")],
    diamond: [fill("M50 6L92 50L50 94L8 50Z")],
    "diamond-outline": [fill("M50 8L88 50L50 92L12 50Z M50 26L72 50L50 74L28 50Z")],
    hexagon: [fill("M50 8L86 29V71L50 92L14 71V29Z")],
    plus: [fill("M40 10H60V40H90V60H60V90H40V60H10V40H40Z")]
  }
};

/* -------------------------------------------- */
/*  Output                                      */
/* -------------------------------------------- */

const svg = body => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="512" height="512">`
  + `<g fill="#fff" stroke="#fff" stroke-linecap="round" stroke-linejoin="round" stroke-width="0">${body.join("")}</g></svg>\n`;

const outDir = path.join(root, "icons");
fs.mkdirSync(outDir, {recursive: true});
for ( const f of fs.readdirSync(outDir) ) if ( f.endsWith(".svg") ) fs.unlinkSync(path.join(outDir, f));

const list = [];
for ( const [category, icons] of Object.entries(ICONS) ) {
  for ( const [name, body] of Object.entries(icons) ) {
    fs.writeFileSync(path.join(outDir, `${name}.svg`), svg(body));
    list.push({id: name, category});
  }
}

const moduleSource = `// Generated by tools/build-icons.mjs. Do not edit by hand.
export const ICON_CATEGORIES = ${JSON.stringify(Object.keys(ICONS))};

export const ICON_SET = ${JSON.stringify(list, null, 0).replace(/\},\{/g, "},\n  {").replace("[{", "[\n  {").replace("}]", "}\n]")};
`;
fs.writeFileSync(path.join(root, "scripts", "icon-set.mjs"), moduleSource);
console.log(`Wrote ${list.length} icons in ${Object.keys(ICONS).length} categories.`);
