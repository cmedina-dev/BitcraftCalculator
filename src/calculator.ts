import { Item, ProductionTarget, CalculationResult, LeftoverRange, CraftingStep, ByproductRange } from './types';

export function calculateRequirements(
  targets: ProductionTarget[],
  allItems: Item[]
): CalculationResult {
  const itemMap = new Map(allItems.map(i => [i.id, i]));

  const baseIngredients: Record<string, number> = {};
  const workstations: Record<string, number> = {};
  const leftoversById: Record<string, LeftoverRange> = {};

  const MAX_DEPTH = 50;

  function traverse(itemId: string, quantityNeeded: number, depth: number = 0): CraftingStep | null {
    if (depth > MAX_DEPTH) return null;
    const item = itemMap.get(itemId);
    if (!item) return null;

    // We can only reliably subtract the MINIMUM guaranteed leftover.
    // We shouldn't assume we hit the maximum luck, otherwise we might under-craft.
    const availableLeftoverMin = leftoversById[itemId]?.min || 0;
    const usedLeftover = Math.min(quantityNeeded, availableLeftoverMin);
    
    if (usedLeftover > 0) {
      leftoversById[itemId].min -= usedLeftover;
      // We also subtract from max, but max can't go below min
      leftoversById[itemId].max = Math.max(leftoversById[itemId].min, leftoversById[itemId].max - usedLeftover);
    }
    const remainingNeeded = quantityNeeded - usedLeftover;

    const step: CraftingStep = {
      itemName: item.name,
      workstation: item.workstation || '',
      quantityNeeded,
      usedFromLeftovers: usedLeftover,
      craftsPerformed: 0,
      producedRange: { min: 0, max: 0 },
      newLeftoversRange: { min: 0, max: 0 },
      byproductRanges: [],
      children: []
    };

    if (remainingNeeded <= 0) return step;

    if (!item.recipe || item.recipe.length === 0) {
      // Base ingredient
      baseIngredients[item.name] = (baseIngredients[item.name] || 0) + remainingNeeded;
      step.producedRange = { min: remainingNeeded, max: remainingNeeded };
      return step;
    } else {
      // Complex item
      // Handle both legacy number format and new range format
      const yieldMinPerCraft = typeof item.outputQuantity === 'number' ? item.outputQuantity : (item.outputQuantity?.min ?? 1);
      const yieldMaxPerCraft = typeof item.outputQuantity === 'number' ? item.outputQuantity : (item.outputQuantity?.max ?? 1);
      
      const effectiveYield = yieldMinPerCraft > 0 ? yieldMinPerCraft : (yieldMaxPerCraft > 0 ? yieldMaxPerCraft : 1);
      const crafts = Math.ceil(remainingNeeded / effectiveYield);
      
      const totalProducedMin = crafts * yieldMinPerCraft;
      const totalProducedMax = crafts * yieldMaxPerCraft;
      
      const unusedMin = totalProducedMin - remainingNeeded;
      const unusedMax = totalProducedMax - remainingNeeded;

      step.craftsPerformed = crafts;
      step.producedRange = { min: totalProducedMin, max: totalProducedMax };
      step.newLeftoversRange = { min: Math.max(0, unusedMin), max: unusedMax };

      if (unusedMax > 0) {
        if (!leftoversById[itemId]) {
          leftoversById[itemId] = { min: 0, max: 0 };
        }
        leftoversById[itemId].min += Math.max(0, unusedMin);
        leftoversById[itemId].max += unusedMax;
      }

      if (item.workstation && item.workstation.toLowerCase() !== 'none') {
        workstations[item.workstation] = (workstations[item.workstation] || 0) + crafts;
      }

      // Accumulate byproducts into the shared leftover pool so downstream
      // steps can consume them, and record them on the step for display.
      const byproductRanges: ByproductRange[] = [];
      for (const bp of item.byproducts ?? []) {
        const bpMin = crafts * bp.quantity.min;
        const bpMax = crafts * bp.quantity.max;
        if (bpMax > 0) {
          if (!leftoversById[bp.itemId]) leftoversById[bp.itemId] = { min: 0, max: 0 };
          leftoversById[bp.itemId].min += bpMin;
          leftoversById[bp.itemId].max += bpMax;
          const bpName = itemMap.get(bp.itemId)?.name ?? bp.itemId;
          byproductRanges.push({ itemName: bpName, range: { min: bpMin, max: bpMax } });
        }
      }
      step.byproductRanges = byproductRanges;

      for (const req of item.recipe) {
        const childStep = traverse(req.itemId, req.quantity * crafts, depth + 1);
        if (childStep) {
          step.children.push(childStep);
        }
      }
      return step;
    }
  }

  const trees: { itemName: string; tree: CraftingStep }[] = [];
  for (const target of targets) {
    if (!target.itemId || target.quantity < 1) continue;
    const tree = traverse(target.itemId, Math.min(999999, target.quantity));
    if (tree) {
      const item = itemMap.get(target.itemId);
      trees.push({ itemName: item?.name ?? target.itemId, tree });
    }
  }

  // Convert leftoversById to leftovers by name
  const leftovers: Record<string, LeftoverRange> = {};
  for (const [id, range] of Object.entries(leftoversById)) {
    if (range.max > 0) {
      const it = itemMap.get(id);
      if (it) {
        if (!leftovers[it.name]) {
          leftovers[it.name] = { min: 0, max: 0 };
        }
        leftovers[it.name].min += range.min;
        leftovers[it.name].max += range.max;
      }
    }
  }

  return { baseIngredients, workstations, leftovers, trees };
}