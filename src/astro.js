/**
 * A small self-contained ephemeris.
 *
 * No external service, deliberately: a chart that depends on someone else's
 * API stops working the day their token is revoked, silently.
 *
 * Planetary positions use JPL's "Approximate Positions of the Planets"
 * Keplerian elements with secular rates, valid 1800–2050. The Moon uses the
 * principal ELP terms. Accuracy is a few arcminutes for the planets and
 * roughly a third of a degree for the Moon — far finer than the sign and
 * house boundaries this is used for, though a placement within about half a
 * degree of a cusp should be treated as uncertain.
 *
 * Houses are whole-sign: the sign containing the Ascendant is the first
 * house and each following sign is the next. It is the oldest system, it
 * needs no quadrant division, and it degrades gracefully when a birth time
 * is approximate.
 */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

export const SIGNS = ["Aries","Taurus","Gemini","Cancer","Leo","Virgo",
                      "Libra","Scorpio","Sagittarius","Capricorn","Aquarius","Pisces"];

// a, e, I, L, longitude of perihelion, longitude of ascending node — and rates per century.
const ELEMENTS = {
  mercury: [0.38709927,0.20563593,7.00497902,252.25032350,77.45779628,48.33076593,
            0.00000037,0.00001906,-0.00594749,149472.67411175,0.16047689,-0.12534081],
  venus:   [0.72333566,0.00677672,3.39467605,181.97909950,131.60246718,76.67984255,
            0.00000390,-0.00004107,-0.00078890,58517.81538729,0.00268329,-0.27769418],
  earth:   [1.00000261,0.01671123,-0.00001531,100.46457166,102.93768193,0.0,
            0.00000562,-0.00004392,-0.01294668,35999.37244981,0.32327364,0.0],
  mars:    [1.52371034,0.09339410,1.84969142,-4.55343205,-23.94362959,49.55953891,
            0.00001847,0.00007882,-0.00813131,19140.30268499,0.44441088,-0.29257343],
  jupiter: [5.20288700,0.04838624,1.30439695,34.39644051,14.72847983,100.47390909,
            -0.00011607,-0.00013253,-0.00183714,3034.74612775,0.21252668,0.20469106],
  saturn:  [9.53667594,0.05386179,2.48599187,49.95424423,92.59887831,113.66242448,
            -0.00125060,-0.00050991,0.00193609,1222.49362201,-0.41897216,-0.28867794],
  uranus:  [19.18916464,0.04725744,0.77263783,313.23810451,170.95427630,74.01692503,
            -0.00196176,-0.00004397,-0.00242939,428.48202785,0.40805281,0.04240589],
  neptune: [30.06992276,0.00859048,1.77004347,-55.12002969,44.96476227,131.78422574,
            0.00026291,0.00005105,0.00035372,218.45945325,-0.32241464,-0.00508664],
  pluto:   [39.48211675,0.24882730,17.14001206,238.92903833,224.06891629,110.30393684,
            -0.00031596,0.00005170,0.00004818,145.20780515,-0.04062942,-0.01183482],
};

const norm = d => ((d % 360) + 360) % 360;

/** Julian Day from a UTC calendar date and fractional hour. */
export function julianDay(year, month, day, hourUT = 0) {
  let y = year, m = month;
  if (m <= 2) { y -= 1; m += 12; }
  const A = Math.floor(y / 100);
  const B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1))
       + day + B - 1524.5 + hourUT / 24;
}

function kepler(M, e) {
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 12; i++) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-11) break;
  }
  return E;
}

/** Heliocentric ecliptic rectangular coordinates, in AU. */
function heliocentric(key, T) {
  const el = ELEMENTS[key];
  const a = el[0] + el[6] * T;
  const e = el[1] + el[7] * T;
  const I = (el[2] + el[8] * T) * RAD;
  const L = el[3] + el[9] * T;
  const peri = el[4] + el[10] * T;
  const node = (el[5] + el[11] * T) * RAD;

  const w = (peri - (el[5] + el[11] * T)) * RAD;   // argument of perihelion
  const M = norm(L - peri) * RAD;
  const E = kepler(M > Math.PI ? M - 2 * Math.PI : M, e);

  const xv = a * (Math.cos(E) - e);
  const yv = a * Math.sqrt(1 - e * e) * Math.sin(E);

  const v = Math.atan2(yv, xv);
  const r = Math.hypot(xv, yv);

  const u = v + w;
  return [
    r * (Math.cos(node) * Math.cos(u) - Math.sin(node) * Math.sin(u) * Math.cos(I)),
    r * (Math.sin(node) * Math.cos(u) + Math.cos(node) * Math.sin(u) * Math.cos(I)),
    r * (Math.sin(u) * Math.sin(I)),
  ];
}

/** Geocentric ecliptic longitude, in degrees. */
function geocentricLongitude(key, T) {
  const earth = heliocentric("earth", T);
  if (key === "sun") return norm(Math.atan2(-earth[1], -earth[0]) * DEG);
  const p = heliocentric(key, T);
  return norm(Math.atan2(p[1] - earth[1], p[0] - earth[0]) * DEG);
}

