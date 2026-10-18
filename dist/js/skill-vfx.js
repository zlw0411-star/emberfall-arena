import { ACTIVES } from './balance.js';

const FULL_CIRCLE = Math.PI * 2;

// Keep normalized visual progress within its lifetime.
const clamp = value => Math.max(0, Math.min(1, value));

// Use finite defaults for optional event coordinates and timing.
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;

// Draw a crisp polyline on integer pixel coordinates.
function drawLine(context, color, points, width = 1) {
  context.strokeStyle = color;
  context.lineWidth = width;
  context.beginPath();
  points.forEach(([x, y], index) => {
    if (index) context.lineTo(Math.round(x), Math.round(y));
    else context.moveTo(Math.round(x), Math.round(y));
  });
  context.stroke();
}

// Draw one square particle without antialiased edges.
function drawPixel(context, color, x, y, size = 2) {
  context.fillStyle = color;
  context.fillRect(Math.round(x), Math.round(y), size, size);
}

// Approximate an arc with a fixed polygon resolution.
function drawRing(context, radius, startAngle, endAngle, color, width = 1) {
  if (radius <= 0) return;
  const points = [];
  for (let index = 0; index <= 24; index++) {
    const angle = startAngle + (endAngle - startAngle) * index / 24;
    points.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
  }
  drawLine(context, color, points, width);
}

// Paint one jade ward blade with an isolated local transform.
function drawBlade(context, x, y, angle, alpha = 1) {
  context.save();
  context.globalAlpha *= alpha;
  context.translate(Math.round(x), Math.round(y));
  context.rotate(angle);
  context.fillStyle = '#365e62';
  context.fillRect(-3, -9, 6, 17);
  context.fillStyle = '#b1ebd4';
  context.beginPath();
  context.moveTo(0, -12);
  context.lineTo(3, -5);
  context.lineTo(2, 6);
  context.lineTo(-2, 6);
  context.lineTo(-3, -5);
  context.closePath();
  context.fill();
  drawPixel(context, '#f1ffdf', -1, -7, 2);
  drawLine(context, '#75bda8', [[-5, 6], [5, 6]], 2);
  drawLine(context, '#b9cea3', [[0, 7], [0, 11]], 2);
  context.restore();
}

// Reveal successive lightning jumps with deterministic forks and impact sparks.
function drawLightning(context, effect, progress) {
  const points = (effect.points || []).filter(point =>
    Number.isFinite(point.x) && Number.isFinite(point.y));
  const age = progress * finite(effect.maxTtl, ACTIVES.chainLightning.effectTtl);

  for (let segment = 1; segment < points.length; segment++) {
    const segmentAge = age - (segment - 1) * .045;
    if (segmentAge < 0) continue;
    const fade = Math.pow(clamp((.58 - segmentAge) / .4), 1.3);
    const start = points[segment - 1];
    const end = points[segment];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    const normalX = -dy / Math.max(1, length);
    const normalY = dx / Math.max(1, length);
    const path = [];
    const steps = Math.max(3, Math.min(18, Math.ceil(length / 15)));
    const pulse = Math.floor(age * 17);

    for (let index = 0; index <= steps; index++) {
      const fraction = index / steps;
      const zigzag = index === 0 || index === steps ? 0 :
        Math.sin(index * 2.17 + segment * 1.4 + pulse * .7) *
        (3 + Math.sin(fraction * Math.PI) * 4);
      path.push([
        start.x + dx * fraction + normalX * zigzag,
        start.y + dy * fraction + normalY * zigzag,
      ]);
    }

    context.save();
    context.globalAlpha *= fade;
    drawLine(context, '#437ca7', path, 5);
    drawLine(context, effect.color || ACTIVES.chainLightning.color, path, 2);
    drawLine(context, '#f1fcff', path, 1);

    for (let index = 1; index < path.length - 1; index += 4) {
      const [x, y] = path[index];
      const side = index % 2 ? 1 : -1;
      drawLine(context, '#9ad9f2', [
        [x, y],
        [x + normalX * side * 8 + dx / Math.max(1, length) * 3,
          y + normalY * side * 8 + dy / Math.max(1, length) * 3],
        [x + normalX * side * 13, y + normalY * side * 13],
      ], 1);
    }

    for (let index = 0; index < 4; index++) {
      const angle = index * Math.PI / 2 + segment * .7;
      const radius = 3 + clamp(segmentAge / .2) * 8;
      drawPixel(context, '#e5fbff',
        end.x + Math.cos(angle) * radius, end.y + Math.sin(angle) * radius, 2);
    }
    context.restore();
  }
}

