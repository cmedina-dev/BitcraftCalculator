import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { calculateRequirements } from './calculator';
import { Item } from './types';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Mock window.confirm for delete actions
vi.stubGlobal('confirm', () => true);

// Mock crypto.randomUUID used by uuid
vi.stubGlobal('crypto', {
  ...globalThis.crypto,
  randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2, 9),
});

beforeEach(() => {
  localStorageMock.clear();
});

/**
 * Helper: navigate to Registry tab, open the editor for a new item,
 * fill the name field, add a byproduct, and return the byproduct row.
 */
async function openEditorWithByproduct(user: ReturnType<typeof userEvent.setup>) {
  render(<App />);

  // Switch to Registry tab
  const registryBtn = screen.getByRole('button', { name: /registry/i });
  await user.click(registryBtn);

  // Click "New Item" to open the drawer
  const newItemBtn = screen.getByRole('button', { name: /new item/i });
  await user.click(newItemBtn);

  // Fill in the name so the item is valid
  const nameInput = screen.getByLabelText(/name/i);
  await user.clear(nameInput);
  await user.type(nameInput, 'Test Item');

  // Click "Byproduct" button in the Byproducts section
  const addByproductBtn = screen.getByRole('button', { name: /byproduct/i });
  await user.click(addByproductBtn);

  // Now there should be byproduct min/max inputs
  const minInput = screen.getByLabelText(/min quantity for byproduct 1/i);
  const maxInput = screen.getByLabelText(/max quantity for byproduct 1/i);

  return { minInput, maxInput };
}

describe('Byproduct quantity inputs', () => {
  it('should render min and max inputs with default values', async () => {
    const user = userEvent.setup();
    const { minInput, maxInput } = await openEditorWithByproduct(user);

    expect(minInput).toBeInTheDocument();
    expect(maxInput).toBeInTheDocument();
    expect(minInput).toHaveValue(0);
    expect(maxInput).toHaveValue(1);
  });

  it('should allow clearing min input and typing a new number', async () => {
    const user = userEvent.setup();
    const { minInput } = await openEditorWithByproduct(user);

    // Clear the field and type a new value
    await user.clear(minInput);
    await user.type(minInput, '5');

    expect(minInput).toHaveValue(5);
  });

  it('should allow clearing max input and typing a new number', async () => {
    const user = userEvent.setup();
    const { maxInput } = await openEditorWithByproduct(user);

    await user.clear(maxInput);
    await user.type(maxInput, '10');

    expect(maxInput).toHaveValue(10);
  });

  it('should allow typing multi-digit numbers in min', async () => {
    const user = userEvent.setup();
    const { minInput } = await openEditorWithByproduct(user);

    await user.clear(minInput);
    await user.type(minInput, '42');

    expect(minInput).toHaveValue(42);
  });

  it('should allow typing multi-digit numbers in max', async () => {
    const user = userEvent.setup();
    const { maxInput } = await openEditorWithByproduct(user);

    await user.clear(maxInput);
    await user.type(maxInput, '99');

    expect(maxInput).toHaveValue(99);
  });

  it('should allow setting min to 0 (clearing and typing 0)', async () => {
    const user = userEvent.setup();
    const { minInput } = await openEditorWithByproduct(user);

    await user.clear(minInput);
    await user.type(minInput, '3');
    expect(minInput).toHaveValue(3);

    // Now change it back to 0
    await user.clear(minInput);
    await user.type(minInput, '0');
    expect(minInput).toHaveValue(0);
  });

  it('should retain the typed value after blur', async () => {
    const user = userEvent.setup();
    const { minInput, maxInput } = await openEditorWithByproduct(user);

    await user.clear(maxInput);
    await user.type(maxInput, '7');
    // Blur by clicking somewhere else
    await user.click(minInput);

    expect(maxInput).toHaveValue(7);
  });

  it('should allow editing min and max independently', async () => {
    const user = userEvent.setup();
    const { minInput, maxInput } = await openEditorWithByproduct(user);

    // Set max first (to a higher value so auto-correction doesn't interfere)
    await user.clear(maxInput);
    await user.type(maxInput, '10');
    await user.click(minInput); // blur max

    // Now set min
    await user.clear(minInput);
    await user.type(minInput, '3');
    await user.click(maxInput); // blur min

    expect(minInput).toHaveValue(3);
    expect(maxInput).toHaveValue(10);
  });

  it('should not snap back to 0 while typing in a cleared field', async () => {
    const user = userEvent.setup();
    const { minInput } = await openEditorWithByproduct(user);

    // Focus and clear the min input (which starts at 0)
    await user.clear(minInput);

    // At this point the field should be empty, not snapped back to "0"
    expect(minInput).toHaveValue(null); // empty number input = null

    // Now type a digit
    await user.type(minInput, '8');
    expect(minInput).toHaveValue(8);
  });

  it('should persist the value after blur triggers state update and re-render', async () => {
    const user = userEvent.setup();
    const { minInput, maxInput } = await openEditorWithByproduct(user);

    // Type into max, then blur to trigger state update
    await user.clear(maxInput);
    await user.type(maxInput, '5');
    await user.click(minInput); // blur max by clicking elsewhere

    // After blur + state update + re-render, the same DOM element should
    // still be in the document and hold the value (no key-based remount)
    expect(maxInput).toBeInTheDocument();
    expect(maxInput).toHaveValue(5);

    // Should still be able to re-focus and edit again
    await user.click(maxInput);
    await user.clear(maxInput);
    await user.type(maxInput, '20');
    await user.click(minInput); // blur max

    expect(maxInput).toBeInTheDocument();
    expect(maxInput).toHaveValue(20);
  });

  it('should handle the save flow correctly with byproduct quantities', async () => {
    const user = userEvent.setup();
    const { minInput, maxInput } = await openEditorWithByproduct(user);

    // Set min=2, max=5
    await user.clear(maxInput);
    await user.type(maxInput, '5');
    await user.click(minInput); // blur max to commit

    await user.clear(minInput);
    await user.type(minInput, '2');
    await user.click(maxInput); // blur min to commit

    expect(minInput).toHaveValue(2);
    expect(maxInput).toHaveValue(5);

    // Click Save
    const saveBtn = screen.getByRole('button', { name: /save item/i });
    await user.click(saveBtn);

    // Drawer should close (no more byproduct inputs visible)
    expect(screen.queryByLabelText(/min quantity for byproduct 1/i)).not.toBeInTheDocument();
  });
});

