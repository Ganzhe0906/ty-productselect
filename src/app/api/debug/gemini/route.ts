import { NextRequest, NextResponse } from 'next/server';
import { validateGeminiKey } from '@/lib/gemini';

export async function POST(req: NextRequest) {
    try {
        const { apiKey, model } = await req.json();

        if (!apiKey) {
            return NextResponse.json({ success: false, error: 'API Key is missing' }, { status: 400 });
        }

        console.log(`[Debug] Validating API Key with model: ${model}`);
        
        // 仅验证 Key 的有效性，速度更快且更稳定
        const result = await validateGeminiKey(apiKey, model);

        return NextResponse.json({ 
            success: result.success,
            message: result.success ? 'API Key 有效！' : (result.error || '验证失败'),
            error: result.error
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
