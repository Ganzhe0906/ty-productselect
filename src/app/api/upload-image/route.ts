import { NextRequest, NextResponse } from 'next/server';
import { uploadToBlob } from '@/lib/blob-utils';
import crypto from 'crypto';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer); // Convert ArrayBuffer to Node.js Buffer

    const fileExtension = file.name.split('.').pop();
    const fileName = `${crypto.randomUUID()}.${fileExtension}`;
    const filePath = `mode3-images/${fileName}`; // Store in a specific folder in R2

    const imageUrl = await uploadToBlob(filePath, buffer, file.type);

    return NextResponse.json({ url: imageUrl });
  } catch (error: any) {
    console.error('Error uploading image to R2:', error);
    return NextResponse.json({ error: error.message || 'Image upload failed.' }, { status: 500 });
  }
}