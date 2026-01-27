import { Product } from './excel';

export interface LibraryItem {
  id: string;
  name: string;
  products: Product[];
  timestamp: number;
  excelUrl?: string;
  originalLibraryId?: string;
}

export const saveToPending = async (name: string, products: Product[]) => {
  // This is now handled by the API POST /api/library
  // But for compatibility with existing code that might call this with parsed products,
  // we might need to handle it. However, the requirement is to use the original file.
  console.log('saveToPending called with products, but we prefer file upload now.');
};

export const saveToCompleted = async (name: string, products: Product[], originalLibraryId?: string) => {
  // Similarly, for completed, we could send the products to the server
  // to be saved as a new Excel file if needed.
  // For now, let's implement a simple save via API.
  const response = await fetch('/api/library/save-completed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, products, originalLibraryId }),
  });
  if (!response.ok) throw new Error('Failed to save to completed library');
};

export const getPendingLibrary = async (): Promise<LibraryItem[]> => {
  const response = await fetch('/api/library?type=pending');
  if (!response.ok) throw new Error('Failed to fetch pending library');
  return response.json();
};

export const getCompletedLibrary = async (): Promise<LibraryItem[]> => {
  const response = await fetch('/api/library?type=completed');
  if (!response.ok) throw new Error('Failed to fetch completed library');
  return response.json();
};

export const deletePendingItem = async (id: string) => {
  const response = await fetch(`/api/library?id=${id}&type=pending`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('Failed to delete pending item');
};

export const deleteCompletedItem = async (id: string) => {
  const response = await fetch(`/api/library?id=${id}&type=completed`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('Failed to delete completed item');
};
