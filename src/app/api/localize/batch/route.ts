import { NextRequest, NextResponse } from 'next/server';
import { summarizeProductNamesBatch } from '@/lib/gemini';

export async function POST(req: NextRequest) {
    try {
        const { titles, apiKey, model } = await req.json();

        if (!titles || !Array.isArray(titles)) {
            return NextResponse.json({ error: 'Titles array is required' }, { status: 400 });
        }

        if (!apiKey) {
            return NextResponse.json({ error: 'API Key is missing' }, { status: 400 });
        }

        console.log(`[Batch API] Processing ${titles.length} titles...`);
        const summaries = await summarizeProductNamesBatch(titles, apiKey, model);

        if (!summaries || summaries.length === 0) {
            return NextResponse.json({ error: 'AI returned empty results. Possible safety filter or rate limit.' }, { status: 500 });
        }

        return NextResponse.json({ summaries });

    } catch (error: any) {
        console.error('[Batch API] Error:', error);
        return NextResponse.json({ error: error.message || 'AI processing failed' }, { status: 500 });
    }
}
