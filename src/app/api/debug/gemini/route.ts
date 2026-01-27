import { NextRequest, NextResponse } from 'next/server';
import { debugGeminiCall } from '@/lib/gemini';

export async function POST(req: NextRequest) {
    try {
        const { apiKey, model } = await req.json();

        if (!apiKey) {
            return NextResponse.json({ success: false, error: 'API Key is missing' }, { status: 400 });
        }

        console.log(`[Debug] Testing Gemini connection with model: ${model}`);
        
        const testProductName = "Stainless Steel Water Bottle 500ml";
        // 使用新的 debugGeminiCall 函数
        const debugResult = await debugGeminiCall(testProductName, apiKey, model);

        return NextResponse.json({ 
            success: debugResult.success,
            data: debugResult,
            message: debugResult.success ? 'Connection successful!' : (debugResult.error || 'Check debug steps')
        });

    } catch (error: any) {
        console.error('[Debug] Gemini Error:', error);
        return NextResponse.json({ 
            success: false, 
            error: error.message || 'Unknown error occurred',
            details: error.stack
        }, { status: 500 });
    }
}
