import { useState, useEffect } from 'react';
import { Item } from './types';

const STORAGE_KEY = 'bitcraft_calculator_items_v2';

const defaultItems: Item[] = [
  { id: '1', name: 'Wood Log', workstation: 'None', recipe: [], outputQuantity: { min: 1, max: 1 } },
  { id: '2', name: 'Stone', workstation: 'None', recipe: [], outputQuantity: { min: 1, max: 1 } },
  { id: '3', name: 'Plank', workstation: 'Sawmill', recipe: [{ itemId: '1', quantity: 2 }], outputQuantity: { min: 1, max: 1 } },
  { id: '4', name: 'Stone Block', workstation: 'Masonry Table', recipe: [{ itemId: '2', quantity: 4 }], outputQuantity: { min: 1, max: 1 } },
  { id: '5', name: 'Wooden Chest', workstation: 'Workbench', recipe: [{ itemId: '3', quantity: 5 }, { itemId: '4', quantity: 1 }], outputQuantity: { min: 1, max: 1 } }
];

export function useItems() {
  const [items, setItems] = useState<Item[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Basic migration handling from v1 to v2 if needed, or just let it fall back
        if (parsed.length > 0 && typeof parsed[0].outputQuantity === 'number') {
           return defaultItems; // Invalidate old cache shape to prevent crashes
        }
        return parsed;
      } catch (e) {
        return defaultItems;
      }
    }
    return defaultItems;
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items]);

  const addItem = (item: Item) => setItems(prev => [...prev, item]);
  const updateItem = (updated: Item) => setItems(prev => prev.map(i => i.id === updated.id ? updated : i));
  const deleteItem = (id: string) => setItems(prev => prev.filter(i => i.id !== id));

  return { items, addItem, updateItem, deleteItem };
}