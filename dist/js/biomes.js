export const DEFAULT_BIOME = 'courtyard';

export const BIOMES = {
  courtyard: {
    id: 'courtyard', name: '失落庭院', en: 'Lost Courtyard',
    description: '断壁与石阵散落庭院，熟悉的战场等待最后的幸存者。',
    accent: '#a4b882', icon: '▥',
    hazards: { spike: '地刺机关', mud: '泥地' }
  },
  desert: {
    id: 'desert', name: '灰烬荒漠', en: 'Ashen Desert',
    description: '开阔灰沙之间矗立巨大岩柱，穿过流沙与爆发陷阱争夺掩体。',
    accent: '#e1a76c', icon: '◆',
    hazards: { spike: '爆发陷阱', mud: '流沙' }
  },
  frost: {
    id: 'frost', name: '冰封遗迹', en: 'Frozen Ruins',
    description: '破碎冰墙交错成通道，利用转角绕行，避开冰刺与积雪。',
    accent: '#99d9ed', icon: '❄',
    hazards: { spike: '冰刺', mud: '雪堆' }
  },
  swamp: {
    id: 'swamp', name: '幽暗沼泽', en: 'Duskmire',
    description: '纠缠树根分割岛状落脚点，沿干地穿越大片泥潭与荆棘。',
    accent: '#afbd77', icon: '♣',
    hazards: { spike: '荆棘', mud: '泥潭' }
  }
};

export function normalizeBiome(id) {
  return Object.prototype.hasOwnProperty.call(BIOMES, id) ? id : DEFAULT_BIOME;
}

export function biomeOf(mapOrId) {
  return BIOMES[normalizeBiome(typeof mapOrId === 'string' ? mapOrId : mapOrId?.biome)];
}
