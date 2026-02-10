import { GoogleGenerativeAI } from "@google/generative-ai";

export interface AISummary {
  name: string;
  scenario: string;
}



export interface DebugStep {
  name: string;
  status: 'pending' | 'success' | 'error' | 'warning';
  message: string;
  data?: any;
  timestamp: number;
}

export interface DebugResponse {
  steps: DebugStep[];
  success: boolean;
  finalResult?: any;
  error?: string;
}

function generatePrompt(productNames: string[]): string {
    const titlesList = productNames.map((name, i) => `${i + 1}. ${name}`).join('\n');
    return `你是一个拥有10年经验的顶级跨境电商选品与市场专家。你的任务是阅读一组英文商品标题，精准提取核心卖点，并将其转化为高度符合中国选品习惯、且能瞬间抓住眼球的中文商品名与场景用途。

**核心目标：** 
1. 彻底剔除所有“废话”（促销词、规格词、品牌名）。
2. 将生涩的英文翻译为地道、专业的中文选品词汇。
3. 严禁直接翻译，必须基于产品属性进行“二次创作”和“逻辑推理”。

**处理规则：** 

1. **中文商品名 (name)**： 
   - **绝对禁令**：严禁出现任何英文字母、数字（除非是型号如 4K, 5G）或特殊符号。
   - **风格要求**：极其精炼。格式通常为“核心属性/核心人群 + 产品核心词”。
   - **剔除内容**：必须剔除 New, Hot Sale, Best Gift, 2024/2025, 8x10 inch, 52 Cards 等一切促销词和无用规格。
   - **字数限制**：10个汉字以内。

2. **场景用途 (scenario)**： 
   - **深度推理**：不要只看字面意思。如果标题有 "Sensory", "Stress Relief"，场景应是“儿童感官开发”或“办公室解压解闷”。
   - **拒绝平庸**：严禁使用“通用场景”、“日常使用”等模糊词汇。
   - **具体化**：必须给出具体的“人群+动作”或“节日+对象”。例如：“情侣纪念日惊喜”、“自闭症儿童康复训练”、“露营派对活跃气氛”。
   - **字数限制**：15个汉字以内。

**优质示例 (学习模板)：**
- 输入: "New Interactive Elephant Toy for Toddlers" -> 输出: {"name": "幼儿大象互动玩具", "scenario": "幼儿感官开发/亲子互动"}
- 输入: "Go F*** Yourself Adult Card Game" -> 输出: {"name": "成人社交搞怪桌游", "scenario": "酒吧派对/破冰解压"}
- 输入: "Luna Bean Original Hand Casting Kit - Hand Mold Kit for Couples" -> 输出: {"name": "情侣手模DIY套装", "scenario": "周年纪念日/情人节手工礼品"}
- 输入: "NeeDoh Good Vibes Squishy Stress Ball with Messages" -> 输出: {"name": "正能量解压捏捏乐", "scenario": "办公室解压/情绪调节"}

**返回格式要求：** 
- 必须返回一个标准的 JSON 数组，包含 ${productNames.length} 个对象。
- 每个对象必须包含 "name" 和 "scenario" 两个字段。
- **严禁包含任何文字说明、Markdown 标签或思考过程，仅返回原始 JSON。**

**待处理标题列表：** 
${titlesList}`;
}

/**
 * 批量总结商品名与场景 (每 30 个一组)
 */
export async function summarizeProductNamesBatch(
  productNames: string[],
  apiKey: string,
  modelName: string = "gemini-3-flash-preview"
): Promise<AISummary[]> {
  if (!apiKey || productNames.length === 0) return [];

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ 
      model: modelName,
      generationConfig: {
        responseMimeType: "application/json",
      }
    });

    const prompt = generatePrompt(productNames);
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text().trim();
    
    // 尝试解析 JSON
    try {
        const parsed = parseGeminiJson(text);
        if (parsed) return normalizeResults(parsed);
    } catch (e) {
        console.error("AI 响应解析失败:", e);
        console.error("原始响应内容:", text);
    }
    
    return [];
  } catch (error: any) {
    // Error handling logic
    console.error("Gemini AI Batch Error:", error.message || error);
    if (error.cause) console.error("Error Cause:", error.cause);
    if (error.message?.includes('fetch failed')) {
        console.error("提示：检测到网络连接失败。如果你在中国大陆，请确保开启了全局代理，或在终端设置了 HTTPS_PROXY。");
    }
    return [];
  }
}