describe('Multi-target calculateRequirements', () => {
  const testItems: Item[] = [
    { id: 'wood', name: 'Wood', workstation: 'None', recipe: [], outputQuantity: 1 },
    {
      id: 'plank',
      name: 'Plank',
      workstation: 'Sawmill',
      recipe: [{ itemId: 'wood', quantity: 2 }],
      outputQuantity: { min: 4, max: 4 },
    },
    {
      id: 'table',
      name: 'Table',
      workstation: 'Workbench',
      recipe: [{ itemId: 'plank', quantity: 3 }],
      outputQuantity: 1,
    },
    {
      id: 'chair',
      name: 'Chair',
      workstation: 'Workbench',
      recipe: [{ itemId: 'plank', quantity: 2 }],
      outputQuantity: 1,
    },
  ];

  it('should return multiple trees for multiple targets', () => {
    const result = calculateRequirements(
      [{ itemId: 'table', quantity: 1 }, { itemId: 'chair', quantity: 1 }],
      testItems,
    );
    expect(result.trees).toHaveLength(2);
    expect(result.trees[0].itemName).toBe('Table');
    expect(result.trees[1].itemName).toBe('Chair');
  });

  it('should share leftovers between targets', () => {
    // Table needs 3 planks → 1 craft of plank (yields 4) → 1 leftover plank
    // Chair needs 2 planks → can use 1 from leftovers, still needs 1 → 1 more craft (yields 4) → 3 leftover planks
    const result = calculateRequirements(
      [{ itemId: 'table', quantity: 1 }, { itemId: 'chair', quantity: 1 }],
      testItems,
    );

    // Total wood: table needs 1 plank craft (2 wood) + chair needs 1 plank craft (2 wood) = 4 wood
    // But if chair reuses the 1 leftover plank from table's craft, chair still needs 1 more plank → 1 craft = 2 wood
    // So total = 4 wood
    expect(result.baseIngredients['Wood']).toBe(4);

    // Compare with running them separately: table alone = 2 wood, chair alone = 2 wood = 4 wood total
    // In this case same, but leftover planks differ
    const separateTable = calculateRequirements([{ itemId: 'table', quantity: 1 }], testItems);
    const separateChair = calculateRequirements([{ itemId: 'chair', quantity: 1 }], testItems);

    // Table alone: 1 plank craft → 4 planks, uses 3, leftover 1 plank
    expect(separateTable.leftovers['Plank']?.min).toBe(1);
    // Chair alone: 1 plank craft → 4 planks, uses 2, leftover 2 planks
    expect(separateChair.leftovers['Plank']?.min).toBe(2);

    // Combined: table leftover plank (1) is consumed by chair, so chair uses it
    // chair tree should show usedFromLeftovers = 1
    const chairTree = result.trees[1].tree;
    const chairPlankChild = chairTree.children.find((c) => c.itemName === 'Plank');
    expect(chairPlankChild?.usedFromLeftovers).toBe(1);
  });
});

describe('Multi-target UI', () => {
  /**
   * Helper: seed localStorage with items and render App on Calculator tab.
   */
  async function setupWithItems() {
    const items: Item[] = [
      { id: 'iron', name: 'Iron Ore', workstation: 'None', recipe: [], outputQuantity: 1 },
      { id: 'coal', name: 'Coal', workstation: 'None', recipe: [], outputQuantity: 1 },
      {
        id: 'ingot',
        name: 'Iron Ingot',
        workstation: 'Furnace',
        recipe: [{ itemId: 'iron', quantity: 2 }, { itemId: 'coal', quantity: 1 }],
        outputQuantity: 1,
      },
    ];
    localStorageMock.setItem('bitcraft-items', JSON.stringify(items));
    render(<App />);
  }

  it('should add a second target row when "Add Item" is clicked', async () => {
    const user = userEvent.setup();
    await setupWithItems();

    // Initially one target select
    expect(screen.getAllByRole('combobox', { name: /target item/i })).toHaveLength(1);

    // Click "Add Item"
    const addBtn = screen.getByRole('button', { name: /add item/i });
    await user.click(addBtn);

    // Now two target selects
    expect(screen.getAllByRole('combobox', { name: /target item/i })).toHaveLength(2);
  });

  it('should remove a target row and hide trash when only one remains', async () => {
    const user = userEvent.setup();
    await setupWithItems();

    // Add a second row
    const addBtn = screen.getByRole('button', { name: /add item/i });
    await user.click(addBtn);

    // Both rows have trash buttons
    const trashButtons = screen.getAllByRole('button', { name: /remove target/i });
    expect(trashButtons).toHaveLength(2);

    // Remove the second row
    await user.click(trashButtons[1]);

    // Back to one row, no trash button visible
    expect(screen.getAllByRole('combobox', { name: /target item/i })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /remove target/i })).not.toBeInTheDocument();
  });
});
