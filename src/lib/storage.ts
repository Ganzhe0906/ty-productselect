import { Product } from './excel';

export interface LibraryItem {
  id: string;
  name: string;
  products: Product[];
  productCount?: number;
  timestamp: number;
  excelUrl?: string;
  originalLibraryId?: string;
  completedBy?: string[];
}

export const saveToPending = async (name: string, products: Product[]) => {
  // This is now handled by the API POST /api/library
  // But for compatibility with existing code that might call this with parsed products,
  // we might need to handle it. However, the requirement is to use the original file.
  console.log('saveToPending called with products, but we prefer file upload now.');
};

export const saveToCompleted = async (name: string, products: Product[], originalLibraryId?: string, createdBy?: string) => {
  // 过滤掉巨大的 Base64 图片数据，避免 413 FUNCTION_PAYLOAD_TOO_LARGE
  // 保留 _index 供导出时从母版 Excel 溯源图片
  const lightweightProducts = products.map((p) => {
    const { _image_url, _image_base64, ...rest } = p as Record<string, unknown>;
    return rest;
  });

  const response = await fetch('/api/library/save-completed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, products: lightweightProducts, originalLibraryId, createdBy }),
  });
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to save to completed library');
  }
  return response.json();
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

export const getLibraryDetail = async (id: string): Promise<LibraryItem> => {
  const response = await fetch(`/api/library?id=${id}`);
  if (!response.ok) throw new Error('Failed to fetch library detail');
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

export const renameLibrary = async (id: string, name: string) => {
  const response = await fetch('/api/library', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, name }),
  });
  if (!response.ok) throw new Error('Failed to rename library');
};
