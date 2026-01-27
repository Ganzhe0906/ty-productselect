import { sql } from '@vercel/postgres';

export interface LibraryRow {
  id: string;
  name: string;
  type: 'pending' | 'completed';
  timestamp: number;
  excel_url: string;
  products: any;
  original_library_id?: string;
}

export async function initDb() {
  await sql`
    CREATE TABLE IF NOT EXISTS libraries (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      type VARCHAR(20) NOT NULL,
      timestamp BIGINT NOT NULL,
      excel_url TEXT NOT NULL,
      products JSONB NOT NULL,
      original_library_id UUID
    );
  `;
}

export async function getLibraries(type: 'pending' | 'completed') {
  const { rows } = await sql<LibraryRow>`
    SELECT * FROM libraries WHERE type = ${type} ORDER BY timestamp DESC
  `;
  return rows;
}

export async function saveLibrary(library: LibraryRow) {
  await sql`
    INSERT INTO libraries (id, name, type, timestamp, excel_url, products, original_library_id)
    VALUES (${library.id}, ${library.name}, ${library.type}, ${library.timestamp}, ${library.excel_url}, ${JSON.stringify(library.products)}, ${library.original_library_id || null})
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      type = EXCLUDED.type,
      timestamp = EXCLUDED.timestamp,
      excel_url = EXCLUDED.excel_url,
      products = EXCLUDED.products,
      original_library_id = EXCLUDED.original_library_id
  `;
}

export async function deleteLibrary(id: string) {
  await sql`DELETE FROM libraries WHERE id = ${id}`;
}

export async function getLibraryById(id: string) {
  const { rows } = await sql<LibraryRow>`
    SELECT * FROM libraries WHERE id = ${id}
  `;
  return rows[0];
}