/** The Moon, from the principal periodic terms. */
function moonLongitude(T) {
  const Lp = 218.3164477 + 481267.88123421 * T - 0.0015786 * T * T;
  const D  = 297.8501921 + 445267.1114034 * T - 0.0018819 * T * T;
  const M  = 357.5291092 + 35999.0502909 * T;
  const Mp = 134.9633964 + 477198.8675055 * T + 0.0087414 * T * T;
  const F  = 93.2720950 + 483202.0175233 * T - 0.0036539 * T * T;
  const d = D * RAD, m = M * RAD, mp = Mp * RAD, f = F * RAD;

  const dL =
      6.288774 * Math.sin(mp)
    + 1.274027 * Math.sin(2 * d - mp)
    + 0.658314 * Math.sin(2 * d)
    + 0.213618 * Math.sin(2 * mp)
    - 0.185116 * Math.sin(m)
    - 0.114332 * Math.sin(2 * f)
    + 0.058793 * Math.sin(2 * d - 2 * mp)
    + 0.057066 * Math.sin(2 * d - m - mp)
    + 0.053322 * Math.sin(2 * d + mp)
    + 0.045758 * Math.sin(2 * d - m)
    - 0.040923 * Math.sin(m - mp)
    - 0.034720 * Math.sin(d)
    - 0.030383 * Math.sin(m + mp)
    + 0.015327 * Math.sin(2 * d - 2 * f)
    - 0.012528 * Math.sin(mp + 2 * f)
    + 0.010980 * Math.sin(mp - 2 * f);
  return norm(Lp + dL);
}

/** Mean obliquity of the ecliptic, in degrees. */
function obliquity(T) {
  return 23.439291 - 0.0130042 * T - 1.64e-7 * T * T + 5.04e-7 * T * T * T;
}

/** Greenwich mean sidereal time, in degrees. */
function gmst(jd) {
  const T = (jd - 2451545.0) / 36525;
  return norm(280.46061837 + 360.98564736629 * (jd - 2451545.0)
            + 0.000387933 * T * T - (T * T * T) / 38710000);
}

export function signOf(longitude) {
  const l = norm(longitude);
  const index = Math.floor(l / 30);
  return { sign: SIGNS[index], index, degree: l - index * 30 };
}

/**
 * Compute a chart.
 * @param {{year,month,day,hourUT,lat,lon,knownTime}} birth — hourUT is UTC.
 */
export function natalChart({ year, month, day, hourUT = 12, lat = null, lon = null, knownTime = true }) {
  const jd = julianDay(year, month, day, hourUT);
  const T = (jd - 2451545.0) / 36525;
  const eps = obliquity(T) * RAD;

  const bodies = [
    ["sun", "Sun"], ["moon", "Moon"], ["mercury", "Mercury"], ["venus", "Venus"],
    ["mars", "Mars"], ["jupiter", "Jupiter"], ["saturn", "Saturn"],
    ["uranus", "Uranus"], ["neptune", "Neptune"], ["pluto", "Pluto"],
  ];

  const positions = bodies.map(([key, name]) => {
    const lonDeg = key === "moon" ? moonLongitude(T) : geocentricLongitude(key, T);
    // Retrograde is judged by comparing with the position a day later.
    let retro = false;
    if (key !== "sun" && key !== "moon") {
      const T2 = (jd + 1 - 2451545.0) / 36525;
      const next = geocentricLongitude(key, T2);
      const delta = ((next - lonDeg + 540) % 360) - 180;
      retro = delta < 0;
    }
    return { key, name, longitude: lonDeg, retrograde: retro, ...signOf(lonDeg) };
  });

  let ascendant = null, midheaven = null;
  if (knownTime && lat !== null && lon !== null) {
    const ramc = norm(gmst(jd) + lon) * RAD;
    const phi = lat * RAD;
    midheaven = norm(Math.atan2(Math.sin(ramc), Math.cos(ramc) * Math.cos(eps)) * DEG);
    const asc = Math.atan2(
      Math.cos(ramc),
      -(Math.sin(ramc) * Math.cos(eps) + Math.tan(phi) * Math.sin(eps))
    ) * DEG;
    ascendant = norm(asc);
  }

  // Whole-sign houses, counted from the sign holding the Ascendant.
  const firstHouseSign = ascendant === null ? null : signOf(ascendant).index;
  for (const p of positions) {
    p.house = firstHouseSign === null ? null : ((p.index - firstHouseSign + 12) % 12) + 1;
  }

  return {
    julianDay: jd,
    ascendant: ascendant === null ? null : { longitude: ascendant, ...signOf(ascendant) },
    midheaven: midheaven === null ? null : { longitude: midheaven, ...signOf(midheaven) },
    houses: firstHouseSign === null ? null
      : Array.from({ length: 12 }, (_, i) => ({ house: i + 1, sign: SIGNS[(firstHouseSign + i) % 12] })),
    positions,
    houseSystem: "whole-sign",
    timeKnown: Boolean(knownTime && lat !== null && lon !== null),
  };
}