function parseGeminiJson(text: string): any[] | null {
    // 1. 尝试直接解析
    try {
        const results = JSON.parse(text);
        if (Array.isArray(results)) return results;
    } catch (e) {
        // 忽略
    }

    // 2. 尝试提取 Markdown 代码块
    const codeBlockMatch = text.match(/```json\s*(\[\s*[\s\S]*\s*\])\s*```/);
    if (codeBlockMatch) {
        try {
            const results = JSON.parse(codeBlockMatch[1]);
            if (Array.isArray(results)) return results;
        } catch (e) {
            // 忽略
        }
    }

    // 3. 智能提取：从后往前寻找有效的 JSON 数组
    const lastClose = text.lastIndexOf(']');
    if (lastClose !== -1) {
        const starts: number[] = [];
        for (let i = 0; i < lastClose; i++) {
            if (text[i] === '[') starts.push(i);
        }
        
        for (let i = starts.length - 1; i >= 0; i--) {
            const start = starts[i];
            try {
                const potentialJson = text.substring(start, lastClose + 1);
                const results = JSON.parse(potentialJson);
                if (Array.isArray(results)) return results;
            } catch (e) {
                // 忽略
            }
        }
    }
    return null;
}

export async function validateGeminiKey(apiKey: string, modelName: string = "gemini-1.5-flash"): Promise<{ success: boolean; error?: string }> {
  if (!apiKey) return { success: false, error: 'API Key is missing' };

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: modelName });
    
    // 发送一个极其简单的请求，仅用于验证 Key 的有效性
    const result = await model.generateContent("Hi, reply with 'OK'");
    const response = await result.response;
    const text = response.text();
    
    return { success: !!text };
  } catch (error: any) {
    let errorMsg = error.message || '未知错误';
    if (errorMsg.includes('API_KEY_INVALID')) errorMsg = '无效的 API Key';
    else if (errorMsg.includes('fetch failed')) errorMsg = '网络连接失败，请检查代理设置';
    
    return { success: false, error: errorMsg };
  }
}

export async function debugGeminiCall(
  productName: string,
  apiKey: string,
  modelName: string
): Promise<DebugResponse> {
  const steps: DebugStep[] = [];
  const addStep = (name: string, status: DebugStep['status'], message: string, data?: any) => {
    steps.push({ name, status, message, data, timestamp: Date.now() });
  };

  addStep('初始化', 'success', `开始测试 Gemini 连接 (Model: ${modelName})`);

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ 
      model: modelName,
      generationConfig: { responseMimeType: "application/json" }
    });

    const prompt = generatePrompt([productName]);
    addStep('Prompt生成', 'success', '已生成提示词', { promptPreview: prompt.substring(0, 100) + '...' });

    addStep('发送请求', 'pending', '正在连接 Google API...');
    const startTime = Date.now();
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text().trim();
    const duration = Date.now() - startTime;

    addStep('接收响应', 'success', `收到 API 响应 (${duration}ms)`, { rawLength: text.length, rawText: text });

    const parsed = parseGeminiJson(text);
    if (parsed) {
        const normalized = normalizeResults(parsed);
        addStep('JSON解析', 'success', '成功解析 JSON 结果', { result: normalized });
        return { steps, success: true, finalResult: normalized[0] };
    } else {
        addStep('JSON解析', 'error', '无法从响应中提取有效的 JSON 数组', { rawText: text });
        return { steps, success: false, error: 'JSON Parsing Failed' };
    }

  } catch (error: any) {
    const errorMsg = error.message || '未知错误';
    let userHint = '';
    
    if (errorMsg.includes('fetch failed')) {
        userHint = '【网络连接失败】无法连接到 Google API。请确保您的服务器/终端已配置科学上网代理（例如设置 HTTPS_PROXY 环境变量）。';
    } else if (errorMsg.includes('503 Service Unavailable')) {
        userHint = '【服务繁忙】Google Gemini 服务暂时过载 (503)。这通常是临时的，请稍后重试，或尝试切换到 gemini-2.5-flash 等更稳定的模型。';
    }
    
    addStep('发生错误', 'error', userHint ? `${userHint} (${errorMsg})` : errorMsg, { stack: error.stack, cause: error.cause });
    return { steps, success: false, error: userHint || errorMsg };
  }
}

function normalizeResults(results: any[]): AISummary[] {
    return results.map(r => ({
        name: String(r.name || "").replace(/["'“”]/g, "").trim(),
        scenario: String(r.scenario || "").replace(/["'“”]/g, "").trim()
    }));
}

/**
 * 单个总结商品名 (保留作为兜底)
 */
export async function summarizeProductName(
  productName: string,
  apiKey: string,
  modelName: string = "gemini-3-flash-preview"
): Promise<AISummary | null> {
  const results = await summarizeProductNamesBatch([productName], apiKey, modelName);
  return results.length > 0 ? results[0] : null;
}
