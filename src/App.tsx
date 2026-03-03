import React, { useState, useMemo, useEffect, useRef } from "react";
import { useItems } from "./store";
import { calculateRequirements } from "./calculator";
import { Item, ProductionTarget, RecipeIngredient, CalculationResult, CraftingStep } from "./types";
import {
  Plus,
  Trash2,
  Edit2,
  Calculator,
  PackageSearch,
  X,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { SearchableSelect } from "./SearchableSelect";
import { v4 as uuidv4 } from "uuid";

const fmt = new Intl.NumberFormat();

function App() {
  const { items, addItem, updateItem, deleteItem } = useItems();
  const [activeTab, setActiveTab] = useState<"calculator" | "manager">(
    "calculator",
  );
  const [editingItem, setEditingItem] = useState<Item | null>(null);

  return (
    <div className="container">
      <header
        className="mb-xl flex flex-wrap items-center justify-between"
        style={{ gap: "var(--spacing-lg)", borderBottom: '1px solid var(--border-color)', paddingBottom: 'var(--spacing-lg)' }}
      >
        <div style={{ minWidth: 0 }}>
          <h1 className="mb-sm">
            Crafting Ledger
          </h1>
          <p className="text-secondary truncate" style={{ fontSize: '1.25rem' }}>
            Bitcraft Resource Calculator
          </p>
        </div>
        <nav className="flex flex-wrap gap-md" aria-label="Main Navigation">
          <button
            className={`btn-outline ${activeTab === "calculator" ? "btn-primary" : ""}`}
            onClick={() => setActiveTab("calculator")}
            aria-pressed={activeTab === "calculator"}
            style={{ fontSize: '1.125rem', padding: 'var(--spacing-md) var(--spacing-lg)' }}
          >
            <Calculator size={24} aria-hidden="true" />
            Calculator
          </button>
          <button
            className={`btn-outline ${activeTab === "manager" ? "btn-primary" : ""}`}
            onClick={() => setActiveTab("manager")}
            aria-pressed={activeTab === "manager"}
            style={{ fontSize: '1.125rem', padding: 'var(--spacing-md) var(--spacing-lg)' }}
          >
            <PackageSearch size={24} aria-hidden="true" />
            Registry
          </button>
        </nav>
      </header>

      <main>
        {activeTab === "calculator" && <CalculatorTab items={items} onSwitchToRegistry={() => setActiveTab("manager")} />}
        {activeTab === "manager" && (
          <ManagerTab
            items={items}
            onAdd={() =>
              setEditingItem({
                id: uuidv4(),
                name: "",
                workstation: "None",
                recipe: [],
                outputQuantity: 1,
                byproducts: [],
              })
            }
            onEdit={setEditingItem}
            onDelete={deleteItem}
          />
        )}
      </main>

      {editingItem && (
        <ItemEditorDrawer
          item={editingItem}
          allItems={items}
          onSave={(item) => {
            if (items.find((i) => i.id === item.id)) {
              updateItem(item);
            } else {
              addItem(item);
            }
            setEditingItem(null);
          }}
          onClose={() => setEditingItem(null)}
        />
      )}
    </div>
  );
}

// Uncontrolled number input. The browser owns the displayed value so typing
// always works. A ref-based effect syncs external value changes (e.g.
// auto-correction of min/max) into the DOM without disturbing focus.
function NumericInput({
  value,
  min = 0,
  max,
  onChange,
  style,
  "aria-label": ariaLabel,
}: {
  value: number;
  min?: number;
  max?: number;
  onChange: (val: number) => void;
  style?: React.CSSProperties;
  "aria-label"?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const lastCommitted = useRef(value);

  // Sync from parent only when the value changes externally
  // (e.g. auto-correction changed max because min was raised above it)
  useEffect(() => {
    if (ref.current && value !== lastCommitted.current) {
      ref.current.value = String(value);
      lastCommitted.current = value;
    }
  }, [value]);

  const clamp = (n: number) =>
    Math.max(min, max !== undefined ? Math.min(max, n) : n);

  return (
    <input
      ref={ref}
      type="number"
      min={min}
      max={max}
      style={style}
      aria-label={ariaLabel}
      defaultValue={value}
      onBlur={(e) => {
        const n = parseInt(e.target.value);
        const v = isNaN(n) ? min : clamp(n);
        e.target.value = String(v);
        lastCommitted.current = v;
        onChange(v);
      }}
    />
  );
}

function formatRange(range?: { min: number; max: number } | number): string {
  if (range === undefined) return "1";
  if (typeof range === 'number') return fmt.format(range);
  if (range.min === range.max) return fmt.format(range.min);
  return `${fmt.format(range.min)}–${fmt.format(range.max)}`;
}

/** Count unique crafted (non-base) items in the full dependency tree. */
function countCraftedDeps(item: Item, itemMap: Map<string, Item>, seen?: Set<string>): number {
  if (!seen) seen = new Set();
  if (seen.has(item.id)) return 0;
  seen.add(item.id);
  let count = 0;
  for (const req of item.recipe) {
    const child = itemMap.get(req.itemId);
    if (child && child.recipe.length > 0) {
      count++; // this ingredient is itself crafted
      count += countCraftedDeps(child, itemMap, seen);
    }
  }
  return count;
}

function getTierClass(item: Item, itemMap?: Map<string, Item>): string {
  if (item.recipe.length === 0) return "base";
  if (!itemMap) return "refined";

  const crafted = countCraftedDeps(item, itemMap);
  // 0 crafted deps: all ingredients are base resources
  // 1-5: a handful of intermediates
  // 6-14: significant production pipeline
  // 15+: major multi-branch crafting effort
  if (crafted <= 1) return "refined";
  if (crafted <= 8) return "complex";
  return "final";
}

function hasWorkstation(ws: string | undefined): boolean {
  return !!ws && ws.toLowerCase() !== 'none';
}

interface FlatCraftingStepIngredient {
  itemName: string;
  perCraft: number;
}

interface FlatCraftingStep {
  itemName: string;
  workstation: string;
  tier: string;
  craftsPerformed: number;
  quantityNeeded: number;
  producedRange: { min: number; max: number };
  newLeftoversRange: { min: number; max: number };
  byproductRanges: { itemName: string; range: { min: number; max: number } }[];
  ingredients: FlatCraftingStepIngredient[];
}

function flattenCraftingTrees(
  trees: CalculationResult['trees'],
  itemsByName: Map<string, Item>,
  itemsById: Map<string, Item>,
): FlatCraftingStep[] {
  // Phase 1: Walk trees, merge duplicate steps, and collect dependency edges.
  const merged = new Map<string, FlatCraftingStep>();
  // deps: key → set of keys that must come before it
  const deps = new Map<string, Set<string>>();

  function isBaseResource(node: CraftingStep): boolean {
    const itemDef = itemsByName.get(node.itemName);
    return !itemDef || itemDef.recipe.length === 0;
  }

  function stepKey(node: CraftingStep): string {
    return isBaseResource(node)
      ? `gather|${node.itemName}`
      : `${node.itemName}|${node.workstation}`;
  }

  function walk(node: CraftingStep) {
    for (const child of node.children) {
      walk(child);
    }

    // Skip crafted items that needed 0 additional crafts (fully covered by leftovers)
    if (!isBaseResource(node) && node.craftsPerformed === 0) return;

    const key = stepKey(node);
    const existing = merged.get(key);

    const ingredients: FlatCraftingStepIngredient[] = node.children.map((child) => ({
      itemName: child.itemName,
      perCraft: node.craftsPerformed > 0 ? child.quantityNeeded / node.craftsPerformed : child.quantityNeeded,
    }));

    if (existing) {
      existing.craftsPerformed += node.craftsPerformed;
      existing.quantityNeeded += node.quantityNeeded;
      existing.producedRange.min += node.producedRange.min;
      existing.producedRange.max += node.producedRange.max;
      existing.newLeftoversRange.min += node.newLeftoversRange.min;
      existing.newLeftoversRange.max += node.newLeftoversRange.max;
      for (const bp of node.byproductRanges) {
        const existingBp = existing.byproductRanges.find((b) => b.itemName === bp.itemName);
        if (existingBp) {
          existingBp.range.min += bp.range.min;
          existingBp.range.max += bp.range.max;
        } else {
          existing.byproductRanges.push({ itemName: bp.itemName, range: { ...bp.range } });
        }
      }
    } else {
      const itemDef = itemsByName.get(node.itemName);
      const tier = itemDef ? getTierClass(itemDef, itemsById) : 'base';

      merged.set(key, {
        itemName: node.itemName,
        workstation: node.workstation,
        tier,
        craftsPerformed: node.craftsPerformed,
        quantityNeeded: node.quantityNeeded,
        producedRange: { ...node.producedRange },
        newLeftoversRange: { ...node.newLeftoversRange },
        byproductRanges: node.byproductRanges.map((bp) => ({
          itemName: bp.itemName,
          range: { ...bp.range },
        })),
        ingredients,
      });
    }

    // Record dependency edges: this step depends on each child step
    if (!deps.has(key)) deps.set(key, new Set());
    for (const child of node.children) {
      deps.get(key)!.add(stepKey(child));
    }
  }

  for (const entry of trees) {
    walk(entry.tree);
  }

  // Phase 2: Topological sort with workstation grouping.
  // Gather steps (no dependencies themselves) come first, sorted by name.
  // Crafted steps are emitted in dependency order; when multiple steps are
  // ready at the same time, they are grouped by workstation to minimise
  // in-game movement between stations.

  const allKeys = Array.from(merged.keys());
  const remaining = new Set(allKeys);
  const result: FlatCraftingStep[] = [];

  // Emit all gather steps first, sorted alphabetically
  const gatherKeys = allKeys
    .filter((k) => k.startsWith('gather|'))
    .sort((a, b) => a.localeCompare(b));
  for (const k of gatherKeys) {
    result.push(merged.get(k)!);
    remaining.delete(k);
  }

  // Iteratively emit crafted steps whose dependencies are all satisfied
  while (remaining.size > 0) {
    const ready: string[] = [];
    for (const k of remaining) {
      const d = deps.get(k);
      if (!d || Array.from(d).every((dep) => !remaining.has(dep))) {
        ready.push(k);
      }
    }

    if (ready.length === 0) {
      // Safety: break cycles by emitting everything left
      for (const k of remaining) result.push(merged.get(k)!);
      break;
    }

    // Sort ready steps by workstation so same-station crafts are adjacent
    ready.sort((a, b) => {
      const sa = merged.get(a)!;
      const sb = merged.get(b)!;
      const wsCmp = sa.workstation.localeCompare(sb.workstation);
      if (wsCmp !== 0) return wsCmp;
      return sa.itemName.localeCompare(sb.itemName);
    });

    for (const k of ready) {
      result.push(merged.get(k)!);
      remaining.delete(k);
    }
  }

  return result;
}

function CalculatorTab({ items, onSwitchToRegistry }: { items: Item[]; onSwitchToRegistry: () => void }) {
  const [targets, setTargets] = useState<ProductionTarget[]>([
    { itemId: items[0]?.id || "", quantity: 1 },
  ]);

  // Auto-fix targets when items list changes and a selected item becomes invalid
  useEffect(() => {
    if (items.length === 0) return;
    setTargets((prev) =>
      prev.map((t) =>
        items.find((i) => i.id === t.itemId) ? t : { ...t, itemId: items[0].id },
      ),
    );
  }, [items]);

  const updateTargetItem = (index: number, itemId: string) => {
    setTargets((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], itemId };
      return updated;
    });
  };

  const updateTargetQuantity = (index: number, raw: string) => {
    setTargets((prev) => {
      const updated = [...prev];
      const parsed = parseInt(raw);
      // Allow empty string while typing — clamp on blur instead
      const quantity = raw === "" ? 0 : (isNaN(parsed) ? 1 : Math.min(999999, Math.max(1, parsed)));
      updated[index] = { ...updated[index], quantity };
      return updated;
    });
  };

  const clampTargetQuantity = (index: number) => {
    setTargets((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], quantity: Math.max(1, updated[index].quantity) };
      return updated;
    });
  };

  const MAX_TARGETS = 20;

  const addTarget = () => {
    setTargets((prev) => {
      if (prev.length >= MAX_TARGETS) return prev;
      return [...prev, { itemId: items[0]?.id || "", quantity: 1 }];
    });
  };

  const removeTarget = (index: number) => {
    setTargets((prev) => prev.filter((_, i) => i !== index));
  };

  const hasValidTargets = targets.some((t) => t.itemId);

  const itemsByName = useMemo(() => new Map(items.map(i => [i.name, i])), [items]);
  const itemsById = useMemo(() => new Map(items.map(i => [i.id, i])), [items]);

  const [craftingView, setCraftingView] = useState<'tree' | 'steps'>('tree');

  const result: CalculationResult | null = useMemo(() => {
    const validTargets = targets
      .filter((t) => t.itemId && t.quantity > 0)
      .map((t) => ({ ...t, quantity: Math.max(1, t.quantity) }));
    if (validTargets.length === 0) return null;
    try {
      return calculateRequirements(validTargets, items);
    } catch (e) {
      console.error(
        "Calculation failed, possibly due to circular dependency.",
        e,
      );
      return null;
    }
  }, [targets, items]);

  const flatSteps = useMemo(() => {
    if (!result) return [];
    return flattenCraftingTrees(result.trees, itemsByName, itemsById);
  }, [result, itemsByName, itemsById]);

  if (items.length === 0) {
    return (
      <div className="empty-state" style={{ background: 'color-mix(in oklch, var(--surface-color) 80%, var(--accent-color))' }}>
        <PackageSearch size={48} aria-hidden="true" style={{ color: 'var(--accent-color)', opacity: 0.8 }} />
        <h2 className="font-heading" style={{ fontSize: '1.5rem' }}>Welcome to your Ledger</h2>
        <p className="text-secondary" style={{ maxWidth: '400px', margin: '0 auto' }}>Add your materials and recipes in the Registry, then come back here to calculate what you need.</p>
        <button className="btn-primary mt-sm" onClick={onSwitchToRegistry}>
          Go to Registry
        </button>
      </div>
    );
  }

  return (
    <section aria-labelledby="calc-heading">
      <h2 id="calc-heading" className="sr-only">Calculator</h2>
      <form className="mb-lg" onSubmit={(e) => e.preventDefault()}>
        <div className="flex items-center justify-between mb-md">
          <h3>Production Run</h3>
          <button
            type="button"
            className="btn-outline text-sm"
            onClick={addTarget}
            disabled={targets.length >= MAX_TARGETS}
          >
            <Plus size={16} aria-hidden="true" />
            Add Item
          </button>
        </div>
        <div className="flex-col" style={{ gap: "0.5rem" }}>
          {targets.map((target, idx) => (
            <div
              key={idx}
              className="flex items-center flex-wrap"
              style={{ gap: "var(--spacing-sm)" }}
            >
              <SearchableSelect
                aria-label={`Target item ${idx + 1}`}
                style={{ flex: "1 1 200px", minWidth: 0 }}
                value={target.itemId}
                onChange={(val) => updateTargetItem(idx, val)}
                placeholder="Select an item..."
                options={items.map((i) => ({ value: i.id, label: i.name }))}
              />
              <input
                aria-label={`Quantity for target ${idx + 1}`}
                type="number"
                min="1"
                max="999999"
                placeholder="Qty"
                style={{ width: "100px", flex: "0 0 100px" }}
                value={target.quantity || ""}
                onChange={(e) =>
                  updateTargetQuantity(idx, e.target.value)
                }
                onBlur={() => clampTargetQuantity(idx)}
              />
              {targets.length > 1 && (
                <button
                  type="button"
                  className="btn-icon"
                  aria-label={`Remove target ${idx + 1}`}
                  onClick={() => removeTarget(idx)}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              )}
            </div>
          ))}
        </div>
      </form>

      <hr className="section-divider" />

      <div className="mb-lg">
        <h3 className="mb-md">Requirements Ledger</h3>
        {result ? (
          <>
          <div
            className="grid"
            style={{
              gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
            }}
          >
            <div className="ledger-box ledger-box--ingredients">
              <h4 className="mb-sm text-sm text-secondary uppercase">
                Base Ingredients
              </h4>
              <ul className="ledger-list">
                {Object.entries(result.baseIngredients).map(([name, qty]) => (
                  <li key={name} className="ledger-item">
                    <span className="ledger-key wrap" title={name}>{name}</span>
                    <span className="ledger-value">{fmt.format(qty)}x</span>
                  </li>
                ))}
                {Object.keys(result.baseIngredients).length === 0 && (
                  <li className="ledger-item text-secondary">No base ingredients needed.</li>
                )}
              </ul>
            </div>

            {Object.keys(result.leftovers).length > 0 && (
              <div className="ledger-box ledger-box--leftovers">
                <h4 className="mb-sm text-sm text-secondary uppercase">Leftovers</h4>
                <ul className="ledger-list">
                  {Object.entries(result.leftovers).map(([name, qty]) => (
                    <li key={name} className="ledger-item">
                      <span className="ledger-key wrap" title={name}>{name}</span>
                      <span className="ledger-value text-refined">+{formatRange(qty)}x</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="ledger-box ledger-box--workstations">
              <h4 className="mb-sm text-sm text-secondary uppercase">
                Workstation Usage
              </h4>
              <ul className="ledger-list">
                {Object.entries(result.workstations).map(([station, crafts]) => (
                  <li key={station} className="ledger-item">
                    <span className="ledger-key wrap" title={station}>{station}</span>
                    <span className="ledger-value">{fmt.format(crafts)} crafts</span>
                  </li>
                ))}
                {Object.keys(result.workstations).length === 0 && (
                  <li className="ledger-item text-secondary">No workstations required.</li>
                )}
              </ul>
            </div>
          </div>

          {result.trees.length > 0 && (
            <div className="mt-xl pt-md">
              <div className="flex items-center justify-between mb-md" style={{ gap: 'var(--spacing-sm)' }}>
                <h3>Crafting Process</h3>
                <div className="view-toggle" role="radiogroup" aria-label="Crafting view mode">
                  <button
                    type="button"
                    className={`view-toggle__btn${craftingView === 'tree' ? ' view-toggle__btn--active' : ''}`}
                    role="radio"
                    aria-checked={craftingView === 'tree'}
                    onClick={() => setCraftingView('tree')}
                  >
                    Tree
                  </button>
                  <button
                    type="button"
                    className={`view-toggle__btn${craftingView === 'steps' ? ' view-toggle__btn--active' : ''}`}
                    role="radio"
                    aria-checked={craftingView === 'steps'}
                    onClick={() => setCraftingView('steps')}
                  >
                    Steps
                  </button>
                </div>
              </div>

              {craftingView === 'tree' ? (
                <div style={{ overflowX: 'auto', paddingBottom: 'var(--spacing-md)' }}>
                  {result.trees.map((entry, idx) => (
                    <div key={idx} style={{ minWidth: 0 }}>
                      {result.trees.length > 1 && (
                        <h4 className="mb-sm mt-md text-secondary truncate" style={{ fontSize: '1rem' }} title={entry.itemName}>
                          {entry.itemName}
                        </h4>
                      )}
                      <div className="tree-node">
                        <CraftingTreeNode node={entry.tree} isRoot={true} depth={0} itemsByName={itemsByName} itemsById={itemsById} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <CraftingStepsList steps={flatSteps} />
              )}
            </div>
          )}
        </>
        ) : (
          <div className="empty-state" style={{ padding: "var(--spacing-lg)" }}>
             <p className="text-secondary">
               {hasValidTargets ? 'This recipe has a circular dependency — an item ends up requiring itself. Open the Registry and check the ingredient chain.' : 'Choose an item and quantity in the Production Run to see what you need.'}
             </p>
          </div>
        )}
      </div>
    </section>
  );
}

const CraftingTreeNode = React.memo(function CraftingTreeNode({ node, isRoot, depth, itemsByName, itemsById }: { node: CraftingStep, isRoot?: boolean, depth: number, itemsByName: Map<string, Item>, itemsById: Map<string, Item> }) {
  const hasChildren = node.children.length > 0;
  const [collapsed, setCollapsed] = useState(!isRoot && depth >= 3);

  const itemDef = itemsByName.get(node.itemName);
  const tier = itemDef ? getTierClass(itemDef, itemsById) : 'base';

  const showWorkstation = hasWorkstation(node.workstation);

  // Build meta segments
  const metaParts: React.ReactNode[] = [];
  metaParts.push(<span key="qty">{fmt.format(node.quantityNeeded)} needed</span>);
  if (node.craftsPerformed > 0) {
    metaParts.push(<span key="crafts">Crafted {fmt.format(node.craftsPerformed)}&times;</span>);
  }
  if (node.usedFromLeftovers > 0) {
    metaParts.push(<span key="used">Used {fmt.format(node.usedFromLeftovers)} from leftovers</span>);
  }
  if (node.newLeftoversRange.max > 0) {
    metaParts.push(<span key="left" className="text-refined">+{formatRange(node.newLeftoversRange)} leftover</span>);
  }
  node.byproductRanges.forEach(bp => {
    metaParts.push(<span key={`bp-${bp.itemName}`}>+{formatRange(bp.range)} {bp.itemName}</span>);
  });

  return (
    <div className={`tree-step tree-step--${tier}${isRoot ? ' tree-step--root' : ''}`}>
      <div className="tree-step__header">
        <span className="tree-step__name font-heading">
          {node.itemName}
        </span>
        {showWorkstation && (
          <span className={`tag tag-${tier}`}>{node.workstation}</span>
        )}
        {hasChildren && (
          <button
            type="button"
            className="tree-toggle"
            onClick={() => setCollapsed(c => !c)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? `Expand ${node.itemName}` : `Collapse ${node.itemName}`}
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
            {collapsed && (
              <span className="text-secondary text-sm">({node.children.length} ingredients)</span>
            )}
          </button>
        )}
      </div>
      <div className="tree-step__meta text-secondary text-sm">
        {metaParts.map((part, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span aria-hidden="true">&middot;</span>}
            {part}
          </React.Fragment>
        ))}
      </div>

      {hasChildren && !collapsed && (
        <div className="tree-children">
          {node.children.map((child, idx) => (
            <div key={`${child.itemName}-${idx}`} className="tree-node">
              <CraftingTreeNode node={child} depth={depth + 1} itemsByName={itemsByName} itemsById={itemsById} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

function CraftingStepsList({ steps }: { steps: FlatCraftingStep[] }) {
  if (steps.length === 0) {
    return (
      <div className="empty-state" style={{ padding: 'var(--spacing-lg)' }}>
        <p className="text-secondary">Nothing to craft. Every selected item is a base resource you can gather directly.</p>
      </div>
    );
  }

  return (
    <ol className="steps-list">
      {steps.map((step, idx) => {
        const isGather = step.craftsPerformed === 0;
        const showWorkstation = !isGather && hasWorkstation(step.workstation);
        return (
          <li key={`${step.itemName}-${step.workstation}-${idx}`} className={`steps-item steps-item--${step.tier}`}>
            <span className="steps-item__number" aria-hidden="true">{idx + 1}</span>
            <div className="steps-item__content">
              <div className="steps-item__header">
                <span className={`font-heading text-${step.tier}`} style={{ fontSize: '1.1rem', fontWeight: 500 }}>
                  {step.itemName}
                </span>
                {isGather && <span className="tag tag-base">Gather</span>}
                {showWorkstation && (
                  <span className={`tag tag-${step.tier}`}>{step.workstation}</span>
                )}
              </div>
              {isGather ? (
                <p className="text-secondary text-sm">
                  Gather {fmt.format(step.quantityNeeded)}&times; {step.itemName}
                </p>
              ) : (
                <>
                  <p className="text-secondary text-sm">
                    Craft {fmt.format(step.craftsPerformed)}&times;{showWorkstation && <> at {step.workstation}</>} &rarr; {formatRange(step.producedRange)} produced
                  </p>
                  {step.ingredients.length > 0 && (
                    <div className="steps-ingredient-list text-sm">
                      {step.ingredients.map((ing) => (
                        <span key={ing.itemName} className="steps-ingredient">
                          {fmt.format(ing.perCraft)}&times; {ing.itemName}
                          {step.craftsPerformed > 1 && (
                            <span className="text-secondary"> ({fmt.format(ing.perCraft * step.craftsPerformed)} across all crafts)</span>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                  {(step.newLeftoversRange.max > 0 || step.byproductRanges.length > 0) && (
                    <div className="steps-ingredient-list text-sm">
                      {step.newLeftoversRange.max > 0 && (
                        <span className="text-refined">+{formatRange(step.newLeftoversRange)} left over</span>
                      )}
                      {step.byproductRanges.map((bp) => (
                        <span key={bp.itemName} className="text-secondary">
                          +{formatRange(bp.range)} {bp.itemName} (byproduct)
                        </span>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function ManagerTab({
  items,
  onAdd,
  onEdit,
  onDelete,
}: {
  items: Item[];
  onAdd: () => void;
  onEdit: (item: Item) => void;
  onDelete: (id: string) => void;
}) {
  const itemsById = useMemo(() => new Map(items.map(i => [i.id, i])), [items]);

  return (
    <section aria-labelledby="manager-heading">
      <div className="flex flex-wrap items-center justify-between mb-lg gap-md">
        <h2 id="manager-heading">Item Registry</h2>
        <button className="btn-primary" onClick={onAdd}>
          <Plus size={18} aria-hidden="true" />
          New Item
        </button>
      </div>

      {items.length === 0 ? (
        <div className="empty-state">
          <PackageSearch
            size={48}
            className="text-secondary"
            aria-hidden="true"
          />
          <h3 className="font-heading" style={{ fontSize: "1.5rem" }}>
            Your registry is empty
          </h3>
          <p className="text-secondary">
            Add items, resources, and recipes to start calculating.
          </p>
          <button className="btn-primary mt-md" onClick={onAdd}>
            Create First Item
          </button>
        </div>
      ) : (
        <div className="data-table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Workstation</th>
                <th>Output</th>
                <th>Complexity</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => {
                const tier = getTierClass(item, itemsById);
                return (
                  <tr
                    key={item.id}
                    className="animate-list-enter"
                    style={{ animationDelay: `${index * 50}ms` }}
                  >
                    <td
                      className={`font-heading cell-name wrap text-${tier}`}
                      data-label="Name"
                      style={{ fontSize: "1.125rem" }}
                    >
                      {item.name}
                    </td>
                    <td className="cell-workstation" data-label="Workstation">
                      <span className={`tag tag-${tier} wrap`}>
                        {item.workstation || "None"}
                      </span>
                    </td>
                    <td
                      className="text-secondary"
                      style={{ fontVariantNumeric: "tabular-nums" }}
                      data-label="Output"
                    >
                      {formatRange(item.outputQuantity || 1)}x
                    </td>
                    <td
                      className="text-secondary text-sm"
                      data-label="Complexity"
                    >
                      {item.recipe.length > 0
                        ? `${item.recipe.length} ingredients`
                        : "Base Resource"}
                    </td>
                    <td className="text-right" data-label="Actions">
                      <div
                        className="flex items-center gap-sm"
                        style={{ justifyContent: "flex-end" }}
                      >
                        <button
                          className="btn-icon"
                          aria-label={`Edit ${item.name}`}
                          onClick={() => onEdit(item)}
                        >
                          <Edit2 size={16} aria-hidden="true" />
                        </button>
                        <button
                          className="btn-icon"
                          aria-label={`Delete ${item.name}`}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Delete "${item.name}"? Any recipes using it will lose this ingredient.`,
                              )
                            ) {
                              onDelete(item.id);
                            }
                          }}
                        >
                          <Trash2 size={16} aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ItemEditorDrawer({
  item,
  allItems,
  onSave,
  onClose,
}: {
  item: Item;
  allItems: Item[];
  onSave: (item: Item) => void;
  onClose: () => void;
}) {
  const [formData, setFormData] = useState<Item>(item);
  const [errors, setErrors] = useState<{ name?: string }>({});
  const [isNewWorkstation, setIsNewWorkstation] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  const uniqueWorkstations = useMemo(() => {
    const workstations = new Set<string>();
    allItems.forEach((i) => {
      if (hasWorkstation(i.workstation)) {
        workstations.add(i.workstation);
      }
    });
    return Array.from(workstations).sort();
  }, [allItems]);

  // A11y focus management and Focus Trap
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    nameInputRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      
      // Focus Trap implementation
      if (e.key === 'Tab') {
        const focusableElements = drawerRef.current?.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        ) as NodeListOf<HTMLElement>;
        
        if (!focusableElements || focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            lastElement.focus();
            e.preventDefault();
          }
        } else {
          if (document.activeElement === lastElement) {
            firstElement.focus();
            e.preventDefault();
          }
        }
      }
    };
    
    window.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden"; // Prevent background scrolling

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "auto";
    };
  }, []);

  const addIngredient = () => {
    setFormData((prev) => ({
      ...prev,
      recipe: [
        ...prev.recipe,
        {
          itemId: allItems.find((i) => i.id !== prev.id)?.id ?? "",
          quantity: 1,
        },
      ],
    }));
  };

  const updateIngredient = (
    index: number,
    field: keyof RecipeIngredient,
    value: string | number,
  ) => {
    const newRecipe = [...formData.recipe];
    newRecipe[index] = { ...newRecipe[index], [field]: value as number };
    setFormData((prev) => ({ ...prev, recipe: newRecipe }));
  };

  const removeIngredient = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      recipe: prev.recipe.filter((_, i) => i !== index),
    }));
  };

  const addByproduct = () => {
    setFormData((prev) => ({
      ...prev,
      byproducts: [
        ...(prev.byproducts ?? []),
        { itemId: allItems.find((i) => i.id !== prev.id)?.id ?? "", quantity: { min: 0, max: 1 } },
      ],
    }));
  };

  const updateByproduct = (index: number, field: "itemId" | "min" | "max", value: string | number) => {
    setFormData((prev) => {
      const updated = [...(prev.byproducts ?? [])];
      if (field === "itemId") {
        updated[index] = { ...updated[index], itemId: value as string };
      } else {
        const qty = { ...updated[index].quantity, [field]: value as number };
        if (field === "min" && qty.min > qty.max) qty.max = qty.min;
        if (field === "max" && qty.max < qty.min) qty.min = qty.max;
        updated[index] = { ...updated[index], quantity: qty };
      }
      return { ...prev, byproducts: updated };
    });
  };

  const removeByproduct = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      byproducts: (prev.byproducts ?? []).filter((_, i) => i !== index),
    }));
  };

  const updateOutputRange = (field: "min" | "max", value: number) => {
    const currentQty = typeof formData.outputQuantity === 'number' 
        ? { min: formData.outputQuantity, max: formData.outputQuantity } 
        : (formData.outputQuantity ?? { min: 1, max: 1 });
        
    const newRange = {
      ...currentQty,
      [field]: value,
    };
    if (field === "min" && newRange.min > newRange.max)
      newRange.max = newRange.min;
    if (field === "max" && newRange.max < newRange.min)
      newRange.min = newRange.max;
    setFormData((prev) => ({ ...prev, outputQuantity: newRange }));
  };

  const handleSave = () => {
    if (!formData.name.trim()) {
      setErrors({ name: "Give this item a name" });
      nameInputRef.current?.focus();
      return;
    }

    const sanitizedRecipe = formData.recipe.filter(
      (req) => req.itemId && req.itemId !== formData.id,
    );

    let sanitizedOutput;
    if (typeof formData.outputQuantity === 'number') {
        sanitizedOutput = { min: Math.max(0, formData.outputQuantity), max: Math.max(0, formData.outputQuantity) };
    } else {
        sanitizedOutput = {
            min: Math.max(0, formData.outputQuantity.min),
            max: Math.max(
                0,
                Math.max(formData.outputQuantity.min, formData.outputQuantity.max),
            ),
        };
    }

    const sanitizedByproducts = (formData.byproducts ?? []).filter(
      (bp) => bp.itemId && bp.itemId !== formData.id && bp.quantity.max > 0,
    );

    onSave({
      ...formData,
      name: formData.name.trim(),
      recipe: sanitizedRecipe,
      outputQuantity: sanitizedOutput,
      byproducts: sanitizedByproducts,
    });
  };

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} aria-hidden="true" />
      <div
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        ref={drawerRef}
      >
        <div
          className="flex flex-wrap items-center justify-between mb-lg"
          style={{ gap: "var(--spacing-sm)" }}
        >
          <h2 id="drawer-title" className="truncate">
            {allItems.some((i) => i.id === item.id) ? "Edit Item" : "New Item"}
          </h2>
          <button
            className="btn-icon"
            aria-label="Close drawer"
            onClick={onClose}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSave();
          }}
        >
          <div className="form-group">
            <label htmlFor="itemName" className="form-label">
              Name{" "}
              <span className="text-error" aria-hidden="true">
                *
              </span>
            </label>
            <input
              id="itemName"
              ref={nameInputRef}
              value={formData.name}
              onChange={(e) => {
                setFormData((prev) => ({ ...prev, name: e.target.value }));
                if (errors.name) setErrors({});
              }}
              placeholder="e.g. Iron Ingot"
              aria-invalid={!!errors.name}
              aria-describedby={errors.name ? "name-error" : undefined}
              maxLength={100}
            />
            {errors.name && (
              <span id="name-error" className="text-sm text-error mt-xs">
                {errors.name}
              </span>
            )}
          </div>

          <div className="form-group">
            <label htmlFor={isNewWorkstation ? "itemWorkstationInput" : "itemWorkstationSelect"} className="form-label">Workstation</label>
            {!isNewWorkstation ? (
              <select
                id="itemWorkstationSelect"
                value={formData.workstation || "None"}
                onChange={(e) => {
                  if (e.target.value === "__CREATE_NEW__") {
                    setIsNewWorkstation(true);
                    setFormData((prev) => ({ ...prev, workstation: "" }));
                  } else {
                    setFormData((prev) => ({
                      ...prev,
                      workstation: e.target.value,
                    }));
                  }
                }}
              >
                <option value="None">None</option>
                {uniqueWorkstations
                  .filter((ws) => ws !== "None")
                  .map((ws) => (
                    <option key={ws} value={ws}>
                      {ws}
                    </option>
                  ))}
                <option value="__CREATE_NEW__">
                  + Create new workstation...
                </option>
              </select>
            ) : (
              <div
                className="flex items-center"
                style={{ gap: "var(--spacing-sm)" }}
              >
                <input
                  id="itemWorkstationInput"
                  value={formData.workstation}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      workstation: e.target.value,
                    }))
                  }
                  placeholder="New workstation name"
                  maxLength={50}
                  autoFocus
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="btn-icon"
                  onClick={() => {
                    setIsNewWorkstation(false);
                    setFormData((prev) => ({ ...prev, workstation: "None" }));
                  }}
                  aria-label="Cancel new workstation"
                >
                  <X size={20} aria-hidden="true" />
                </button>
              </div>
            )}
          </div>

          <div className="form-group mb-lg">
            <label className="form-label">Output Quantity</label>
            <div className="flex items-center gap-xs">
              <NumericInput
                min={0}
                max={99999}
                value={typeof formData.outputQuantity === 'number' ? formData.outputQuantity : (formData.outputQuantity?.min ?? 1)}
                onChange={(v) => updateOutputRange("min", v)}
                style={{ width: "80px" }}
              />
              <span className="text-secondary">–</span>
              <NumericInput
                min={0}
                max={99999}
                value={typeof formData.outputQuantity === 'number' ? formData.outputQuantity : (formData.outputQuantity?.max ?? 1)}
                onChange={(v) => updateOutputRange("max", v)}
                style={{ width: "80px" }}
              />
            </div>
            <span className="text-sm text-secondary">How many items one craft produces. Use a range (e.g. 1–3) if the yield varies.</span>
          </div>

          <div className="mb-lg">
            <div className="flex items-center justify-between mb-sm">
              <h3 className="text-sm uppercase text-secondary">
                Recipe Ingredients
              </h3>
              <button
                type="button"
                className="btn-outline text-sm"
                onClick={addIngredient}
                style={{ padding: "0.25rem 0.5rem", minHeight: "auto" }}
                disabled={allItems.filter((i) => i.id !== formData.id).length === 0}
              >
                <Plus size={14} aria-hidden="true" />
                Ingredient
              </button>
            </div>

            {formData.recipe.length === 0 ? (
              <div
                className="empty-state"
                style={{
                  padding: "var(--spacing-md)",
                  gap: "var(--spacing-sm)",
                }}
              >
                <p className="text-sm text-secondary">
                  No ingredients added — this item is a base resource. Add ingredients to make it a crafted item.
                </p>
              </div>
            ) : (
              <div className="flex-col" style={{ gap: "0.5rem" }}>
                {formData.recipe.map((req, idx) => (
                  <div
                    key={idx}
                    className="flex items-center flex-wrap"
                    style={{ gap: "var(--spacing-sm)" }}
                  >
                    <SearchableSelect
                      aria-label={`Ingredient ${idx + 1}`}
                      style={{ flex: "1 1 150px" }}
                      value={req.itemId}
                      onChange={(val) => updateIngredient(idx, "itemId", val)}
                      placeholder="Select item..."
                      options={allItems
                        .filter((i) => i.id !== formData.id)
                        .map((i) => ({ value: i.id, label: i.name }))}
                    />
                    <input
                      aria-label={`Quantity for ingredient ${idx + 1}`}
                      type="number"
                      min="1"
                      max="99999"
                      style={{ width: "80px", flex: "0 0 80px" }}
                      value={req.quantity}
                      onChange={(e) =>
                        updateIngredient(
                          idx,
                          "quantity",
                          Math.max(1, parseInt(e.target.value) || 1),
                        )
                      }
                    />
                    <button
                      type="button"
                      className="btn-icon"
                      aria-label={`Remove ingredient ${idx + 1}`}
                      onClick={() => removeIngredient(idx)}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mb-lg">
            <div className="flex items-center justify-between mb-sm">
              <h3 className="text-sm uppercase text-secondary">Byproducts</h3>
              <button
                type="button"
                className="btn-outline text-sm"
                onClick={addByproduct}
                style={{ padding: "0.25rem 0.5rem", minHeight: "auto" }}
                disabled={allItems.filter((i) => i.id !== formData.id).length === 0}
              >
                <Plus size={14} aria-hidden="true" />
                Byproduct
              </button>
            </div>
            <span className="text-sm text-secondary mb-sm" style={{ display: 'block' }}>Secondary items produced alongside this recipe (e.g. 0–1 Amber).</span>
            {!formData.byproducts?.length ? (
              <div className="empty-state" style={{ padding: "var(--spacing-md)", gap: "var(--spacing-sm)" }}>
                <p className="text-sm text-secondary">No byproducts added.</p>
              </div>
            ) : (
              <div className="flex-col" style={{ gap: "0.5rem" }}>
                {formData.byproducts.map((bp, idx) => (
                  <div key={idx} className="flex items-center flex-wrap" style={{ gap: "0.5rem" }}>
                    <SearchableSelect
                      aria-label={`Byproduct ${idx + 1} item`}
                      style={{ flex: "1 1 200px", minWidth: 0 }}
                      value={bp.itemId}
                      onChange={(val) => updateByproduct(idx, "itemId", val)}
                      placeholder="Select item..."
                      options={allItems
                        .filter((i) => i.id !== formData.id)
                        .map((i) => ({ value: i.id, label: i.name }))}
                    />
                    <NumericInput
                      aria-label={`Min quantity for byproduct ${idx + 1}`}
                      min={0}
                      max={99999}
                      style={{ width: "80px", flex: "0 0 80px" }}
                      value={bp.quantity.min}
                      onChange={(v) => updateByproduct(idx, "min", v)}
                    />
                    <span className="text-secondary">–</span>
                    <NumericInput
                      aria-label={`Max quantity for byproduct ${idx + 1}`}
                      min={0}
                      max={99999}
                      style={{ width: "80px", flex: "0 0 80px" }}
                      value={bp.quantity.max}
                      onChange={(v) => updateByproduct(idx, "max", v)}
                    />
                    <button
                      type="button"
                      className="btn-icon"
                      aria-label={`Remove byproduct ${idx + 1}`}
                      onClick={() => removeByproduct(idx)}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div
            className="flex justify-end flex-wrap pt-md"
            style={{
              gap: "var(--spacing-md)",
              borderTop: "1px solid var(--border-color)",
              marginTop: "auto",
            }}
          >
            <button
              type="button"
              className="btn-outline"
              onClick={onClose}
              style={{ flex: "1 1 auto", maxWidth: "200px" }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              style={{ flex: "1 1 auto", maxWidth: "200px" }}
            >
              Save Item
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

export default App;
