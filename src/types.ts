export interface RangeQuantity {
  min: number;
  max: number;
}

export interface RecipeIngredient {
  itemId: string;
  quantity: number;
}

export interface Byproduct {
  itemId: string;
  quantity: RangeQuantity;
}

export interface Item {
  id: string;
  name: string;
  workstation: string;
  recipe: RecipeIngredient[];
  outputQuantity: RangeQuantity | number; // Support legacy number or new range
  byproducts?: Byproduct[];
}

export interface LeftoverRange {
  min: number;
  max: number;
}

export interface ByproductRange {
  itemName: string;
  range: LeftoverRange;
}

export interface CraftingStep {
  itemName: string;
  workstation: string;
  quantityNeeded: number;
  craftsPerformed: number;
  usedFromLeftovers: number;
  producedRange: LeftoverRange;
  newLeftoversRange: LeftoverRange;
  byproductRanges: ByproductRange[];
  children: CraftingStep[];
}

export interface ProductionTarget {
  itemId: string;
  quantity: number;
}

export interface CalculationResult {
  baseIngredients: Record<string, number>;
  workstations: Record<string, number>; // workstation name -> craft counts
  leftovers: Record<string, LeftoverRange>; // item name -> quantity range
  trees: { itemName: string; tree: CraftingStep }[];
}