// Expand thin ice rings and inward crystals within the event's actual radius.
function drawNova(context, effect, progress) {
  const radius = Math.max(1, finite(effect.radius, ACTIVES.frostNova.radiusBase));
  const spread = 1 - Math.pow(1 - clamp(progress / .48), 3);
  const fade = Math.pow(1 - progress, 1.1);
  context.save();
  context.translate(finite(effect.x), finite(effect.y));
  context.globalAlpha *= fade;

  for (let layer = 0; layer < 3; layer++) {
    const layerRadius = radius * Math.max(0, spread - layer * .065);
    context.save();
    context.globalAlpha *= layer === 0 ? .9 : .25;
    drawRing(context, layerRadius, 0, FULL_CIRCLE,
      layer === 0 ? '#d6fcf5' : effect.color || ACTIVES.frostNova.color,
      layer === 0 ? 2 : 1);
    context.restore();
  }

  for (let index = 0; index < 16; index++) {
    const angle = index * FULL_CIRCLE / 16;
    const ringRadius = radius * spread;
    const crystalLength = (5 + index % 3 * 2) * (1 - progress * .5);
    const x = Math.cos(angle) * Math.max(0, ringRadius - crystalLength);
    const y = Math.sin(angle) * Math.max(0, ringRadius - crystalLength);
    context.save();
    context.translate(Math.round(x), Math.round(y));
    context.rotate(angle);
    drawLine(context, '#95d6e5', [[0, -3], [crystalLength, 0], [0, 3]], 2);
    drawLine(context, '#ebfff3', [[0, 0], [crystalLength, 0]], 1);
    context.restore();

    if (progress > .12) {
      const drift = clamp((progress - .12) / .88);
      const innerRadius = radius * (.4 + (index % 4) * .12);
      drawPixel(context, '#a1ddeb',
        Math.cos(angle + .13) * innerRadius,
        Math.sin(angle + .13) * innerRadius - drift * 6,
        index % 3 === 0 ? 2 : 1);
    }
  }
  context.restore();
}

// Dispatch transient skill events and report whether the kind was handled.
export function drawSkillEffect(context, effect) {
  if (!['chainLightning', 'frostNova', 'bladeWard'].includes(effect.kind)) return false;
  const definition = ACTIVES[effect.kind];
  const progress = clamp(1 - finite(effect.ttl) /
    Math.max(.001, finite(effect.maxTtl, definition.effectTtl)));
  context.save();

  if (progress < 1) {
    if (effect.kind === 'chainLightning') {
      drawLightning(context, effect, progress);
    } else if (effect.kind === 'frostNova') {
      drawNova(context, effect, progress);
    } else {
      context.translate(finite(effect.x), finite(effect.y));
      context.globalAlpha *= Math.pow(1 - progress, 1.4);
      const radius = finite(effect.radius, 30) *
        (.65 + .35 * (1 - Math.pow(1 - progress, 3)));
      for (let index = 0; index < 6; index++) {
        const angle = index * FULL_CIRCLE / 6 + progress * .8;
        drawRing(context, radius, angle + .15, angle + .75, '#6cae9a', 1);
        drawBlade(context, Math.cos(angle) * radius, Math.sin(angle) * radius,
          angle + Math.PI / 2, .8);
      }
    }
  }
  context.restore();
  return true;
}

// Draw either half of the persistent ward so blades can pass behind the hero.
export function drawBladeWard(context, actor, time, { front = true } = {}) {
  if (!(actor.shieldHp > 0 && actor.shieldT > 0)) return;
  const fade = Math.min(1, finite(actor.shieldT) * 2);
  const radius = Math.max(22, finite(actor.radius, 12) + 18);
  const spin = finite(time) * 1.9;
  context.save();
  context.translate(finite(actor.x), finite(actor.y));
  context.globalAlpha *= fade;

  for (let index = 0; index < 5; index++) {
    const angle = index * FULL_CIRCLE / 5 + spin;
    if ((Math.sin(angle) >= 0) !== front) continue;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius * .62;
    context.save();
    context.globalAlpha *= .35;
    drawRing(context, radius * .94, angle - .3, angle + .15, '#83d3b1');
    context.restore();
    drawBlade(context, x, y, angle + Math.PI / 2, .85);
  }

  if (front) {
    context.globalAlpha *= .3;
    drawLine(context, '#b9f0d0', [[-10, 13], [-5, 16], [5, 16], [10, 13]], 1);
  }
  context.restore();
}
